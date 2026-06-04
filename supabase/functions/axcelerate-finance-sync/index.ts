// Sync aXcelerate invoices into public.ax_invoices (upsert only; batched to stay within Edge limits).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

type FinanceSyncSupabase = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Contacts processed per Edge Function invocation (cron / UI loops until hasMore is false). */
const DEFAULT_CONTACT_LIMIT = 12;
const MAX_CONTACT_LIMIT = 25;
const CONTACT_REQUEST_DELAY_MS = 280;

type SyncRequestBody = {
  contactID?: string | number;
  offset?: number;
  limit?: number;
};

type AxInvoiceRow = {
  invoice_id: number;
  invoice_number: string | null;
  contact_id: number | null;
  student_name: string | null;
  email: string | null;
  invoice_date: string | null;
  due_date: string | null;
  invoice_amount: number;
  paid_amount: number;
  balance: number;
  is_paid: boolean;
  is_void: boolean;
  is_cancelled: boolean;
  are_items_locked: boolean;
  course_name: string | null;
  agent_name: string | null;
  raw_json: Record<string, unknown>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function pickField(row: Record<string, unknown>, ...keys: string[]): string {
  const map = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    map.set(key, value);
    map.set(key.toLowerCase(), value);
    map.set(key.replace(/[.\s_]/g, '').toLowerCase(), value);
  }
  for (const key of keys) {
    const variants = [key, key.toLowerCase(), key.replace(/[.\s_]/g, '').toLowerCase()];
    for (const k of variants) {
      const v = map.get(k);
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

function parseIsoDate(value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = v.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const dmyShort = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyShort) {
    const dd = dmyShort[1].padStart(2, '0');
    const mm = dmyShort[2].padStart(2, '0');
    return `${dmyShort[3]}-${mm}-${dd}`;
  }
  return null;
}

function parseBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function normalizeInvoice(raw: Record<string, unknown>, contactHint?: { name?: string; email?: string }): AxInvoiceRow | null {
  const invoiceIdRaw = pickField(raw, 'INVOICEID', 'invoiceID', 'invoice.invoiceid', 'invoiceid', 'id');
  const invoiceId = Number(invoiceIdRaw);
  if (!Number.isFinite(invoiceId) || invoiceId <= 0) return null;

  const contactIdRaw = pickField(raw, 'CONTACTID', 'contactID', 'invoice.invoicecontactid', 'invoicecontactid');
  const contactId = contactIdRaw ? Number(contactIdRaw) : null;

  const balance = parseNumber(pickField(raw, 'BALANCE', 'invoice.balance', 'UNASSIGNEDAMOUNT'));
  const invoiceAmount = parseNumber(
    pickField(raw, 'PRICEGROSS', 'INVOICETOTALGROSS', 'invoice.pricegross', 'pricegross', 'TOTALGROSS')
  );
  let paidAmount = parseNumber(
    pickField(raw, 'ACTUALRECEIVEDAMOUNT', 'PAYMENTSRECEIVED', 'invoice.actualreceivedamount', 'actualreceivedamount')
  );
  // Invoice list API returns InvoiceSummary (PRICEGROSS + BALANCE), not ACTUALRECEIVEDAMOUNT.
  if (paidAmount <= 0 && invoiceAmount > 0 && balance >= 0 && balance <= invoiceAmount) {
    paidAmount = Math.max(0, invoiceAmount - balance);
  }

  const isPaidRaw = pickField(raw, 'ISPAID', 'invoice.ispaid', 'MARKEDPAID').toLowerCase();
  const isPaid =
    isPaidRaw === 'true' ||
    isPaidRaw === '1' ||
    isPaidRaw === 'yes' ||
    balance <= 0 ||
    (invoiceAmount > 0 && paidAmount >= invoiceAmount);

  return {
    invoice_id: invoiceId,
    invoice_number: pickField(raw, 'INVOICENR', 'INVOICENO', 'invoice.invoicenr', 'invoicenr') || null,
    contact_id: Number.isFinite(contactId) ? contactId : null,
    student_name:
      pickField(raw, 'INVOICETOFULLNAME', 'FULLNAME', 'invoice.invoicetofullname', 'invoicetofullname') ||
      contactHint?.name ||
      null,
    email:
      pickField(raw, 'INVOICETOEMAIL', 'EMAILADDRESS', 'invoice.invoicetoemail', 'invoicetoemail') ||
      contactHint?.email ||
      null,
    invoice_date: parseIsoDate(pickField(raw, 'INVOICEDATE', 'invoice.invoicedate', 'invoicedate', 'START')),
    due_date: parseIsoDate(pickField(raw, 'INVOICEDUEDATE', 'invoice.invoiceduedate', 'invoiceduedate', 'DUEDATE')),
    invoice_amount: invoiceAmount,
    paid_amount: paidAmount,
    balance,
    is_paid: isPaid,
    is_void: parseBool(pickField(raw, 'ISVOID', 'VOID', 'invoice.isvoid')),
    is_cancelled: parseBool(pickField(raw, 'ISCANCELLED', 'CANCELLED', 'invoice.iscancelled')),
    are_items_locked: parseBool(pickField(raw, 'AREITEMSLOCKED', 'invoice.areitemslocked', 'ITEMSLOCKED')),
    course_name: pickField(raw, 'COURSE', 'COURSENAME', 'invoice.course') || null,
    agent_name:
      pickField(raw, 'AGENT', 'AGENTNAME', 'invoice.agent', 'INVOICETOORGANISATION', 'invoice.invoicetoorganisation') ||
      null,
    raw_json: raw,
  };
}

function parseInvoiceList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
  }
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const candidates = [obj.DATA, obj.data, obj.invoices, obj.INVOICES, obj.rows, obj.ROWS];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
    if (typeof c === 'string') {
      try {
        const parsed = JSON.parse(c);
        if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
      } catch {
        /* ignore */
      }
    }
  }
  return [];
}

async function axFetch(
  baseUrl: string,
  path: string,
  apiToken: string,
  wsToken: string
): Promise<{ ok: boolean; status: number; payload: unknown; text: string }> {
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apitoken: apiToken,
      wstoken: wsToken,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { ok: res.ok, status: res.status, payload, text };
}

async function fetchContactIdsFromSupabase(
  supabase: FinanceSyncSupabase
): Promise<Map<number, { name?: string; email?: string }>> {
  const map = new Map<number, { name?: string; email?: string }>();

  const { data: students } = await supabase
    .from('skyline_students')
    .select('student_id, name, email, status')
    .eq('status', 'active');

  for (const row of students ?? []) {
    const sid = String((row as { student_id?: string | null }).student_id ?? '').trim();
    const n = Number(sid);
    if (!Number.isFinite(n) || n <= 0) continue;
    map.set(n, {
      name: String((row as { name?: string }).name ?? '').trim() || undefined,
      email: String((row as { email?: string }).email ?? '').trim() || undefined,
    });
  }

  const { data: invoiceContacts } = await supabase.from('ax_invoices').select('contact_id, student_name, email');
  for (const row of invoiceContacts ?? []) {
    const cid = Number((row as { contact_id?: number | null }).contact_id ?? 0);
    if (!Number.isFinite(cid) || cid <= 0) continue;
    if (!map.has(cid)) {
      map.set(cid, {
        name: String((row as { student_name?: string }).student_name ?? '').trim() || undefined,
        email: String((row as { email?: string }).email ?? '').trim() || undefined,
      });
    }
  }

  return map;
}

async function syncContactInvoices(
  baseUrl: string,
  apiToken: string,
  wsToken: string,
  supabase: FinanceSyncSupabase,
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  errors: string[]
): Promise<{ invoices: number; upserted: number }> {
  const { ok, status, payload } = await axFetch(
    baseUrl,
    `/accounting/invoice/?contactID=${contactId}`,
    apiToken,
    wsToken
  );

  if (!ok) {
    errors.push(`contact ${contactId}: invoice fetch failed (${status})`);
    return { invoices: 0, upserted: 0 };
  }

  const invoices = parseInvoiceList(payload);
  const upsertRows: AxInvoiceRow[] = [];
  for (const inv of invoices) {
    const normalized = normalizeInvoice(inv, hint);
    if (normalized) upsertRows.push(normalized);
  }

  if (upsertRows.length === 0) {
    return { invoices: invoices.length, upserted: 0 };
  }

  const { error: upsertError } = await supabase.from('ax_invoices').upsert(upsertRows, {
    onConflict: 'invoice_id',
  });

  if (upsertError) {
    errors.push(`contact ${contactId}: upsert failed (${upsertError.message})`);
    return { invoices: invoices.length, upserted: 0 };
  }

  return { invoices: invoices.length, upserted: upsertRows.length };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed. Use POST.' }, 405);
  }

  let body: SyncRequestBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const baseUrl = (Deno.env.get('AXCELERATE_BASE_URL') || 'https://slit.app.axcelerate.com/api').replace(/\/$/, '');
  const apiToken = Deno.env.get('AXCELERATE_API_TOKEN') ?? '';
  const wsToken = Deno.env.get('AXCELERATE_WS_TOKEN') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!apiToken || !wsToken) {
    return jsonResponse(
      { success: false, message: 'aXcelerate API is not configured.', errors: [] },
      500
    );
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { success: false, message: 'Supabase service role is not configured.', errors: [] },
      500
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const errors: string[] = [];
  let syncedInvoices = 0;
  let insertedOrUpdated = 0;

  const singleContactRaw = body.contactID != null ? String(body.contactID).trim() : '';
  const singleContactId = singleContactRaw ? Number(singleContactRaw) : NaN;

  const offset = Math.max(0, Number(body.offset ?? 0) || 0);
  const limitRaw = Number(body.limit ?? DEFAULT_CONTACT_LIMIT) || DEFAULT_CONTACT_LIMIT;
  const limit = Math.min(Math.max(1, limitRaw), MAX_CONTACT_LIMIT);

  let contactMap = new Map<number, { name?: string; email?: string }>();

  if (Number.isFinite(singleContactId) && singleContactId > 0) {
    contactMap.set(singleContactId, {});
  } else {
    contactMap = await fetchContactIdsFromSupabase(supabase);
  }

  const allContactIds = [...contactMap.keys()].sort((a, b) => a - b);
  const totalContacts = allContactIds.length;
  const batchIds =
    Number.isFinite(singleContactId) && singleContactId > 0
      ? [singleContactId]
      : allContactIds.slice(offset, offset + limit);

  for (let i = 0; i < batchIds.length; i++) {
    const contactId = batchIds[i];
    const hint = contactMap.get(contactId);
    const result = await syncContactInvoices(baseUrl, apiToken, wsToken, supabase, contactId, hint, errors);
    syncedInvoices += result.invoices;
    insertedOrUpdated += result.upserted;
    if (i < batchIds.length - 1) {
      await sleep(CONTACT_REQUEST_DELAY_MS);
    }
  }

  const isSingle = Number.isFinite(singleContactId) && singleContactId > 0;
  const nextOffset = offset + batchIds.length;
  const hasMore = !isSingle && nextOffset < totalContacts;

  return jsonResponse({
    success: true,
    syncedContacts: batchIds.length,
    syncedInvoices,
    insertedOrUpdated,
    errors,
    offset,
    limit,
    totalContacts,
    nextOffset: hasMore ? nextOffset : null,
    hasMore,
  });
});
