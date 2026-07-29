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

type UploadReceiptFormData = {
  file?: File | null;
  paymentTransactionId?: string | null;
  studentId?: string | null;
  replaceExistingReceipt?: string | null;
  replaceReason?: string | null;
  staffUserId?: string | null;
};

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

  const json = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
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

    if (createRes.ok) continue;
    if (createRes.status === 409) continue; // already created concurrently

    const text = await createRes.text().catch(() => '');
    throw new Error(`SharePoint folder create failed HTTP ${createRes.status}: ${text.slice(0, 250)}`);
  }
}

async function deleteSharePointItem(params: { driveId: string; itemId: string; token: string }): Promise<void> {
  const { driveId, itemId, token } = params;
  if (!itemId) return;
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    // 204 expected, but accept any non-5xx.
    if (res.status >= 500) return;
  } catch {
    // best-effort compensation
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
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

  const accessToken = parseBearerToken(req.headers.get('Authorization'));
  // Gateway requires Authorization; staff identity comes from staffUserId in multipart body
  // (this app uses skyline_users OTP login in localStorage, not Supabase Auth sessions).
  if (!accessToken) {
    return jsonResponse({ success: false, code: 'AUTH_REQUIRED', message: 'Authentication required.' }, 401);
  }

  // Staff auth in this app is custom (skyline_users via OTP/password), not Supabase Auth
  // sessions. Callers send the anon key as Bearer plus staffUserId; we authorize by role.
  let form: UploadReceiptFormData = {};
  try {
    const fd = await req.formData();
    const file = fd.get('file');
    form = {
      file: file instanceof File ? file : null,
      paymentTransactionId: fd.get('paymentTransactionId')?.toString() ?? null,
      studentId: fd.get('studentId')?.toString() ?? null,
      replaceExistingReceipt: fd.get('replaceExistingReceipt')?.toString() ?? null,
      replaceReason: fd.get('replaceReason')?.toString() ?? null,
      staffUserId: fd.get('staffUserId')?.toString() ?? null,
    };
  } catch {
    return jsonResponse(
      { success: false, code: 'BAD_REQUEST', message: 'Invalid multipart form data.' },
      400
    );
  }

  const currentUserId = Number(form.staffUserId ?? '');
  if (!Number.isFinite(currentUserId) || currentUserId <= 0) {
    return jsonResponse({ success: false, code: 'AUTH_REQUIRED', message: 'Authentication required.' }, 401);
  }

  const { data: staffRow, error: staffErr } = await supabaseAdmin
    .from('skyline_users')
    .select('id, role')
    .eq('id', currentUserId)
    .maybeSingle();
  if (staffErr || !staffRow) {
    return jsonResponse(
      { success: false, code: 'FORBIDDEN', message: 'You do not have permission to upload receipts.' },
      403
    );
  }
  const staffRole = String((staffRow as { role?: unknown }).role ?? '').toLowerCase();
  if (!['admin', 'superadmin'].includes(staffRole)) {
    return jsonResponse(
      { success: false, code: 'FORBIDDEN', message: 'You do not have permission to upload payment receipts.' },
      403
    );
  }

  // 2) Parse multipart payment fields (already parsed above)
  const paymentTransactionIdRaw = form.paymentTransactionId ?? '';
  const paymentTransactionId = Number(paymentTransactionIdRaw);
  if (!Number.isFinite(paymentTransactionId) || paymentTransactionId <= 0) {
    return jsonResponse({ success: false, code: 'PAYMENT_NOT_FOUND', message: 'Payment transaction not found.' }, 404);
  }

  const replaceExistingReceipt = String(form.replaceExistingReceipt ?? '').toLowerCase() === 'true';
  const replaceReason = form.replaceReason ?? null;

  if (replaceExistingReceipt) {
    if (staffRole !== 'superadmin') {
      return jsonResponse(
        {
          success: false,
          code: 'FORBIDDEN',
          message: 'Only Super Admin can correct a posted payment.',
        },
        403
      );
    }
    if (!String(replaceReason ?? '').trim()) {
      return jsonResponse(
        {
          success: false,
          code: 'REPLACE_REASON_REQUIRED',
          message: 'Replacement reason is required.',
        },
        400
      );
    }
  }

  const file = form.file;
  if (!file) {
    return jsonResponse({ success: false, code: 'INVALID_FILE_TYPE', message: 'Receipt file is required.' }, 400);
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

  console.log('[skyline-upload-payment-receipt] request', {
    requestId,
    userId: currentUserId,
    paymentTransactionId,
    fileSize: file.size,
  });

  // 3) Validate payment transaction + resolve student
  const { data: txRow, error: txErr } = await supabaseAdmin
    .from('skyline_student_payment_transactions')
    .select('id, student_id, status, amount, installment_id')
    .eq('id', paymentTransactionId)
    .maybeSingle();

  if (txErr || !txRow) {
    return jsonResponse({ success: false, code: 'PAYMENT_NOT_FOUND', message: 'Payment transaction not found.' }, 404);
  }

  const transactionStatus = String((txRow as { status?: unknown }).status ?? '');
  if (!['paid', 'partial'].includes(transactionStatus)) {
    return jsonResponse(
      {
        success: false,
        code: 'PAYMENT_NOT_FOUND',
        message: 'Receipt can only be uploaded for paid/partial transactions.',
      },
      404
    );
  }

  const studentId = Number((txRow as { student_id?: unknown }).student_id);
  if (!Number.isFinite(studentId) || studentId <= 0) {
    return jsonResponse({ success: false, code: 'STUDENT_NOT_FOUND', message: 'Student not found.' }, 404);
  }

  const formStudentId = Number(form.studentId ?? '');
  if (Number.isFinite(formStudentId) && formStudentId > 0 && formStudentId !== studentId) {
    return jsonResponse(
      { success: false, code: 'PAYMENT_NOT_FOUND', message: 'Payment transaction not found.' },
      404
    );
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

  // 4) SharePoint / Graph upload
  const graphToken = await getMicrosoftGraphAccessToken().catch((e) => {
    console.error('[skyline-upload-payment-receipt] graph token failed', e);
    return null;
  });
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
    if (siteIdOverride) {
      siteId = siteIdOverride;
    } else {
      if (!sharePointSiteUrl) {
        return jsonResponse(
          {
            success: false,
            code: 'SHAREPOINT_CONFIG_MISSING',
            message: 'SharePoint integration is not configured.',
          },
          500
        );
      }
      const site = await resolveSharePointSite({ siteUrl: sharePointSiteUrl, graphToken });
      siteId = site.id;
    }

    if (driveIdOverride) {
      driveId = driveIdOverride;
    } else {
      if (!sharePointLibraryName) {
        return jsonResponse(
          {
            success: false,
            code: 'SHAREPOINT_CONFIG_MISSING',
            message: 'SharePoint integration is not configured.',
          },
          500
        );
      }
      const drive = await resolveSharePointDrive({
        siteId,
        libraryName: sharePointLibraryName,
        graphToken,
      });
      driveId = drive.id;
    }
  } catch (e) {
    if (e instanceof SharePointResolutionError) {
      const status =
        e.code === 'SHAREPOINT_SITE_NOT_FOUND' || e.code === 'SHAREPOINT_LIBRARY_DRIVE_RESOLUTION_FAILED'
          ? 502
          : 500;
      return jsonResponse({ success: false, code: e.code, message: e.message }, status);
    }
    console.error('[skyline-upload-payment-receipt] sharepoint resolve failed', e);
    return jsonResponse(
      {
        success: false,
        code: 'SHAREPOINT_CONFIG_MISSING',
        message: 'SharePoint integration is not configured.',
      },
      500
    );
  }

  const safeStudentSegment = sanitizeSharePointFolderSegment(externalStudentId);
  const safeTxSegment = String(paymentTransactionId);
  if (!safeStudentSegment || !safeTxSegment) {
    return jsonResponse(
      { success: false, code: 'INVALID_REQUEST', message: 'Invalid folder path components.' },
      400
    );
  }

  const originalFileName = sanitizeOriginalFileName(file.name);
  const serverFileName = buildReceiptServerFileName({
    externalStudentId,
    paymentTransactionId,
    extension: validation.extension,
  });

  const sharepointPathSegments = [safeStudentSegment, safeTxSegment, serverFileName];
  const sharepointPath = sharepointPathSegments.join('/');

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
    const sharepointItemId = String(item.id ?? '');
    const webUrl = String(item.webUrl ?? '');
    if (!sharepointItemId || !webUrl) {
      throw new Error('SharePoint upload response missing item id/webUrl.');
    }

    // 5) Save receipt metadata to Postgres
    const receiptUploaded = await supabaseAdmin.rpc('skyline_replace_payment_receipt_metadata', {
      p_payment_transaction_id: paymentTransactionId,
      p_student_id: studentId,
      p_sharepoint_item_id: sharepointItemId,
      p_sharepoint_drive_id: driveId,
      p_sharepoint_site_id: siteId,
      p_file_name: serverFileName,
      p_original_file_name: originalFileName,
      p_mime_type: validation.normalizedMimeType,
      p_file_size: file.size,
      p_web_url: webUrl,
      p_sharepoint_path: sharepointPath,
      p_uploaded_by: currentUserId,
      p_replace_existing: replaceExistingReceipt,
      p_replace_reason: replaceExistingReceipt ? String(replaceReason ?? '').trim() : null,
    });

    const receiptError = (receiptUploaded as any).error as unknown;
    if (receiptError) {
      const errMsg = String((receiptUploaded as any).error?.message ?? receiptError);
      // Compensation: best-effort delete of newly uploaded file.
      await deleteSharePointItem({ driveId, itemId: sharepointItemId, token: graphToken });
      if (errMsg.includes('Active receipt already exists')) {
        return jsonResponse(
          {
            success: false,
            code: 'RECEIPT_ALREADY_EXISTS',
            message: 'A receipt already exists for this payment. Replace it instead.',
          },
          409
        );
      }
      return jsonResponse(
        { success: false, code: 'DATABASE_SAVE_FAILED', message: 'Could not save receipt metadata.' },
        500
      );
    }

    const receiptData = (receiptUploaded as any).data as unknown;
    const receiptRow = Array.isArray(receiptData) ? (receiptData[0] ?? null) : receiptData;
    if (!receiptRow || typeof receiptRow !== 'object') {
      await deleteSharePointItem({ driveId, itemId: sharepointItemId, token: graphToken });
      return jsonResponse({ success: false, code: 'DATABASE_SAVE_FAILED', message: 'Could not save receipt metadata.' }, 500);
    }

    const r = receiptRow as Record<string, unknown>;
    return jsonResponse({
      success: true,
      receipt: {
        id: Number(r.id),
        paymentTransactionId,
        fileName: String(r.file_name ?? ''),
        originalFileName: String(r.original_file_name ?? originalFileName),
        mimeType: String(r.mime_type ?? validation.normalizedMimeType),
        fileSize: Number(r.file_size ?? file.size),
        webUrl: String(r.web_url ?? webUrl),
        uploadedAt: String(r.uploaded_at ?? ''),
      },
    });
  } catch (e) {
    // If we uploaded to Graph and then DB failed, compensation is handled above.
    // Here we only handle Graph-side errors.
    console.error('[skyline-upload-payment-receipt] failed', e);
    const msg = e instanceof Error ? e.message : 'Receipt upload failed.';
    // Map known DB exception text to a safe code.
    if (String(msg).includes('Active receipt already exists')) {
      return jsonResponse(
        { success: false, code: 'RECEIPT_ALREADY_EXISTS', message: 'A receipt already exists for this payment. Replace it instead.' },
        409
      );
    }
    return jsonResponse(
      { success: false, code: 'SHAREPOINT_UPLOAD_FAILED', message: 'The receipt could not be uploaded. Please try again.' },
      502
    );
  } finally {
    // Avoid leaking any file bytes or tokens to logs.
  }
});

