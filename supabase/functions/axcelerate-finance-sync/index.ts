// Sync aXcelerate invoices + payment records into Supabase (upsert only; batched).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

type FinanceSyncSupabase = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_CONTACT_LIMIT = 12;
const MAX_CONTACT_LIMIT = 25;
const CONTACT_REQUEST_DELAY_MS = 280;

const PAYMENT_ENDPOINT_CANDIDATES = [
  '/accounting/transaction/',
  '/accounting/payment/',
  '/accounting/receipt/',
] as const;

const PAYMENT_UNAVAILABLE_WARNING =
  'Payment date endpoint not available. Invoice paid status is synced, but actual payment date/time is unavailable.';

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
  last_payment_date: string | null;
  first_payment_date: string | null;
  payment_count: number;
  payment_method: string | null;
  raw_json: Record<string, unknown>;
};

type AxPaymentRow = {
  payment_id: string;
  invoice_id: number | null;
  invoice_number: string | null;
  contact_id: number | null;
  student_name: string | null;
  payment_date: string | null;
  payment_amount: number;
  payment_method: string | null;
  reference: string | null;
  raw_json: Record<string, unknown>;
};

type PaymentEndpointState = {
  path: string | null;
  checked: boolean;
  warning: string | null;
};

type SyncContactResult = {
  invoices: number;
  upserted: number;
  payments: number;
  paymentsUpserted: number;
  matchedPayments: number;
  unmatchedPayments: number;
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

function parseIsoDateTime(value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;

  const isoDateTime = v.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoDateTime) {
    const sec = isoDateTime[6] ?? '00';
    return `${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}T${isoDateTime[4]}:${isoDateTime[5]}:${sec}Z`;
  }

  const dmyTime = v.match(/^(\d{2})[-/](\d{2})[-/](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (dmyTime) {
    const sec = dmyTime[6] ?? '00';
    return `${dmyTime[3]}-${dmyTime[2]}-${dmyTime[1]}T${dmyTime[4]}:${dmyTime[5]}:${sec}Z`;
  }

  const dateOnly = parseIsoDate(v);
  if (dateOnly) return `${dateOnly}T00:00:00Z`;

  const parsed = Date.parse(v);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();

  return null;
}

function parseBool(v: unknown): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function parseRecordList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
  }
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const candidates = [
    obj.DATA,
    obj.data,
    obj.invoices,
    obj.INVOICES,
    obj.transactions,
    obj.TRANSACTIONS,
    obj.payments,
    obj.PAYMENTS,
    obj.receipts,
    obj.RECEIPTS,
    obj.rows,
    obj.ROWS,
  ];
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

function isSuccessfulJsonArray(payload: unknown): boolean {
  return parseRecordList(payload).length > 0;
}

type PaymentFragment = {
  invoiceId: number;
  amount: number;
  fragmentId: string;
};

function parsePaymentFragments(raw: Record<string, unknown>): PaymentFragment[] {
  let fragmentsRaw = raw.FRAGMENTS ?? raw.fragments;
  if (typeof fragmentsRaw === 'string') {
    try {
      fragmentsRaw = JSON.parse(fragmentsRaw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(fragmentsRaw)) return [];

  const out: PaymentFragment[] = [];
  for (const item of fragmentsRaw) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const invoiceId = Number(pickField(obj, 'INVOICEID', 'invoiceID', 'invoiceid', 'InvoiceID'));
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) continue;
    out.push({
      invoiceId,
      amount: parseNumber(pickField(obj, 'AMOUNT', 'amount', 'ALLOCATEDAMOUNT')),
      fragmentId: pickField(obj, 'FRAGMENTID', 'fragmentid', 'ID') || String(invoiceId),
    });
  }
  return out;
}

function isMoneyReceivedTransaction(raw: Record<string, unknown>): boolean {
  const type = pickField(raw, 'TRANSACTIONTYPE', 'transactiontype').toLowerCase();
  if (!type) return true;
  return type.includes('money received') || type.includes('payment') || type.includes('receipt');
}

async function fetchTransactionDetail(
  baseUrl: string,
  apiToken: string,
  wsToken: string,
  contactId: number,
  transactionId: string,
  endpointPath: string
): Promise<Record<string, unknown> | null> {
  const paths = [
    `${endpointPath}?contactID=${contactId}&transactionID=${encodeURIComponent(transactionId)}`,
    `${endpointPath}?contactID=${contactId}&TRANSACTIONID=${encodeURIComponent(transactionId)}`,
  ];

  for (const path of paths) {
    const { ok, payload } = await axFetch(baseUrl, path, apiToken, wsToken);
    if (!ok) continue;

    const list = parseRecordList(payload);
    if (list.length === 0 && payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const single = payload as Record<string, unknown>;
      if (parsePaymentFragments(single).length > 0) return single;
    }

    const match =
      list.find((row) => pickField(row, 'TRANSACTIONID', 'transactionid') === transactionId) ?? list[0];
    if (match) return match;
  }

  return null;
}

function matchPaymentByAmount(paymentAmount: number, invoices: AxInvoiceRow[]): AxInvoiceRow | null {
  if (paymentAmount <= 0) return null;
  const candidates = invoices.filter((inv) => {
    if (inv.is_void || inv.is_cancelled) return false;
    const paidTarget = inv.paid_amount > 0 ? inv.paid_amount : inv.invoice_amount;
    return (
      Math.abs(paidTarget - paymentAmount) < 0.02 ||
      Math.abs(inv.invoice_amount - paymentAmount) < 0.02
    );
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function buildPaymentsFromTransaction(
  raw: Record<string, unknown>,
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  lookup: { byId: Map<number, AxInvoiceRow>; byNumber: Map<string, AxInvoiceRow> },
  invoices: AxInvoiceRow[],
  endpointPath: string
): AxPaymentRow[] {
  const fragments = parsePaymentFragments(raw);
  const paymentDateRaw = pickField(
    raw,
    'TRANSDATE',
    'PAYMENTDATE',
    'TRANSACTIONDATE',
    'DATERECEIVED',
    'RECEIPTDATE',
    'DATE',
    'transdate',
    'paymentdate',
    'transactiondate'
  );
  const paymentDate = parseIsoDateTime(paymentDateRaw);
  const paymentIdBase = pickField(raw, 'TRANSACTIONID', 'PAYMENTID', 'RECEIPTID', 'ID', 'transactionid');
  const paymentMethod =
    pickField(raw, 'PAYMENTMETHOD', 'METHOD', 'PAYMENTTYPE', 'paymentmethod', 'method', 'paymenttype') || null;
  const reference = pickField(raw, 'REFERENCE', 'REF', 'DESCRIPTION', 'DETAILS', 'reference') || null;
  const defaultAmount = parseNumber(
    pickField(raw, 'AMOUNT', 'PAYMENTAMOUNT', 'TRANSACTIONAMOUNT', 'RECEIPTAMOUNT', 'amount', 'paymentamount')
  );

  if (fragments.length > 0) {
    return fragments.map((frag) => {
      const matched = lookup.byId.get(frag.invoiceId) ?? null;
      const amount = frag.amount > 0 ? frag.amount : defaultAmount;
      return {
        payment_id: `${paymentIdBase || 'tx'}:${frag.fragmentId}`,
        invoice_id: frag.invoiceId,
        invoice_number: matched?.invoice_number ?? null,
        contact_id: contactId,
        student_name: matched?.student_name ?? hint?.name ?? null,
        payment_date: paymentDate,
        payment_amount: amount,
        payment_method: paymentMethod,
        reference,
        raw_json: { ...raw, _endpoint: endpointPath, _fragmentInvoiceId: frag.invoiceId },
      };
    });
  }

  const matched =
    matchPaymentToInvoice(raw, lookup) ?? matchPaymentByAmount(defaultAmount, invoices);
  const normalized = normalizePayment(raw, contactId, hint, matched, endpointPath);
  return normalized ? [normalized] : [];
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
    last_payment_date: null,
    first_payment_date: null,
    payment_count: 0,
    payment_method: null,
    raw_json: raw,
  };
}

function buildInvoiceLookup(invoices: AxInvoiceRow[]) {
  const byId = new Map<number, AxInvoiceRow>();
  const byNumber = new Map<string, AxInvoiceRow>();
  for (const inv of invoices) {
    byId.set(inv.invoice_id, inv);
    if (inv.invoice_number) {
      byNumber.set(inv.invoice_number.toLowerCase(), inv);
      byNumber.set(inv.invoice_number.replace(/^0+/, '').toLowerCase(), inv);
    }
  }
  return { byId, byNumber };
}

function matchPaymentToInvoice(
  raw: Record<string, unknown>,
  lookup: { byId: Map<number, AxInvoiceRow>; byNumber: Map<string, AxInvoiceRow> }
): AxInvoiceRow | null {
  const invoiceIdRaw = pickField(raw, 'INVOICEID', 'invoiceID', 'invoiceid', 'INVOICE_ID', 'invoice_id');
  const invoiceId = Number(invoiceIdRaw);
  if (Number.isFinite(invoiceId) && invoiceId > 0 && lookup.byId.has(invoiceId)) {
    return lookup.byId.get(invoiceId) ?? null;
  }

  const invoiceNo = pickField(raw, 'INVOICENR', 'INVOICENO', 'INVOICENUMBER', 'invoiceNumber', 'invoice_number');
  if (invoiceNo) {
    const key = invoiceNo.toLowerCase();
    if (lookup.byNumber.has(key)) return lookup.byNumber.get(key) ?? null;
    const trimmed = invoiceNo.replace(/^0+/, '').toLowerCase();
    if (lookup.byNumber.has(trimmed)) return lookup.byNumber.get(trimmed) ?? null;
  }

  const reference = pickField(raw, 'REFERENCE', 'REF', 'DESCRIPTION', 'DETAILS', 'reference');
  if (reference) {
    const refKey = reference.toLowerCase();
    const refTrim = reference.replace(/^0+/, '').toLowerCase();
    if (lookup.byNumber.has(refKey)) return lookup.byNumber.get(refKey) ?? null;
    if (lookup.byNumber.has(refTrim)) return lookup.byNumber.get(refTrim) ?? null;

    for (const inv of lookup.byId.values()) {
      if (!inv.invoice_number) continue;
      const num = inv.invoice_number.toLowerCase();
      const numTrim = inv.invoice_number.replace(/^0+/, '').toLowerCase();
      if (refKey === num || refTrim === numTrim) return inv;
      if (reference.toLowerCase().includes(num) || num.includes(refKey)) return inv;
    }
  }

  return null;
}

function normalizePayment(
  raw: Record<string, unknown>,
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  matchedInvoice: AxInvoiceRow | null,
  endpointPath: string
): AxPaymentRow | null {
  const paymentIdRaw = pickField(
    raw,
    'TRANSACTIONID',
    'PAYMENTID',
    'RECEIPTID',
    'ID',
    'transactionid',
    'paymentid',
    'receiptid'
  );
  const paymentDateRaw = pickField(
    raw,
    'TRANSDATE',
    'PAYMENTDATE',
    'TRANSACTIONDATE',
    'DATERECEIVED',
    'RECEIPTDATE',
    'DATE',
    'transdate',
    'paymentdate',
    'transactiondate'
  );
  const paymentDate = parseIsoDateTime(paymentDateRaw);
  const paymentAmount = parseNumber(
    pickField(raw, 'AMOUNT', 'PAYMENTAMOUNT', 'TRANSACTIONAMOUNT', 'RECEIPTAMOUNT', 'amount', 'paymentamount')
  );

  const paymentId =
    paymentIdRaw ||
    `${endpointPath}:${contactId}:${matchedInvoice?.invoice_id ?? 'unmatched'}:${paymentDate ?? 'nodate'}:${paymentAmount}`;

  return {
    payment_id: paymentId,
    invoice_id: matchedInvoice?.invoice_id ?? null,
    invoice_number:
      matchedInvoice?.invoice_number ?? (pickField(raw, 'INVOICENR', 'INVOICENO', 'INVOICENUMBER') || null),
    contact_id: contactId,
    student_name: matchedInvoice?.student_name ?? hint?.name ?? null,
    payment_date: paymentDate,
    payment_amount: paymentAmount,
    payment_method:
      pickField(raw, 'PAYMENTMETHOD', 'METHOD', 'PAYMENTTYPE', 'paymentmethod', 'method', 'paymenttype') || null,
    reference: pickField(raw, 'REFERENCE', 'REF', 'DESCRIPTION', 'DETAILS', 'reference') || null,
    raw_json: { ...raw, _endpoint: endpointPath },
  };
}

type PaymentAggregate = {
  first: string;
  last: string;
  count: number;
  sum: number;
  latestMethod: string | null;
  latestDate: string;
};

function aggregatePaymentsByInvoice(payments: AxPaymentRow[]): Map<number, PaymentAggregate> {
  const map = new Map<number, PaymentAggregate>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    const existing = map.get(p.invoice_id);
    const date = p.payment_date ?? '';
    if (!existing) {
      map.set(p.invoice_id, {
        first: date,
        last: date,
        count: 1,
        sum: p.payment_amount,
        latestMethod: p.payment_method,
        latestDate: date,
      });
      continue;
    }
    existing.count += 1;
    existing.sum += p.payment_amount;
    if (date && (!existing.first || date < existing.first)) existing.first = date;
    if (date && (!existing.last || date > existing.last)) {
      existing.last = date;
      existing.latestDate = date;
      existing.latestMethod = p.payment_method;
    }
  }
  return map;
}

function applyPaymentAggregates(invoices: AxInvoiceRow[], aggregates: Map<number, PaymentAggregate>): AxInvoiceRow[] {
  return invoices.map((inv) => {
    const agg = aggregates.get(inv.invoice_id);
    if (!agg || agg.count === 0) return inv;
    return {
      ...inv,
      first_payment_date: agg.first || null,
      last_payment_date: agg.last || null,
      payment_count: agg.count,
      payment_method: agg.latestMethod,
      paid_amount: agg.sum > 0 ? agg.sum : inv.paid_amount,
    };
  });
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

async function resolvePaymentEndpoint(
  baseUrl: string,
  apiToken: string,
  wsToken: string,
  contactId: number,
  state: PaymentEndpointState
): Promise<PaymentEndpointState> {
  if (state.checked) return state;

  for (const candidate of PAYMENT_ENDPOINT_CANDIDATES) {
    const { ok, payload } = await axFetch(
      baseUrl,
      `${candidate}?contactID=${contactId}`,
      apiToken,
      wsToken
    );
    if (ok && isSuccessfulJsonArray(payload)) {
      return { path: candidate, checked: true, warning: null };
    }
  }

  return { path: null, checked: true, warning: PAYMENT_UNAVAILABLE_WARNING };
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
  errors: string[],
  paymentEndpointState: PaymentEndpointState
): Promise<{ result: SyncContactResult; paymentEndpointState: PaymentEndpointState }> {
  const empty: SyncContactResult = {
    invoices: 0,
    upserted: 0,
    payments: 0,
    paymentsUpserted: 0,
    matchedPayments: 0,
    unmatchedPayments: 0,
  };

  const { ok, status, payload } = await axFetch(
    baseUrl,
    `/accounting/invoice/?contactID=${contactId}`,
    apiToken,
    wsToken
  );

  if (!ok) {
    errors.push(`contact ${contactId}: invoice fetch failed (${status})`);
    return { result: empty, paymentEndpointState };
  }

  const invoiceRecords = parseRecordList(payload);
  const upsertRows: AxInvoiceRow[] = [];
  for (const inv of invoiceRecords) {
    const normalized = normalizeInvoice(inv, hint);
    if (normalized) upsertRows.push(normalized);
  }

  if (upsertRows.length === 0) {
    return { result: { ...empty, invoices: invoiceRecords.length }, paymentEndpointState };
  }

  const endpointState = await resolvePaymentEndpoint(baseUrl, apiToken, wsToken, contactId, paymentEndpointState);
  const lookup = buildInvoiceLookup(upsertRows);
  const paymentRows: AxPaymentRow[] = [];
  let matchedPayments = 0;
  let unmatchedPayments = 0;

  if (endpointState.path) {
    const paymentFetch = await axFetch(
      baseUrl,
      `${endpointState.path}?contactID=${contactId}`,
      apiToken,
      wsToken
    );

    if (paymentFetch.ok) {
      const paymentRecords = parseRecordList(paymentFetch.payload);
      for (const record of paymentRecords) {
        if (!isMoneyReceivedTransaction(record)) continue;

        let enriched = record;
        if (parsePaymentFragments(record).length === 0) {
          const txId = pickField(record, 'TRANSACTIONID', 'transactionid');
          if (txId) {
            const detail = await fetchTransactionDetail(
              baseUrl,
              apiToken,
              wsToken,
              contactId,
              txId,
              endpointState.path
            );
            if (detail) enriched = { ...record, ...detail };
            await sleep(120);
          }
        }

        const rows = buildPaymentsFromTransaction(
          enriched,
          contactId,
          hint,
          lookup,
          upsertRows,
          endpointState.path
        );
        for (const row of rows) {
          paymentRows.push(row);
          if (row.invoice_id) matchedPayments += 1;
          else unmatchedPayments += 1;
        }
      }
    } else {
      errors.push(`contact ${contactId}: payment fetch failed (${paymentFetch.status})`);
    }
  }

  const aggregates = aggregatePaymentsByInvoice(paymentRows);
  const invoicesWithPayments = applyPaymentAggregates(upsertRows, aggregates);

  const { error: upsertError } = await supabase.from('ax_invoices').upsert(invoicesWithPayments, {
    onConflict: 'invoice_id',
  });

  if (upsertError) {
    errors.push(`contact ${contactId}: invoice upsert failed (${upsertError.message})`);
    return { result: { ...empty, invoices: invoiceRecords.length }, paymentEndpointState: endpointState };
  }

  let paymentsUpserted = 0;
  if (paymentRows.length > 0) {
    const { error: paymentUpsertError } = await supabase.from('ax_invoice_payments').upsert(paymentRows, {
      onConflict: 'payment_id',
    });
    if (paymentUpsertError) {
      errors.push(`contact ${contactId}: payment upsert failed (${paymentUpsertError.message})`);
    } else {
      paymentsUpserted = paymentRows.length;
    }
  }

  return {
    result: {
      invoices: invoiceRecords.length,
      upserted: invoicesWithPayments.length,
      payments: paymentRows.length,
      paymentsUpserted,
      matchedPayments,
      unmatchedPayments,
    },
    paymentEndpointState: endpointState,
  };
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
  let syncedPayments = 0;
  let matchedPaymentCount = 0;
  let unmatchedPaymentCount = 0;
  let paymentEndpointState: PaymentEndpointState = { path: null, checked: false, warning: null };

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
    const { result, paymentEndpointState: nextState } = await syncContactInvoices(
      baseUrl,
      apiToken,
      wsToken,
      supabase,
      contactId,
      hint,
      errors,
      paymentEndpointState
    );
    paymentEndpointState = nextState;
    syncedInvoices += result.invoices;
    insertedOrUpdated += result.upserted;
    syncedPayments += result.paymentsUpserted;
    matchedPaymentCount += result.matchedPayments;
    unmatchedPaymentCount += result.unmatchedPayments;
    if (i < batchIds.length - 1) {
      await sleep(CONTACT_REQUEST_DELAY_MS);
    }
  }

  if (paymentEndpointState.warning && !errors.includes(paymentEndpointState.warning)) {
    errors.push(paymentEndpointState.warning);
  }

  const isSingle = Number.isFinite(singleContactId) && singleContactId > 0;
  const nextOffset = offset + batchIds.length;
  const hasMore = !isSingle && nextOffset < totalContacts;

  return jsonResponse({
    success: true,
    syncedContacts: batchIds.length,
    syncedInvoices,
    insertedOrUpdated,
    syncedPayments,
    matchedPaymentCount,
    unmatchedPaymentCount,
    paymentEndpointUsed: paymentEndpointState.path,
    paymentEndpointWarning: paymentEndpointState.warning,
    errors,
    offset,
    limit,
    totalContacts,
    nextOffset: hasMore ? nextOffset : null,
    hasMore,
  });
});
