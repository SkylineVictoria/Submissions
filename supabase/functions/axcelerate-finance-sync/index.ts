// Sync aXcelerate invoices + payment records into Supabase (upsert only; batched).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { backfillInvoicePaymentAllocations } from './paymentAllocations.ts';
import {
  emptyLedgerAggregate,
  mergeLedgerAggregate,
  syncContactLedger,
  type LedgerEndpointState,
} from './ledgerSync.ts';

type FinanceSyncSupabase = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_CONTACT_LIMIT = 5;
const MAX_CONTACT_LIMIT = 8;
const CONTACT_REQUEST_DELAY_MS = 180;
const MAX_SYNC_DATE_RANGE_DAYS = 365;
const MAX_TX_DETAIL_FETCHES_PER_CONTACT = 12;
const PAYMENT_MAX_PAGES_BATCH = 8;

const PAYMENT_ENDPOINT_CANDIDATES = [
  '/accounting/transaction/',
  '/accounting/payment/',
  '/accounting/receipt/',
] as const;

const PAYMENT_UNAVAILABLE_WARNING =
  'Payment date endpoint not available. Invoice paid status is synced, but actual payment date/time is unavailable.';

const PAYMENT_PAGE_LIMIT = 100;
const PAYMENT_MAX_PAGES = 50;

type SyncRequestBody = {
  contactID?: string | number;
  offset?: number;
  limit?: number;
  syncMode?: string;
  dateFrom?: string;
  dateTo?: string;
  /** When true, sync invoices only (skip per-contact payment pagination). */
  invoicesOnly?: boolean;
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
  transaction_id: string | null;
  invoice_id: number | null;
  invoice_number: string | null;
  contact_id: number | null;
  student_name: string | null;
  payment_date: string | null;
  transaction_date: string | null;
  payment_amount: number;
  payment_method: string | null;
  transaction_type: string | null;
  reference: string | null;
  unapplied_amount: number;
  user_full_name: string | null;
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
  paymentsWithDate: number;
  paymentsWithoutDate: number;
  sampleRawKeys: string[];
  sampleDateValues: Record<string, string>;
  paymentPagesFetched: number;
  paymentRawRecordsFetched: number;
  paymentUniqueRecordsFetched: number;
  paymentDuplicateRecordsSkipped: number;
  hadPaymentRecords: boolean;
  sampleFetchUrls: string[];
};

type PaymentFetchResult = {
  records: Record<string, unknown>[];
  pagesFetched: number;
  rawRecordsFetched: number;
  uniqueRecordsFetched: number;
  duplicateRecordsSkipped: number;
  sampleFetchUrls: string[];
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
    const variants = [
      key,
      key.toLowerCase(),
      key.replace(/[.\s_]/g, '').toLowerCase(),
      key.replace(/\s+/g, '').toLowerCase(),
    ];
    for (const k of variants) {
      const v = map.get(k);
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

const PAYMENT_DATE_FIELD_KEYS = [
  'TRANSDATE',
  'transdate',
  'TRANSACTIONDATE',
  'transactiondate',
  'PAYMENTDATE',
  'paymentdate',
  'DATERECEIVED',
  'datereceived',
  'RECEIPTDATE',
  'receiptdate',
  'DATE',
  'date',
] as const;

const TRANSACTION_ID_FIELD_KEYS = [
  'TRANSACTIONID',
  'transactionid',
  'PAYMENTID',
  'paymentid',
  'RECEIPTID',
  'receiptid',
  'ID',
  'id',
] as const;

const TRANSACTION_TYPE_FIELD_KEYS = [
  'TRANSACTIONTYPE',
  'transactiontype',
  'TYPE',
  'type',
] as const;

const PAYMENT_METHOD_FIELD_KEYS = [
  'PAYMENTMETHOD',
  'paymentmethod',
  'METHOD',
  'method',
  'PAYMENTTYPE',
  'paymenttype',
] as const;

const USER_FULL_NAME_FIELD_KEYS = [
  'USERFULLNAME',
  'User Full Name',
  'userfullname',
  'CREATEDBY',
  'createdby',
  'STAFFNAME',
  'staffname',
] as const;

const UNAPPLIED_AMOUNT_FIELD_KEYS = [
  'UNAPPLIEDAMOUNT',
  'unappliedamount',
  'UNASSIGNEDAMOUNT',
  'unassignedamount',
] as const;

const PAYMENT_AMOUNT_FIELD_KEYS = [
  'SIGNEDAMOUNT',
  'signedamount',
  'AMOUNT',
  'amount',
  'PAYMENTAMOUNT',
  'paymentamount',
  'TRANSACTIONAMOUNT',
  'transactionamount',
  'RECEIPTAMOUNT',
  'receiptamount',
] as const;

function extractPaymentDateIso(raw: Record<string, unknown>): string | null {
  const paymentDateRaw = pickField(raw, ...PAYMENT_DATE_FIELD_KEYS);
  return parseIsoDateTime(paymentDateRaw);
}

function extractTransactionId(raw: Record<string, unknown>): string | null {
  const id = pickField(raw, ...TRANSACTION_ID_FIELD_KEYS);
  return id || null;
}

function extractPaymentAmount(raw: Record<string, unknown>): number {
  return Math.abs(parseNumber(pickField(raw, ...PAYMENT_AMOUNT_FIELD_KEYS)));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim());
}

function clampSyncDateRange(
  dateFrom: string,
  dateTo: string
): { dateFrom: string; dateTo: string; clamped: boolean } {
  const from = dateFrom.trim();
  const to = dateTo.trim();
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
    return { dateFrom: from, dateTo: to, clamped: false };
  }
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T23:59:59Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { dateFrom: from, dateTo: to, clamped: false };
  }
  const maxSpanMs = MAX_SYNC_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (toMs - fromMs <= maxSpanMs) {
    return { dateFrom: from, dateTo: to, clamped: false };
  }
  const clampedFromMs = toMs - maxSpanMs;
  const clampedFrom = new Date(clampedFromMs).toISOString().slice(0, 10);
  return { dateFrom: clampedFrom, dateTo: to, clamped: true };
}

function defaultSyncDateRange(): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - MAX_SYNC_DATE_RANGE_DAYS);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
}

function paymentRecordDay(record: Record<string, unknown>): string | null {
  const iso = extractPaymentDateIso(record);
  return iso ? iso.slice(0, 10) : null;
}

function isPaymentRecordInRange(
  record: Record<string, unknown>,
  dateFrom: string,
  dateTo: string
): boolean {
  const day = paymentRecordDay(record);
  if (!day) return true;
  if (dateFrom && day < dateFrom) return false;
  if (dateTo && day > dateTo) return false;
  return true;
}

function recordHasPaymentDateOnList(record: Record<string, unknown>): boolean {
  return Boolean(extractPaymentDateIso(record));
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

function paymentRecordDedupeKey(record: Record<string, unknown>): string {
  const txId = pickField(record, 'TRANSACTIONID', 'transactionid', 'PAYMENTID', 'paymentid', 'RECEIPTID', 'receiptid', 'ID');
  if (txId) return `tx:${txId}`;
  const contactId = pickField(record, 'CONTACTID', 'contactID', 'contactid');
  const date = pickField(record, ...PAYMENT_DATE_FIELD_KEYS);
  const amount = pickField(record, ...PAYMENT_AMOUNT_FIELD_KEYS);
  const ref = pickField(record, 'REFERENCE', 'REF', 'reference');
  return `fallback:${contactId}:${date}:${amount}:${ref}`;
}

function sanitizeFetchUrlForDebug(baseUrl: string, path: string): string {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`.replace(/apitoken=[^&]+/gi, 'apitoken=***');
}

async function fetchPaymentPage(
  baseUrl: string,
  apiToken: string,
  wsToken: string,
  path: string
): Promise<{ ok: boolean; payload: unknown }> {
  const { ok, payload } = await axFetch(baseUrl, path, apiToken, wsToken);
  return { ok, payload };
}

async function fetchAllPaymentRecordsForContact(
  baseUrl: string,
  apiToken: string,
  wsToken: string,
  contactId: number,
  endpointPath: string,
  maxPages = PAYMENT_MAX_PAGES
): Promise<PaymentFetchResult> {
  const sampleFetchUrls: string[] = [];

  const pagingStrategies: Array<(pageIndex: number) => string> = [
    (pageIndex) => {
      const offset = pageIndex * PAYMENT_PAGE_LIMIT;
      return `${endpointPath}?contactID=${contactId}&offset=${offset}&limit=${PAYMENT_PAGE_LIMIT}`;
    },
    (pageIndex) => {
      const start = pageIndex * PAYMENT_PAGE_LIMIT;
      return `${endpointPath}?contactID=${contactId}&start=${start}&length=${PAYMENT_PAGE_LIMIT}`;
    },
    (pageIndex) => {
      const page = pageIndex + 1;
      return `${endpointPath}?contactID=${contactId}&page=${page}&pageSize=${PAYMENT_PAGE_LIMIT}`;
    },
  ];

  let best: PaymentFetchResult = {
    records: [],
    pagesFetched: 0,
    rawRecordsFetched: 0,
    uniqueRecordsFetched: 0,
    duplicateRecordsSkipped: 0,
    sampleFetchUrls,
  };

  for (const buildPath of pagingStrategies) {
    const seen = new Set<string>();
    const strategyRecords: Record<string, unknown>[] = [];
    let pagesFetched = 0;
    let rawRecordsFetched = 0;
    let duplicateRecordsSkipped = 0;
    let stalePageDetected = false;

    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
      const path = buildPath(pageIndex);
      if (sampleFetchUrls.length < 5) sampleFetchUrls.push(sanitizeFetchUrlForDebug(baseUrl, path));
      const { ok, payload } = await fetchPaymentPage(baseUrl, apiToken, wsToken, path);
      if (!ok) break;
      const batch = parseRecordList(payload);
      pagesFetched += 1;
      rawRecordsFetched += batch.length;

      const uniqueBefore = seen.size;
      for (const record of batch) {
        const key = paymentRecordDedupeKey(record);
        if (seen.has(key)) duplicateRecordsSkipped += 1;
        else {
          seen.add(key);
          strategyRecords.push(record);
        }
      }

      if (pageIndex > 0 && batch.length > 0 && seen.size === uniqueBefore) {
        stalePageDetected = true;
        break;
      }

      if (batch.length === 0) break;
      if (batch.length < PAYMENT_PAGE_LIMIT) break;
      await sleep(80);
    }

    if (strategyRecords.length === 0 || stalePageDetected) continue;

    const candidate: PaymentFetchResult = {
      records: strategyRecords,
      pagesFetched,
      rawRecordsFetched,
      uniqueRecordsFetched: strategyRecords.length,
      duplicateRecordsSkipped,
      sampleFetchUrls,
    };

    if (candidate.uniqueRecordsFetched > best.uniqueRecordsFetched) {
      best = candidate;
    }

    if (pagesFetched > 1 || candidate.uniqueRecordsFetched >= PAYMENT_PAGE_LIMIT) {
      break;
    }
  }

  if (best.records.length > 0) return best;

  const path = `${endpointPath}?contactID=${contactId}`;
  if (sampleFetchUrls.length < 5) sampleFetchUrls.push(sanitizeFetchUrlForDebug(baseUrl, path));
  const { ok, payload } = await fetchPaymentPage(baseUrl, apiToken, wsToken, path);
  if (!ok) return best;

  const batch = parseRecordList(payload);
  const seen = new Set<string>();
  const records: Record<string, unknown>[] = [];
  let duplicateRecordsSkipped = 0;
  for (const record of batch) {
    const key = paymentRecordDedupeKey(record);
    if (seen.has(key)) duplicateRecordsSkipped += 1;
    else {
      seen.add(key);
      records.push(record);
    }
  }

  return {
    records,
    pagesFetched: 1,
    rawRecordsFetched: batch.length,
    uniqueRecordsFetched: records.length,
    duplicateRecordsSkipped,
    sampleFetchUrls,
  };
}

async function tryFetchGlobalTransactionsByDateRange(
  baseUrl: string,
  apiToken: string,
  wsToken: string,
  dateFrom: string,
  dateTo: string
): Promise<{ records: Record<string, unknown>[]; endpointUsed: string | null; sampleFetchUrls: string[] }> {
  const dateParamSets = [
    `dateFrom=${dateFrom}&dateTo=${dateTo}`,
    `startDate=${dateFrom}&endDate=${dateTo}`,
    `fromDate=${dateFrom}&toDate=${dateTo}`,
  ];

  for (const endpointPath of PAYMENT_ENDPOINT_CANDIDATES) {
    for (const params of dateParamSets) {
      const seen = new Set<string>();
      const all: Record<string, unknown>[] = [];
      const sampleFetchUrls: string[] = [];
      let gotAny = false;

      for (let pageIndex = 0; pageIndex < PAYMENT_MAX_PAGES; pageIndex++) {
        const offset = pageIndex * PAYMENT_PAGE_LIMIT;
        const path = `${endpointPath}?${params}&offset=${offset}&limit=${PAYMENT_PAGE_LIMIT}`;
        if (sampleFetchUrls.length < 5) sampleFetchUrls.push(sanitizeFetchUrlForDebug(baseUrl, path));
        const { ok, payload } = await fetchPaymentPage(baseUrl, apiToken, wsToken, path);
        if (!ok) break;
        const batch = parseRecordList(payload);
        if (batch.length === 0 && pageIndex === 0) break;
        gotAny = gotAny || batch.length > 0;
        for (const record of batch) {
          const key = paymentRecordDedupeKey(record);
          if (seen.has(key)) continue;
          seen.add(key);
          all.push(record);
        }
        if (batch.length < PAYMENT_PAGE_LIMIT) break;
        await sleep(80);
      }

      if (gotAny && all.length > 0) {
        return { records: all, endpointUsed: `${endpointPath}?${params}`, sampleFetchUrls };
      }
    }
  }

  return { records: [], endpointUsed: null, sampleFetchUrls: [] };
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

function buildPaymentRow(
  raw: Record<string, unknown>,
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  matchedInvoice: AxInvoiceRow | null,
  endpointPath: string,
  overrides?: {
    paymentId?: string;
    invoiceId?: number | null;
    amount?: number;
  }
): AxPaymentRow {
  const transactionDate = extractPaymentDateIso(raw);
  const transactionId = extractTransactionId(raw);
  const paymentAmount = overrides?.amount ?? extractPaymentAmount(raw);
  const paymentId =
    overrides?.paymentId ||
    transactionId ||
    `${endpointPath}:${contactId}:${matchedInvoice?.invoice_id ?? overrides?.invoiceId ?? 'unmatched'}:${transactionDate ?? 'nodate'}:${paymentAmount}`;

  return {
    payment_id: paymentId,
    transaction_id: transactionId,
    invoice_id: overrides?.invoiceId ?? matchedInvoice?.invoice_id ?? null,
    invoice_number:
      matchedInvoice?.invoice_number ?? (pickField(raw, 'INVOICENR', 'INVOICENO', 'INVOICENUMBER') || null),
    contact_id: contactId,
    student_name: matchedInvoice?.student_name ?? hint?.name ?? null,
    payment_date: transactionDate,
    transaction_date: transactionDate,
    payment_amount: paymentAmount,
    payment_method: pickField(raw, ...PAYMENT_METHOD_FIELD_KEYS) || null,
    transaction_type: pickField(raw, ...TRANSACTION_TYPE_FIELD_KEYS) || null,
    reference: pickField(raw, 'REFERENCE', 'REF', 'DESCRIPTION', 'DETAILS', 'reference') || null,
    unapplied_amount: parseNumber(pickField(raw, ...UNAPPLIED_AMOUNT_FIELD_KEYS)),
    user_full_name: pickField(raw, ...USER_FULL_NAME_FIELD_KEYS) || null,
    raw_json: {
      ...raw,
      _endpoint: endpointPath,
      ...(overrides?.invoiceId != null ? { _fragmentInvoiceId: overrides.invoiceId } : {}),
    },
  };
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
  const transactionId = extractTransactionId(raw);
  const defaultAmount = extractPaymentAmount(raw);

  if (fragments.length > 0) {
    return fragments.map((frag) => {
      const matched = lookup.byId.get(frag.invoiceId) ?? null;
      const amount = frag.amount > 0 ? frag.amount : defaultAmount;
      return buildPaymentRow(raw, contactId, hint, matched, endpointPath, {
        paymentId: `${transactionId || 'tx'}:${frag.fragmentId}`,
        invoiceId: frag.invoiceId,
        amount,
      });
    });
  }

  const matched =
    matchPaymentToInvoice(raw, lookup) ?? matchPaymentByAmount(defaultAmount, invoices);
  const row = buildPaymentRow(raw, contactId, hint, matched, endpointPath);
  return row.payment_amount > 0 || row.invoice_id || transactionId ? [row] : [];
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

type PaymentAggregate = {
  first: string;
  last: string;
  count: number;
  sum: number;
  latestMethod: string | null;
  latestDate: string;
};

function paymentEffectiveDate(p: AxPaymentRow): string {
  return p.transaction_date ?? p.payment_date ?? '';
}

function aggregatePaymentsByInvoice(payments: AxPaymentRow[]): Map<number, PaymentAggregate> {
  const map = new Map<number, PaymentAggregate>();
  for (const p of payments) {
    if (!p.invoice_id) continue;
    const existing = map.get(p.invoice_id);
    const date = paymentEffectiveDate(p);
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
      // Keep invoice endpoint paid_amount — do not overwrite with transaction sum.
      paid_amount: inv.paid_amount,
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
): Promise<{
  map: Map<number, { name?: string; email?: string }>;
  totalContactIdsFromStudents: number;
  totalContactIdsFromInvoices: number;
  totalUniqueContactIdsToSync: number;
}> {
  const map = new Map<number, { name?: string; email?: string }>();
  let totalContactIdsFromStudents = 0;
  let totalContactIdsFromInvoices = 0;

  const { data: students } = await supabase
    .from('skyline_students')
    .select('student_id, name, email, status')
    .eq('status', 'active');

  for (const row of students ?? []) {
    const sid = String((row as { student_id?: string | null }).student_id ?? '').trim();
    const n = Number(sid);
    if (!Number.isFinite(n) || n <= 0) continue;
    totalContactIdsFromStudents += 1;
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
      totalContactIdsFromInvoices += 1;
      map.set(cid, {
        name: String((row as { student_name?: string }).student_name ?? '').trim() || undefined,
        email: String((row as { email?: string }).email ?? '').trim() || undefined,
      });
    }
  }

  const { data: paymentContacts } = await supabase
    .from('ax_invoice_payments')
    .select('contact_id, student_name')
    .not('contact_id', 'is', null);

  for (const row of paymentContacts ?? []) {
    const cid = Number((row as { contact_id?: number | null }).contact_id ?? 0);
    if (!Number.isFinite(cid) || cid <= 0) continue;
    if (!map.has(cid)) {
      totalContactIdsFromInvoices += 1;
      map.set(cid, {
        name: String((row as { student_name?: string }).student_name ?? '').trim() || undefined,
      });
    }
  }

  return {
    map,
    totalContactIdsFromStudents,
    totalContactIdsFromInvoices,
    totalUniqueContactIdsToSync: map.size,
  };
}

async function loadCachedInvoicesForContact(
  supabase: FinanceSyncSupabase,
  contactId: number
): Promise<AxInvoiceRow[]> {
  const { data } = await supabase
    .from('ax_invoices')
    .select(
      'invoice_id, invoice_number, contact_id, student_name, email, invoice_date, due_date, invoice_amount, paid_amount, balance, is_paid, is_void, is_cancelled, are_items_locked, course_name, agent_name, last_payment_date, first_payment_date, payment_count, payment_method, raw_json'
    )
    .eq('contact_id', contactId);

  return (data ?? []).map((row) => ({
    invoice_id: Number((row as { invoice_id: number }).invoice_id),
    invoice_number: (row as { invoice_number?: string | null }).invoice_number ?? null,
    contact_id: contactId,
    student_name: (row as { student_name?: string | null }).student_name ?? null,
    email: (row as { email?: string | null }).email ?? null,
    invoice_date: (row as { invoice_date?: string | null }).invoice_date ?? null,
    due_date: (row as { due_date?: string | null }).due_date ?? null,
    invoice_amount: parseNumber((row as { invoice_amount?: number }).invoice_amount),
    paid_amount: parseNumber((row as { paid_amount?: number }).paid_amount),
    balance: parseNumber((row as { balance?: number }).balance),
    is_paid: Boolean((row as { is_paid?: boolean }).is_paid),
    is_void: Boolean((row as { is_void?: boolean }).is_void),
    is_cancelled: Boolean((row as { is_cancelled?: boolean }).is_cancelled),
    are_items_locked: Boolean((row as { are_items_locked?: boolean }).are_items_locked),
    course_name: (row as { course_name?: string | null }).course_name ?? null,
    agent_name: (row as { agent_name?: string | null }).agent_name ?? null,
    last_payment_date: (row as { last_payment_date?: string | null }).last_payment_date ?? null,
    first_payment_date: (row as { first_payment_date?: string | null }).first_payment_date ?? null,
    payment_count: Number((row as { payment_count?: number }).payment_count ?? 0) || 0,
    payment_method: (row as { payment_method?: string | null }).payment_method ?? null,
    raw_json: ((row as { raw_json?: Record<string, unknown> }).raw_json ?? {}) as Record<string, unknown>,
  }));
}

async function processPaymentRecordsForContact(
  paymentRecords: Record<string, unknown>[],
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  lookup: { byId: Map<number, AxInvoiceRow>; byNumber: Map<string, AxInvoiceRow> },
  invoiceRowsForMatch: AxInvoiceRow[],
  endpointPath: string,
  baseUrl: string,
  apiToken: string,
  wsToken: string
): Promise<{
  paymentRows: AxPaymentRow[];
  matchedPayments: number;
  unmatchedPayments: number;
  paymentsWithDate: number;
  paymentsWithoutDate: number;
  sampleRawKeys: string[];
  sampleDateValues: Record<string, string>;
}> {
  const paymentRows: AxPaymentRow[] = [];
  let matchedPayments = 0;
  let unmatchedPayments = 0;
  let paymentsWithDate = 0;
  let paymentsWithoutDate = 0;
  let sampleRawKeys: string[] = [];
  const sampleDateValues: Record<string, string> = {};

  let detailFetches = 0;

  for (const record of paymentRecords) {
    if (!isMoneyReceivedTransaction(record)) continue;

    let enriched = record;
    if (parsePaymentFragments(record).length === 0 && !recordHasPaymentDateOnList(record)) {
      const txId = pickField(record, 'TRANSACTIONID', 'transactionid');
      if (txId && detailFetches < MAX_TX_DETAIL_FETCHES_PER_CONTACT) {
        const detail = await fetchTransactionDetail(baseUrl, apiToken, wsToken, contactId, txId, endpointPath);
        if (detail) enriched = { ...record, ...detail };
        detailFetches += 1;
        await sleep(80);
      }
    }

    const rows = buildPaymentsFromTransaction(
      enriched,
      contactId,
      hint,
      lookup,
      invoiceRowsForMatch,
      endpointPath
    );
    for (const row of rows) {
      paymentRows.push(row);
      if (row.invoice_id) matchedPayments += 1;
      else unmatchedPayments += 1;
      const effectiveDate = paymentEffectiveDate(row);
      if (effectiveDate) paymentsWithDate += 1;
      else paymentsWithoutDate += 1;
      if (sampleRawKeys.length === 0 && row.raw_json) {
        sampleRawKeys = Object.keys(row.raw_json).slice(0, 40);
        for (const key of PAYMENT_DATE_FIELD_KEYS) {
          const val = row.raw_json[key];
          if (val != null && String(val).trim() !== '') {
            sampleDateValues[key] = String(val);
          }
        }
      }
    }
  }

  return {
    paymentRows,
    matchedPayments,
    unmatchedPayments,
    paymentsWithDate,
    paymentsWithoutDate,
    sampleRawKeys,
    sampleDateValues,
  };
}

async function syncContactInvoices(
  baseUrl: string,
  apiToken: string,
  wsToken: string,
  supabase: FinanceSyncSupabase,
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  errors: string[],
  paymentEndpointState: PaymentEndpointState,
  options?: { invoicesOnly?: boolean; paymentDateFrom?: string; paymentDateTo?: string }
): Promise<{ result: SyncContactResult; paymentEndpointState: PaymentEndpointState }> {
  const empty: SyncContactResult = {
    invoices: 0,
    upserted: 0,
    payments: 0,
    paymentsUpserted: 0,
    matchedPayments: 0,
    unmatchedPayments: 0,
    paymentsWithDate: 0,
    paymentsWithoutDate: 0,
    sampleRawKeys: [],
    sampleDateValues: {},
    paymentPagesFetched: 0,
    paymentRawRecordsFetched: 0,
    paymentUniqueRecordsFetched: 0,
    paymentDuplicateRecordsSkipped: 0,
    hadPaymentRecords: false,
    sampleFetchUrls: [],
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

  const cachedInvoices = upsertRows.length === 0 ? await loadCachedInvoicesForContact(supabase, contactId) : [];
  const invoiceRowsForMatch = upsertRows.length > 0 ? upsertRows : cachedInvoices;

  const endpointState = await resolvePaymentEndpoint(baseUrl, apiToken, wsToken, contactId, paymentEndpointState);
  const lookup = buildInvoiceLookup(invoiceRowsForMatch);
  let paymentRows: AxPaymentRow[] = [];
  let matchedPayments = 0;
  let unmatchedPayments = 0;
  let paymentsWithDate = 0;
  let paymentsWithoutDate = 0;
  let sampleRawKeys: string[] = [];
  const sampleDateValues: Record<string, string> = {};
  let paymentPagesFetched = 0;
  let paymentRawRecordsFetched = 0;
  let paymentUniqueRecordsFetched = 0;
  let paymentDuplicateRecordsSkipped = 0;
  let hadPaymentRecords = false;
  let contactSampleFetchUrls: string[] = [];

  if (endpointState.path && !options?.invoicesOnly) {
    const paymentFetchResult = await fetchAllPaymentRecordsForContact(
      baseUrl,
      apiToken,
      wsToken,
      contactId,
      endpointState.path,
      PAYMENT_MAX_PAGES_BATCH
    );
    let paymentRecords = paymentFetchResult.records;
    if (options?.paymentDateFrom || options?.paymentDateTo) {
      paymentRecords = paymentRecords.filter((record) =>
        isPaymentRecordInRange(record, options.paymentDateFrom ?? '', options.paymentDateTo ?? '')
      );
    }
    paymentPagesFetched = paymentFetchResult.pagesFetched;
    paymentRawRecordsFetched = paymentFetchResult.rawRecordsFetched;
    paymentUniqueRecordsFetched = paymentFetchResult.uniqueRecordsFetched;
    paymentDuplicateRecordsSkipped = paymentFetchResult.duplicateRecordsSkipped;
    hadPaymentRecords = paymentFetchResult.records.length > 0;
    contactSampleFetchUrls = paymentFetchResult.sampleFetchUrls;

    if (paymentRecords.length > 0) {
      const processed = await processPaymentRecordsForContact(
        paymentRecords,
        contactId,
        hint,
        lookup,
        invoiceRowsForMatch,
        endpointState.path,
        baseUrl,
        apiToken,
        wsToken
      );
      paymentRows = processed.paymentRows;
      matchedPayments = processed.matchedPayments;
      unmatchedPayments = processed.unmatchedPayments;
      paymentsWithDate = processed.paymentsWithDate;
      paymentsWithoutDate = processed.paymentsWithoutDate;
      sampleRawKeys = processed.sampleRawKeys;
      Object.assign(sampleDateValues, processed.sampleDateValues);
    }
  }

  if (upsertRows.length === 0) {
    if (paymentRows.length > 0) {
      let paymentsUpserted = 0;
      const { error: paymentUpsertError } = await supabase.from('ax_invoice_payments').upsert(paymentRows, {
        onConflict: 'payment_id',
      });
      if (paymentUpsertError) {
        errors.push(`contact ${contactId}: payment upsert failed (${paymentUpsertError.message})`);
      } else {
        paymentsUpserted = paymentRows.length;
      }
      return {
        result: {
          ...empty,
          invoices: invoiceRecords.length,
          payments: paymentRows.length,
          paymentsUpserted,
          matchedPayments,
          unmatchedPayments,
          paymentsWithDate,
          paymentsWithoutDate,
          sampleRawKeys,
          sampleDateValues,
          paymentPagesFetched,
          paymentRawRecordsFetched,
          paymentUniqueRecordsFetched,
          paymentDuplicateRecordsSkipped,
          hadPaymentRecords,
          sampleFetchUrls: contactSampleFetchUrls,
        },
        paymentEndpointState: endpointState,
      };
    }
    return { result: { ...empty, invoices: invoiceRecords.length }, paymentEndpointState: endpointState };
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
      paymentsWithDate,
      paymentsWithoutDate,
      sampleRawKeys,
      sampleDateValues,
      paymentPagesFetched,
      paymentRawRecordsFetched,
      paymentUniqueRecordsFetched,
      paymentDuplicateRecordsSkipped,
      hadPaymentRecords,
      sampleFetchUrls: contactSampleFetchUrls,
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
  let paymentsWithDateCount = 0;
  let paymentsWithoutDateCount = 0;
  let samplePaymentRawKeys: string[] = [];
  let samplePaymentDateValues: Record<string, string> = {};
  let paymentPagesFetched = 0;
  let paymentRawRecordsFetched = 0;
  let paymentUniqueRecordsFetched = 0;
  let paymentDuplicateRecordsSkipped = 0;
  let contactsWithPaymentRecords = 0;
  let contactsWithoutPaymentRecords = 0;
  const samplePaymentFetchUrlsWithoutTokens: string[] = [];
  let totalContactIdsFromStudents = 0;
  let totalContactIdsFromInvoices = 0;
  let totalUniqueContactIdsToSync = 0;
  let paymentEndpointState: PaymentEndpointState = { path: null, checked: false, warning: null };

  const syncMode = String(body.syncMode ?? '').trim().toLowerCase();
  let syncDateFrom = typeof body.dateFrom === 'string' ? body.dateFrom.trim() : '';
  let syncDateTo = typeof body.dateTo === 'string' ? body.dateTo.trim() : '';
  const invoicesOnly = body.invoicesOnly === true || String(body.invoicesOnly ?? '').toLowerCase() === 'true';

  if (syncDateFrom && syncDateTo && isIsoDate(syncDateFrom) && isIsoDate(syncDateTo)) {
    const clamped = clampSyncDateRange(syncDateFrom, syncDateTo);
    syncDateFrom = clamped.dateFrom;
    syncDateTo = clamped.dateTo;
    if (clamped.clamped) {
      errors.push(`Date range capped to ${MAX_SYNC_DATE_RANGE_DAYS} days (1 year max).`);
    }
  }

  const defaultRange = defaultSyncDateRange();
  const paymentDateFrom = syncDateFrom || defaultRange.dateFrom;
  const paymentDateTo = syncDateTo || defaultRange.dateTo;

  if (syncMode === 'allocations_backfill') {
    const backfill = await backfillInvoicePaymentAllocations(supabase);
    if (backfill.errors.length) errors.push(...backfill.errors);
    return jsonResponse({
      success: backfill.success,
      syncMode: 'allocations_backfill',
      allocationBackfill: backfill.stats,
      syncedContacts: 0,
      syncedInvoices: 0,
      insertedOrUpdated: 0,
      syncedPayments: 0,
      matchedPaymentCount: 0,
      unmatchedPaymentCount: 0,
      errors,
      hasMore: false,
      nextOffset: null,
    });
  }

  if (syncMode === 'transactions_report' && syncDateFrom && syncDateTo) {
    const globalFetch = await tryFetchGlobalTransactionsByDateRange(
      baseUrl,
      apiToken,
      wsToken,
      syncDateFrom,
      syncDateTo
    );
    if (globalFetch.sampleFetchUrls.length > 0) {
      samplePaymentFetchUrlsWithoutTokens.push(...globalFetch.sampleFetchUrls.slice(0, 5));
    }

    if (globalFetch.records.length > 0 && globalFetch.endpointUsed) {
      paymentEndpointState = { path: globalFetch.endpointUsed.split('?')[0], checked: true, warning: null };
      paymentRawRecordsFetched = globalFetch.records.length;
      paymentUniqueRecordsFetched = globalFetch.records.length;
      paymentPagesFetched = 1;

      const { data: allCachedInvoices } = await supabase.from('ax_invoices').select('*');
      const cachedRows = (allCachedInvoices ?? []).map((row) => ({
        invoice_id: Number((row as { invoice_id: number }).invoice_id),
        invoice_number: (row as { invoice_number?: string | null }).invoice_number ?? null,
        contact_id: Number((row as { contact_id?: number | null }).contact_id ?? 0) || null,
        student_name: (row as { student_name?: string | null }).student_name ?? null,
        email: (row as { email?: string | null }).email ?? null,
        invoice_date: (row as { invoice_date?: string | null }).invoice_date ?? null,
        due_date: (row as { due_date?: string | null }).due_date ?? null,
        invoice_amount: parseNumber((row as { invoice_amount?: number }).invoice_amount),
        paid_amount: parseNumber((row as { paid_amount?: number }).paid_amount),
        balance: parseNumber((row as { balance?: number }).balance),
        is_paid: Boolean((row as { is_paid?: boolean }).is_paid),
        is_void: Boolean((row as { is_void?: boolean }).is_void),
        is_cancelled: Boolean((row as { is_cancelled?: boolean }).is_cancelled),
        are_items_locked: Boolean((row as { are_items_locked?: boolean }).are_items_locked),
        course_name: (row as { course_name?: string | null }).course_name ?? null,
        agent_name: (row as { agent_name?: string | null }).agent_name ?? null,
        last_payment_date: null,
        first_payment_date: null,
        payment_count: 0,
        payment_method: null,
        raw_json: ((row as { raw_json?: Record<string, unknown> }).raw_json ?? {}) as Record<string, unknown>,
      })) as AxInvoiceRow[];

      const lookup = buildInvoiceLookup(cachedRows);
      const allPaymentRows: AxPaymentRow[] = [];

      for (const record of globalFetch.records) {
        if (!isMoneyReceivedTransaction(record)) continue;
        const contactIdRaw = pickField(record, 'CONTACTID', 'contactID', 'contactid');
        const contactId = Number(contactIdRaw);
        if (!Number.isFinite(contactId) || contactId <= 0) continue;
        const rows = buildPaymentsFromTransaction(
          record,
          contactId,
          undefined,
          lookup,
          cachedRows,
          globalFetch.endpointUsed.split('?')[0]
        );
        allPaymentRows.push(...rows);
      }

      if (allPaymentRows.length > 0) {
        const { error: paymentUpsertError } = await supabase.from('ax_invoice_payments').upsert(allPaymentRows, {
          onConflict: 'payment_id',
        });
        if (paymentUpsertError) {
          errors.push(`global transactions sync: payment upsert failed (${paymentUpsertError.message})`);
        } else {
          syncedPayments = allPaymentRows.length;
          matchedPaymentCount = allPaymentRows.filter((r) => r.invoice_id).length;
          unmatchedPaymentCount = allPaymentRows.length - matchedPaymentCount;
          paymentsWithDateCount = allPaymentRows.filter((r) => paymentEffectiveDate(r)).length;
          paymentsWithoutDateCount = allPaymentRows.length - paymentsWithDateCount;
        }
      }

      const globalBackfill = await backfillInvoicePaymentAllocations(supabase);
      if (globalBackfill.errors.length) errors.push(...globalBackfill.errors);

      return jsonResponse({
        success: true,
        syncMode: 'transactions_report',
        globalTransactionEndpointUsed: globalFetch.endpointUsed,
        allocationBackfill: globalBackfill.stats,
        syncedContacts: 0,
        syncedInvoices: 0,
        insertedOrUpdated: 0,
        syncedPayments,
        matchedPaymentCount,
        unmatchedPaymentCount,
        paymentsWithDateCount,
        paymentsWithoutDateCount,
        paymentPagesFetched,
        paymentRawRecordsFetched,
        paymentUniqueRecordsFetched,
        paymentDuplicateRecordsSkipped,
        contactsWithPaymentRecords: globalFetch.records.length > 0 ? 1 : 0,
        contactsWithoutPaymentRecords: globalFetch.records.length > 0 ? 0 : 1,
        samplePaymentFetchUrlsWithoutTokens,
        paymentEndpointUsed: paymentEndpointState.path,
        paymentEndpointWarning: null,
        errors,
        hasMore: false,
        nextOffset: null,
      });
    }

    errors.push(
      `Global transactions_report sync for ${syncDateFrom}..${syncDateTo} returned no records; falling back to per-contact sync may be incomplete.`
    );
  }

  const singleContactRaw = body.contactID != null ? String(body.contactID).trim() : '';
  const singleContactId = singleContactRaw ? Number(singleContactRaw) : NaN;

  const offset = Math.max(0, Number(body.offset ?? 0) || 0);
  const limitRaw = Number(body.limit ?? DEFAULT_CONTACT_LIMIT) || DEFAULT_CONTACT_LIMIT;
  const limit = Math.min(Math.max(1, limitRaw), MAX_CONTACT_LIMIT);

  let contactMap = new Map<number, { name?: string; email?: string }>();

  if (Number.isFinite(singleContactId) && singleContactId > 0) {
    contactMap.set(singleContactId, {});
    totalUniqueContactIdsToSync = 1;
  } else {
    const contactStats = await fetchContactIdsFromSupabase(supabase);
    contactMap = contactStats.map;
    totalContactIdsFromStudents = contactStats.totalContactIdsFromStudents;
    totalContactIdsFromInvoices = contactStats.totalContactIdsFromInvoices;
    totalUniqueContactIdsToSync = contactStats.totalUniqueContactIdsToSync;
  }

  const allContactIds = [...contactMap.keys()].sort((a, b) => a - b);
  const totalContacts = allContactIds.length;
  const batchIds =
    Number.isFinite(singleContactId) && singleContactId > 0
      ? [singleContactId]
      : allContactIds.slice(offset, offset + limit);

  let ledgerEndpointState: LedgerEndpointState = { path: null, checked: false, warning: null };
  const ledgerAggregate = emptyLedgerAggregate(null);

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
      paymentEndpointState,
      invoicesOnly
        ? { invoicesOnly: true }
        : {
            paymentDateFrom,
            paymentDateTo,
          }
    );
    paymentEndpointState = nextState;
    syncedInvoices += result.invoices;
    insertedOrUpdated += result.upserted;
    syncedPayments += result.paymentsUpserted;
    matchedPaymentCount += result.matchedPayments;
    unmatchedPaymentCount += result.unmatchedPayments;
    paymentsWithDateCount += result.paymentsWithDate;
    paymentsWithoutDateCount += result.paymentsWithoutDate;
    if (samplePaymentRawKeys.length === 0 && result.sampleRawKeys.length > 0) {
      samplePaymentRawKeys = result.sampleRawKeys;
      samplePaymentDateValues = result.sampleDateValues;
    }
    paymentPagesFetched += result.paymentPagesFetched;
    paymentRawRecordsFetched += result.paymentRawRecordsFetched;
    paymentUniqueRecordsFetched += result.paymentUniqueRecordsFetched;
    paymentDuplicateRecordsSkipped += result.paymentDuplicateRecordsSkipped;
    if (result.hadPaymentRecords) contactsWithPaymentRecords += 1;
    else contactsWithoutPaymentRecords += 1;
    for (const url of result.sampleFetchUrls) {
      if (samplePaymentFetchUrlsWithoutTokens.length < 5 && !samplePaymentFetchUrlsWithoutTokens.includes(url)) {
        samplePaymentFetchUrlsWithoutTokens.push(url);
      }
    }

    const axFetchForLedger = (path: string) => axFetch(baseUrl, path, apiToken, wsToken);
    const { result: ledgerResult, endpointState: nextLedgerState } = await syncContactLedger(
      axFetchForLedger,
      supabase,
      contactId,
      hint,
      errors,
      ledgerEndpointState
    );
    ledgerEndpointState = nextLedgerState;
    mergeLedgerAggregate(ledgerAggregate, ledgerResult, ledgerEndpointState.path);

    if (i < batchIds.length - 1) {
      await sleep(CONTACT_REQUEST_DELAY_MS);
    }
  }

  if (paymentEndpointState.warning && !errors.includes(paymentEndpointState.warning)) {
    errors.push(paymentEndpointState.warning);
  }
  if (ledgerEndpointState.warning && ledgerAggregate.ledgerRowsFetched === 0) {
    ledgerAggregate.ledgerEndpointWarning = ledgerEndpointState.warning;
    if (ledgerEndpointState.warning && !errors.includes(ledgerEndpointState.warning)) {
      errors.push(ledgerEndpointState.warning);
    }
  }

  const isSingle = Number.isFinite(singleContactId) && singleContactId > 0;
  const nextOffset = offset + batchIds.length;
  const hasMore = !isSingle && nextOffset < totalContacts;

  let allocationBackfill = null;
  if (!hasMore) {
    const backfill = await backfillInvoicePaymentAllocations(supabase);
    allocationBackfill = backfill.stats;
    if (backfill.errors.length) errors.push(...backfill.errors);
  }

  return jsonResponse({
    success: true,
    syncedContacts: batchIds.length,
    syncedInvoices,
    insertedOrUpdated,
    syncedPayments,
    matchedPaymentCount,
    unmatchedPaymentCount,
    paymentsWithDateCount,
    paymentsWithoutDateCount,
    allocationBackfill,
    paymentEndpointUsed: paymentEndpointState.path,
    paymentEndpointWarning: paymentEndpointState.warning,
    samplePaymentRawKeys,
    samplePaymentDateValues,
    paymentPagesFetched,
    paymentRawRecordsFetched,
    paymentUniqueRecordsFetched,
    paymentDuplicateRecordsSkipped,
    contactsWithPaymentRecords,
    contactsWithoutPaymentRecords,
    samplePaymentFetchUrlsWithoutTokens,
    totalContactIdsFromStudents,
    totalContactIdsFromInvoices,
    totalUniqueContactIdsToSync,
    ledgerEndpointUsed: ledgerAggregate.ledgerEndpointUsed,
    ledgerEndpointWarning: ledgerAggregate.ledgerEndpointWarning,
    ledgerContactsSynced: ledgerAggregate.ledgerContactsSynced,
    ledgerRowsFetched: ledgerAggregate.ledgerRowsFetched,
    ledgerRowsUpserted: ledgerAggregate.ledgerRowsUpserted,
    ledgerRowsWithRelatedInvoice: ledgerAggregate.ledgerRowsWithRelatedInvoice,
    ledgerRowsWithoutRelatedInvoice: ledgerAggregate.ledgerRowsWithoutRelatedInvoice,
    ledgerRowsLinkedToInvoice: ledgerAggregate.ledgerRowsLinkedToInvoice,
    ledgerRowsUnlinkedToInvoice: ledgerAggregate.ledgerRowsUnlinkedToInvoice,
    sampleLedgerRows: ledgerAggregate.sampleLedgerRows,
    sampleLedgerRawKeys: ledgerAggregate.sampleLedgerRawKeys,
    errors,
    offset,
    limit,
    totalContacts,
    nextOffset: hasMore ? nextOffset : null,
    hasMore,
  });
});
