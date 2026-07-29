import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  buildReceiptServerFileName,
  encodeSharePointPath,
  sanitizeOriginalFileName,
  sanitizeSharePointFolderSegment,
  validateReceiptFile,
} from './paymentReceiptHelpers.ts';
import {
  resolveSharePointDrive,
  resolveSharePointSite,
  SharePointResolutionError,
} from './sharePointResolution.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseBearerToken(authorizationHeader: string | null): string | null {
  const raw = String(authorizationHeader ?? '').trim();
  const m = raw.match(/^Bearer\s+(.+)$/i);
  if (!m?.[1]) return null;
  const token = m[1].trim();
  return token ? token : null;
}

async function getMicrosoftGraphAccessToken(): Promise<string> {
  const tenantId = (Deno.env.get('MS_TENANT_ID') ?? '').trim();
  const clientId = (Deno.env.get('MS_CLIENT_ID') ?? '').trim();
  const clientSecret = (Deno.env.get('MS_CLIENT_SECRET') ?? '').trim();
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Microsoft Graph client credential secrets are not configured.');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
    error?: string;
  };
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `Graph OAuth failed HTTP ${res.status}`);
  }
  return json.access_token;
}

async function ensureSharePointFolderExists(params: {
  driveId: string;
  folderSegments: string[];
  token: string;
}): Promise<void> {
  const { driveId, folderSegments, token } = params;
  const headers = { Authorization: `Bearer ${token}` };
  for (let i = 0; i < folderSegments.length; i++) {
    const seg = String(folderSegments[i] ?? '').trim();
    if (!seg) throw new Error('SharePoint folder segment is empty.');
    const parentSegments = folderSegments.slice(0, i + 1);
    const folderPath = encodeSharePointPath(parentSegments);
    const checkUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folderPath}`;
    const existing = await fetch(checkUrl, { headers });
    if (existing.ok) continue;
    const parentPath = encodeSharePointPath(folderSegments.slice(0, i));
    const createUrl = parentPath
      ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${parentPath}:/children`
      : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: seg,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });
    if (createRes.ok || createRes.status === 409) continue;
    const text = await createRes.text().catch(() => '');
    throw new Error(`SharePoint folder create failed HTTP ${createRes.status}: ${text.slice(0, 250)}`);
  }
}

async function deleteSharePointItem(params: { driveId: string; itemId: string; token: string }): Promise<void> {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${params.driveId}/items/${params.itemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${params.token}` },
    });
    if (res.status >= 500) return;
  } catch {
    // best-effort
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return jsonResponse({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Use POST.' }, 405);
  }

  let supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim();
  const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { success: false, code: 'SERVER_CONFIG_MISSING', message: 'Supabase configuration is missing.' },
      500
    );
  }
  supabaseUrl = supabaseUrl.replace(/\/$/, '');
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  if (!parseBearerToken(req.headers.get('Authorization'))) {
    return jsonResponse({ success: false, code: 'AUTH_REQUIRED', message: 'Authentication required.' }, 401);
  }

  let file: File | null = null;
  let staffUserId = '';
  let studentIdRaw = '';
  let assignmentIdRaw = '';
  let amountRaw = '';
  let paymentDate = '';
  let paymentReference = '';
  let notes = '';
  let idempotencyKey = '';

  try {
    const fd = await req.formData();
    const f = fd.get('file');
    file = f instanceof File ? f : null;
    staffUserId = fd.get('staffUserId')?.toString() ?? '';
    studentIdRaw = fd.get('studentId')?.toString() ?? '';
    assignmentIdRaw = fd.get('assignmentId')?.toString() ?? '';
    amountRaw = fd.get('amount')?.toString() ?? '';
    paymentDate = fd.get('paymentDate')?.toString() ?? '';
    paymentReference = fd.get('paymentReference')?.toString() ?? '';
    notes = fd.get('notes')?.toString() ?? '';
    idempotencyKey = fd.get('idempotencyKey')?.toString() ?? '';
  } catch {
    return jsonResponse({ success: false, code: 'BAD_REQUEST', message: 'Invalid multipart form data.' }, 400);
  }

  const currentUserId = Number(staffUserId);
  if (!Number.isFinite(currentUserId) || currentUserId <= 0) {
    return jsonResponse({ success: false, code: 'AUTH_REQUIRED', message: 'Authentication required.' }, 401);
  }

  const { data: staffRow, error: staffErr } = await supabaseAdmin
    .from('skyline_users')
    .select('id, role')
    .eq('id', currentUserId)
    .maybeSingle();
  if (staffErr || !staffRow) {
    return jsonResponse({ success: false, code: 'FORBIDDEN', message: 'Forbidden.' }, 403);
  }
  const staffRole = String((staffRow as { role?: unknown }).role ?? '').toLowerCase();
  if (!['admin', 'superadmin'].includes(staffRole)) {
    return jsonResponse({ success: false, code: 'FORBIDDEN', message: 'Forbidden.' }, 403);
  }

  if (!file) {
    return jsonResponse(
      {
        success: false,
        code: 'RECEIPT_REQUIRED',
        message: 'Please upload the payment receipt before recording this payment.',
      },
      400
    );
  }

  const studentId = Number(studentIdRaw);
  const assignmentId = Number(assignmentIdRaw);
  const amount = Number(amountRaw);
  if (!Number.isFinite(studentId) || studentId <= 0) {
    return jsonResponse({ success: false, code: 'STUDENT_NOT_FOUND', message: 'Student not found.' }, 404);
  }
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) {
    return jsonResponse({ success: false, code: 'BAD_REQUEST', message: 'Payment plan assignment is required.' }, 400);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse({ success: false, code: 'BAD_REQUEST', message: 'Payment amount must be greater than zero.' }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return jsonResponse({ success: false, code: 'BAD_REQUEST', message: 'Payment date is required.' }, 400);
  }

  const maxBytes = (() => {
    const raw = (Deno.env.get('MAX_RECEIPT_FILE_BYTES') ?? '').trim();
    if (!raw) return 10 * 1024 * 1024;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10 * 1024 * 1024;
  })();

  const validation = validateReceiptFile({
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    maxBytes,
  });
  if (!validation.ok) {
    return jsonResponse({ success: false, code: validation.code, message: validation.message }, 400);
  }

  // Pre-validate FIFO allocation (no side effects)
  const { error: previewErr } = await supabaseAdmin.rpc('skyline_preview_fifo_payment_allocation', {
    p_assignment_id: assignmentId,
    p_amount: amount,
  });
  if (previewErr) {
    const msg = previewErr.message || 'Payment exceeds outstanding balance.';
    return jsonResponse({ success: false, code: 'OVERPAYMENT', message: msg }, 400);
  }

  const { data: studentRow, error: studentErr } = await supabaseAdmin
    .from('skyline_students')
    .select('student_id')
    .eq('id', studentId)
    .maybeSingle();
  if (studentErr || !studentRow) {
    return jsonResponse({ success: false, code: 'STUDENT_NOT_FOUND', message: 'Student not found.' }, 404);
  }
  const externalStudentId = String((studentRow as { student_id?: unknown }).student_id ?? '').trim();
  if (!externalStudentId) {
    return jsonResponse({ success: false, code: 'STUDENT_NOT_FOUND', message: 'Student external id missing.' }, 404);
  }

  const graphToken = await getMicrosoftGraphAccessToken().catch(() => null);
  if (!graphToken) {
    return jsonResponse(
      { success: false, code: 'SHAREPOINT_AUTH_FAILED', message: 'Could not authenticate to SharePoint.' },
      502
    );
  }

  const siteIdOverride = (Deno.env.get('SHAREPOINT_SITE_ID') ?? '').trim();
  const driveIdOverride = (Deno.env.get('SHAREPOINT_PAYMENT_RECEIPTS_DRIVE_ID') ?? '').trim();
  const sharePointSiteUrl = (Deno.env.get('SHAREPOINT_SITE_URL') ?? '').trim();
  const sharePointLibraryName = (Deno.env.get('SHAREPOINT_LIBRARY_NAME') ?? '').trim();

  let siteId: string;
  let driveId: string;
  try {
    if (siteIdOverride) siteId = siteIdOverride;
    else {
      if (!sharePointSiteUrl) {
        return jsonResponse(
          { success: false, code: 'SHAREPOINT_CONFIG_MISSING', message: 'SharePoint integration is not configured.' },
          500
        );
      }
      siteId = (await resolveSharePointSite({ siteUrl: sharePointSiteUrl, graphToken })).id;
    }
    if (driveIdOverride) driveId = driveIdOverride;
    else {
      if (!sharePointLibraryName) {
        return jsonResponse(
          { success: false, code: 'SHAREPOINT_CONFIG_MISSING', message: 'SharePoint integration is not configured.' },
          500
        );
      }
      driveId = (await resolveSharePointDrive({ siteId, libraryName: sharePointLibraryName, graphToken })).id;
    }
  } catch (e) {
    if (e instanceof SharePointResolutionError) {
      return jsonResponse({ success: false, code: e.code, message: e.message }, 502);
    }
    return jsonResponse(
      { success: false, code: 'SHAREPOINT_CONFIG_MISSING', message: 'SharePoint integration is not configured.' },
      500
    );
  }

  const stagingKey = (idempotencyKey || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || crypto.randomUUID();
  const safeStudentSegment = sanitizeSharePointFolderSegment(externalStudentId);
  const safeTxSegment = sanitizeSharePointFolderSegment(`pending-${stagingKey}`);
  const originalFileName = sanitizeOriginalFileName(file.name);
  // Temporary id 0 for filename builder; staging folder is unique.
  const serverFileName = buildReceiptServerFileName({
    externalStudentId,
    paymentTransactionId: 0,
    extension: validation.extension,
  }).replace('_0_', `_${stagingKey.slice(0, 8)}_`);

  const sharepointPathSegments = [safeStudentSegment, safeTxSegment, serverFileName];
  const sharepointPath = sharepointPathSegments.join('/');

  let sharepointItemId = '';
  let webUrl = '';

  try {
    await ensureSharePointFolderExists({
      driveId,
      token: graphToken,
      folderSegments: [safeStudentSegment, safeTxSegment],
    });

    const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeSharePointPath(sharepointPathSegments)}:/content`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploadRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${graphToken}`, 'Content-Type': validation.normalizedMimeType },
      body: bytes,
    });
    if (!uploadRes.ok) {
      const text = await uploadRes.text().catch(() => '');
      throw new Error(`SharePoint upload failed HTTP ${uploadRes.status}: ${text.slice(0, 300)}`);
    }
    const item = (await uploadRes.json().catch(() => ({}))) as Record<string, unknown>;
    sharepointItemId = String(item.id ?? '');
    webUrl = String(item.webUrl ?? '');
    if (!sharepointItemId || !webUrl) {
      throw new Error('SharePoint upload response missing item id/webUrl.');
    }

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('skyline_record_student_plan_payment', {
      p_assignment_id: assignmentId,
      p_student_id: studentId,
      p_amount: amount,
      p_payment_date: paymentDate,
      p_payment_reference: paymentReference || null,
      p_notes: notes || null,
      p_changed_by: currentUserId,
      p_idempotency_key: stagingKey,
      p_sharepoint_item_id: sharepointItemId,
      p_sharepoint_drive_id: driveId,
      p_sharepoint_site_id: siteId,
      p_file_name: serverFileName,
      p_original_file_name: originalFileName,
      p_mime_type: validation.normalizedMimeType,
      p_file_size: file.size,
      p_web_url: webUrl,
      p_sharepoint_path: sharepointPath,
    });

    if (rpcError) {
      await deleteSharePointItem({ driveId, itemId: sharepointItemId, token: graphToken });
      const msg = rpcError.message || 'Could not record payment.';
      if (/receipt/i.test(msg)) {
        return jsonResponse({ success: false, code: 'RECEIPT_REQUIRED', message: msg }, 400);
      }
      if (/exceeds|Maximum payment/i.test(msg)) {
        return jsonResponse({ success: false, code: 'OVERPAYMENT', message: msg }, 400);
      }
      if (/Only Super Admin|Forbidden|Authentication/i.test(msg)) {
        return jsonResponse({ success: false, code: 'FORBIDDEN', message: msg }, 403);
      }
      return jsonResponse({ success: false, code: 'DATABASE_SAVE_FAILED', message: msg }, 500);
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    return jsonResponse({
      success: true,
      paymentTransactionId: Number((row as { payment_transaction_id?: unknown })?.payment_transaction_id ?? 0),
      allocatedTotal: Number((row as { allocated_total?: unknown })?.allocated_total ?? amount),
      allocationCount: Number((row as { allocation_count?: unknown })?.allocation_count ?? 0),
      receipt: {
        webUrl,
        originalFileName,
        fileName: serverFileName,
      },
    });
  } catch (e) {
    if (sharepointItemId) {
      await deleteSharePointItem({ driveId, itemId: sharepointItemId, token: graphToken });
    }
    console.error('[skyline-record-student-payment] failed', e);
    return jsonResponse(
      {
        success: false,
        code: 'SHAREPOINT_UPLOAD_FAILED',
        message: 'The receipt could not be uploaded. Please try again.',
      },
      502
    );
  }
});
