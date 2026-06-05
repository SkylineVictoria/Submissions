// Finance reports from cached public.ax_invoices + ax_invoice_payments (no live aXcelerate calls).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DateType = 'invoice_date' | 'due_date' | 'last_payment_date';
type StatusFilter = 'all' | 'paid' | 'pending' | 'void' | 'cancelled';

type RequestBody = {
  dateFrom?: string;
  dateTo?: string;
  dateType?: string;
  status?: string;
  studentSearch?: string;
};

type InvoiceStatus = 'Paid' | 'Pending' | 'Partially Paid' | 'Void' | 'Cancelled';

type NormalizedRow = {
  invoiceId: string;
  invoiceNo: string;
  contactId: string;
  studentName: string;
  email: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: number;
  paidAmount: number;
  balance: number;
  isPaid: boolean;
  isVoid: boolean;
  isCancelled: boolean;
  status: InvoiceStatus;
  firstPaymentDate: string | null;
  lastPaymentDate: string | null;
  paymentCount: number;
  paymentMethod: string | null;
};

type DbInvoice = {
  invoice_id: number;
  invoice_number: string | null;
  contact_id: number | null;
  student_name: string | null;
  email: string | null;
  invoice_date: string | null;
  due_date: string | null;
  invoice_amount: number | string | null;
  paid_amount: number | string | null;
  balance: number | string | null;
  is_paid: boolean | null;
  is_void: boolean | null;
  is_cancelled: boolean | null;
  first_payment_date: string | null;
  last_payment_date: string | null;
  payment_count: number | null;
  payment_method: string | null;
  updated_at: string | null;
};

const PAYMENT_UNAVAILABLE_WARNING =
  'Collection trend is based on invoice status because actual payment dates are unavailable.';

type DbPayment = {
  invoice_id: number | null;
  contact_id: number | null;
  payment_date: string | null;
  payment_method: string | null;
  payment_amount: number | string | null;
  raw_json: Record<string, unknown> | null;
  reference: string | null;
};

type PaymentFragment = {
  invoiceId: number;
  amount: number;
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
    const invoiceId = Number(
      obj.INVOICEID ?? obj.invoiceID ?? obj.invoiceid ?? obj.InvoiceID ?? 0
    );
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) continue;
    const amountRaw = obj.AMOUNT ?? obj.amount ?? 0;
    out.push({
      invoiceId,
      amount: parseAmount(
        typeof amountRaw === 'number' || typeof amountRaw === 'string' ? amountRaw : String(amountRaw)
      ),
    });
  }
  return out;
}

function paymentInvoiceIdsFromRecord(
  p: DbPayment,
  invoiceByNumber: Map<string, number>,
  invoices: DbInvoice[]
): number[] {
  const raw = p.raw_json;
  if (raw && typeof raw === 'object') {
    const fragmentIds = parsePaymentFragments(raw).map((f) => f.invoiceId);
    if (fragmentIds.length > 0) return [...new Set(fragmentIds)];

    const fragmentInvoiceId = raw._fragmentInvoiceId;
    if (fragmentInvoiceId != null) {
      const id = Number(fragmentInvoiceId);
      if (Number.isFinite(id) && id > 0) return [id];
    }
  }

  if (p.invoice_id != null && p.invoice_id > 0) return [p.invoice_id];

  const reference = String(p.reference ?? '').trim();
  if (reference) {
    const refMatch =
      invoiceByNumber.get(reference.toLowerCase()) ??
      invoiceByNumber.get(reference.replace(/^0+/, '').toLowerCase());
    if (refMatch) return [refMatch];
  }

  const amount = parseAmount(p.payment_amount);
  if (p.contact_id != null && amount > 0) {
    const candidates = invoices.filter((inv) => {
      if (inv.is_void || inv.is_cancelled) return false;
      if (inv.contact_id !== p.contact_id) return false;
      const paidTarget = parseAmount(inv.paid_amount);
      const invoiceAmount = parseAmount(inv.invoice_amount);
      return (
        Math.abs(paidTarget - amount) < 0.02 ||
        Math.abs(invoiceAmount - amount) < 0.02
      );
    });
    if (candidates.length === 1) return [candidates[0].invoice_id];
  }

  return [];
}

type PaymentAggregate = {
  first: string;
  last: string;
  count: number;
  method: string | null;
};

function parsePaymentDateTime(value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;

  const isoDateTime = v.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (isoDateTime) {
    const sec = isoDateTime[6] ?? '00';
    return `${isoDateTime[1]}-${isoDateTime[2]}-${isoDateTime[3]}T${isoDateTime[4]}:${isoDateTime[5]}:${sec}Z`;
  }

  const isoDate = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}T00:00:00Z`;

  const parsed = Date.parse(v);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();

  return null;
}

function paymentDateFromRecord(p: DbPayment): string | null {
  if (p.payment_date) return String(p.payment_date);
  const raw = p.raw_json;
  if (!raw || typeof raw !== 'object') return null;
  const candidate =
    raw.TRANSDATE ??
    raw.transdate ??
    raw.PAYMENTDATE ??
    raw.TRANSACTIONDATE ??
    raw.DATERECEIVED ??
    raw.RECEIPTDATE;
  if (candidate == null) return null;
  return parsePaymentDateTime(String(candidate));
}

function resolvePaymentInvoiceId(
  p: DbPayment,
  invoiceByNumber: Map<string, number>,
  invoices: DbInvoice[]
): number | null {
  return paymentInvoiceIdsFromRecord(p, invoiceByNumber, invoices)[0] ?? null;
}

function buildPaymentAggregates(
  payments: DbPayment[],
  invoices: DbInvoice[]
): Map<number, PaymentAggregate> {
  const invoiceByNumber = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.invoice_number) continue;
    invoiceByNumber.set(inv.invoice_number.toLowerCase(), inv.invoice_id);
    invoiceByNumber.set(inv.invoice_number.replace(/^0+/, '').toLowerCase(), inv.invoice_id);
  }

  const map = new Map<number, PaymentAggregate & { latestDate: string }>();

  for (const p of payments) {
    const invoiceIds = paymentInvoiceIdsFromRecord(p, invoiceByNumber, invoices);
    if (invoiceIds.length === 0) continue;

    const date = paymentDateFromRecord(p);
    if (!date) continue;

    for (const invoiceId of invoiceIds) {
      const existing = map.get(invoiceId);
      if (!existing) {
        map.set(invoiceId, {
          first: date,
          last: date,
          count: 1,
          method: p.payment_method ? String(p.payment_method) : null,
          latestDate: date,
        });
        continue;
      }

      existing.count += 1;
      if (date < existing.first) existing.first = date;
      if (date > existing.last) {
        existing.last = date;
        existing.latestDate = date;
        existing.method = p.payment_method ? String(p.payment_method) : null;
      }
    }
  }

  return map;
}

function enrichInvoiceWithPayments(r: DbInvoice, agg?: PaymentAggregate): DbInvoice {
  if (!agg) return r;
  return {
    ...r,
    first_payment_date: r.first_payment_date ?? agg.first,
    last_payment_date: r.last_payment_date ?? agg.last,
    payment_count: Math.max(Number(r.payment_count ?? 0) || 0, agg.count),
    payment_method: r.payment_method ?? agg.method,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function parseAmount(v: number | string | null | undefined): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function derivePaidAmount(invoiceAmount: number, balance: number, storedPaid: number): number {
  if (storedPaid > 0) return storedPaid;
  if (invoiceAmount <= 0) return 0;
  if (balance >= 0 && balance <= invoiceAmount) {
    return Math.max(0, invoiceAmount - balance);
  }
  return 0;
}

function calculateStatus(row: {
  is_void: boolean;
  is_cancelled: boolean;
  balance: number;
  paid_amount: number;
  invoice_amount: number;
  is_paid: boolean;
}): InvoiceStatus {
  if (row.is_void) return 'Void';
  if (row.is_cancelled) return 'Cancelled';
  if (row.paid_amount > 0 && row.balance > 0 && row.balance < row.invoice_amount) {
    return 'Partially Paid';
  }
  if (
    row.balance <= 0 ||
    row.is_paid ||
    (row.invoice_amount > 0 && row.paid_amount >= row.invoice_amount)
  ) {
    return 'Paid';
  }
  if (row.balance > 0) return 'Pending';
  return 'Paid';
}

function dbToRow(r: DbInvoice): NormalizedRow {
  const balance = parseAmount(r.balance);
  const invoiceAmount = parseAmount(r.invoice_amount);
  const paidAmount = derivePaidAmount(invoiceAmount, balance, parseAmount(r.paid_amount));
  const isPaid = Boolean(r.is_paid) || balance <= 0 || (invoiceAmount > 0 && paidAmount >= invoiceAmount);
  const isVoid = Boolean(r.is_void);
  const isCancelled = Boolean(r.is_cancelled);

  return {
    invoiceId: String(r.invoice_id),
    invoiceNo: String(r.invoice_number ?? ''),
    contactId: r.contact_id != null ? String(r.contact_id) : '',
    studentName: String(r.student_name ?? ''),
    email: String(r.email ?? ''),
    invoiceDate: r.invoice_date ? String(r.invoice_date).slice(0, 10) : '',
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : '',
    invoiceAmount: parseAmount(r.invoice_amount),
    paidAmount,
    balance,
    isPaid,
    isVoid,
    isCancelled,
    status: calculateStatus({
      is_void: isVoid,
      is_cancelled: isCancelled,
      balance,
      paid_amount: paidAmount,
      invoice_amount: invoiceAmount,
      is_paid: isPaid,
    }),
    firstPaymentDate: r.first_payment_date ? String(r.first_payment_date) : null,
    lastPaymentDate: r.last_payment_date ? String(r.last_payment_date) : null,
    paymentCount: Number(r.payment_count ?? 0) || 0,
    paymentMethod: r.payment_method ? String(r.payment_method) : null,
  };
}

function monthKey(isoDate: string): string | null {
  const m = String(isoDate).trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function filterDateValue(row: NormalizedRow, dateType: DateType): string {
  if (dateType === 'due_date') return row.dueDate.slice(0, 10);
  if (dateType === 'last_payment_date') return row.lastPaymentDate ? row.lastPaymentDate.slice(0, 10) : '';
  return row.invoiceDate.slice(0, 10);
}

function applyFilters(
  rows: NormalizedRow[],
  filters: {
    dateFrom: string;
    dateTo: string;
    dateType: DateType;
    status: StatusFilter;
    studentSearch: string;
  }
): NormalizedRow[] {
  const search = filters.studentSearch.trim().toLowerCase();
  const applyDateFilter = Boolean(filters.dateFrom || filters.dateTo);

  return rows.filter((r) => {
    if (filters.dateType === 'last_payment_date' && !r.lastPaymentDate) return false;

    if (applyDateFilter || filters.dateType === 'last_payment_date') {
      const dateValue = filterDateValue(r, filters.dateType);
      if (!dateValue) return false;
      if (filters.dateFrom && isIsoDate(filters.dateFrom) && dateValue < filters.dateFrom) return false;
      if (filters.dateTo && isIsoDate(filters.dateTo) && dateValue > filters.dateTo) return false;
    }

    if (filters.status === 'paid' && r.status !== 'Paid') return false;
    if (filters.status === 'pending' && r.status !== 'Pending' && r.status !== 'Partially Paid') return false;
    if (filters.status === 'void' && r.status !== 'Void') return false;
    if (filters.status === 'cancelled' && r.status !== 'Cancelled') return false;

    if (search) {
      const hay = `${r.studentName} ${r.email} ${r.invoiceNo} ${r.contactId}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildSummary(rows: NormalizedRow[]) {
  let totalInvoiced = 0;
  let paidTotal = 0;
  let outstandingTotal = 0;
  let voidTotal = 0;
  let cancelledTotal = 0;
  let collectedByPaymentDate = 0;
  let paidWithoutPaymentDateCount = 0;

  for (const r of rows) {
    totalInvoiced += r.invoiceAmount;

    if (r.isVoid) {
      voidTotal += r.invoiceAmount;
      continue;
    }

    if (r.isCancelled) {
      cancelledTotal += r.invoiceAmount;
      continue;
    }

    paidTotal += r.paidAmount;
    outstandingTotal += r.balance;

    if (r.lastPaymentDate) {
      collectedByPaymentDate += r.paidAmount;
    } else if (r.status === 'Paid' || r.paidAmount > 0) {
      paidWithoutPaymentDateCount += 1;
    }
  }

  totalInvoiced = roundMoney(totalInvoiced);
  paidTotal = roundMoney(paidTotal);
  outstandingTotal = roundMoney(outstandingTotal);
  voidTotal = roundMoney(voidTotal);
  cancelledTotal = roundMoney(cancelledTotal);
  collectedByPaymentDate = roundMoney(collectedByPaymentDate);

  const adjustmentTotal = roundMoney(
    totalInvoiced - (paidTotal + outstandingTotal + voidTotal + cancelledTotal)
  );
  const reconciliationTotal = roundMoney(
    paidTotal + outstandingTotal + voidTotal + cancelledTotal + adjustmentTotal
  );
  const isReconciled = Math.abs(totalInvoiced - reconciliationTotal) < 0.01;

  return {
    totalInvoiced,
    paidTotal,
    outstandingTotal,
    voidTotal,
    cancelledTotal,
    adjustmentTotal,
    reconciliationTotal,
    isReconciled,
    collectedByPaymentDate,
    paidWithoutPaymentDateCount,
  };
}

function buildCharts(rows: NormalizedRow[], hasPaymentDates: boolean) {
  const statusNames: InvoiceStatus[] = ['Paid', 'Pending', 'Void', 'Cancelled'];
  const statusBreakdown = statusNames.map((name) => ({
    name,
    value:
      name === 'Pending'
        ? rows.filter((r) => r.status === 'Pending' || r.status === 'Partially Paid').length
        : rows.filter((r) => r.status === name).length,
  }));

  const trendMap = new Map<string, { invoiced: number; collected: number }>();
  const paymentTrendMap = new Map<string, number>();

  for (const r of rows) {
    const invoiceMonth = monthKey(r.invoiceDate);
    if (invoiceMonth) {
      const cur = trendMap.get(invoiceMonth) ?? { invoiced: 0, collected: 0 };
      cur.invoiced += r.invoiceAmount;
      if (!hasPaymentDates) cur.collected += r.paidAmount;
      trendMap.set(invoiceMonth, cur);
    }

    if (hasPaymentDates && r.lastPaymentDate) {
      const paymentMonth = monthKey(r.lastPaymentDate);
      if (paymentMonth) {
        paymentTrendMap.set(paymentMonth, (paymentTrendMap.get(paymentMonth) ?? 0) + r.paidAmount);
        const cur = trendMap.get(paymentMonth) ?? { invoiced: 0, collected: 0 };
        cur.collected += r.paidAmount;
        trendMap.set(paymentMonth, cur);
      }
    }
  }

  const monthlyCollectionTrend = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, invoiced: v.invoiced, collected: v.collected }));

  const monthlyPaymentTrend = [...paymentTrendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, collected]) => ({ month, collected }));

  const dueMap = new Map<string, number>();
  for (const r of rows) {
    if (r.balance <= 0) continue;
    const mk = monthKey(r.dueDate) || monthKey(r.invoiceDate);
    if (!mk) continue;
    dueMap.set(mk, (dueMap.get(mk) ?? 0) + r.balance);
  }
  const outstandingByDueMonth = [...dueMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, outstanding]) => ({ month, outstanding }));

  return {
    statusBreakdown,
    monthlyCollectionTrend,
    monthlyPaymentTrend,
    outstandingByDueMonth,
    paymentDatesAvailable: hasPaymentDates,
    collectionTrendWarning: hasPaymentDates ? null : PAYMENT_UNAVAILABLE_WARNING,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ success: false, message: 'Method not allowed. Use POST.' }, 405);
  }

  let body: RequestBody = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const dateFrom = typeof body.dateFrom === 'string' ? body.dateFrom.trim() : '';
  const dateTo = typeof body.dateTo === 'string' ? body.dateTo.trim() : '';
  const dateTypeRaw = typeof body.dateType === 'string' ? body.dateType.trim().toLowerCase() : 'invoice_date';
  const dateType: DateType =
    dateTypeRaw === 'due_date'
      ? 'due_date'
      : dateTypeRaw === 'last_payment_date'
        ? 'last_payment_date'
        : 'invoice_date';

  if (dateFrom && !isIsoDate(dateFrom)) {
    return jsonResponse({ success: false, message: 'dateFrom must be YYYY-MM-DD.' }, 400);
  }
  if (dateTo && !isIsoDate(dateTo)) {
    return jsonResponse({ success: false, message: 'dateTo must be YYYY-MM-DD.' }, 400);
  }

  const statusRaw = typeof body.status === 'string' ? body.status.trim().toLowerCase() : 'all';
  const status: StatusFilter =
    statusRaw === 'paid' || statusRaw === 'pending' || statusRaw === 'void' || statusRaw === 'cancelled'
      ? statusRaw
      : 'all';

  const studentSearch = typeof body.studentSearch === 'string' ? body.studentSearch : '';

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      {
        success: false,
        message: 'Supabase service role is not configured.',
      },
      500
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const [{ data, error }, { count: paymentCount }, { data: allPayments }] = await Promise.all([
      supabase
        .from('ax_invoices')
        .select(
          'invoice_id, invoice_number, contact_id, student_name, email, invoice_date, due_date, invoice_amount, paid_amount, balance, is_paid, is_void, is_cancelled, first_payment_date, last_payment_date, payment_count, payment_method, updated_at'
        )
        .order('invoice_date', { ascending: true, nullsFirst: false }),
      supabase.from('ax_invoice_payments').select('*', { count: 'exact', head: true }),
      supabase
        .from('ax_invoice_payments')
        .select('invoice_id, contact_id, payment_date, payment_method, payment_amount, raw_json, reference'),
    ]);

    if (error) {
      return jsonResponse(
        {
          success: false,
          message: `Failed to load invoices: ${error.message}`,
        },
        500
      );
    }

    const dbRows = (data ?? []) as DbInvoice[];
    const paymentRecords = (allPayments ?? []) as DbPayment[];
    const paymentAggregates = buildPaymentAggregates(paymentRecords, dbRows);
    const enrichedRows = dbRows.map((r) => enrichInvoiceWithPayments(r, paymentAggregates.get(r.invoice_id)));
    const normalized = enrichedRows.map((r) => dbToRow(r));

    const invoiceByNumber = new Map<string, number>();
    for (const inv of dbRows) {
      if (!inv.invoice_number) continue;
      invoiceByNumber.set(inv.invoice_number.toLowerCase(), inv.invoice_id);
      invoiceByNumber.set(inv.invoice_number.replace(/^0+/, '').toLowerCase(), inv.invoice_id);
    }

    let matchedPaymentCount = 0;
    let unmatchedPaymentCount = 0;
    for (const p of paymentRecords) {
      if (resolvePaymentInvoiceId(p, invoiceByNumber, dbRows)) matchedPaymentCount += 1;
      else unmatchedPaymentCount += 1;
    }

    const paymentEndpointUsed =
      (paymentRecords.find((p) => {
        const raw = p.raw_json;
        return raw && typeof raw._endpoint === 'string';
      })?.raw_json as Record<string, unknown> | undefined)?._endpoint ?? null;

    const hasPaymentDates = normalized.some((r) => Boolean(r.lastPaymentDate));
    const paymentEndpointWarning =
      hasPaymentDates || (paymentCount ?? 0) > 0
        ? null
        : 'Payment date endpoint not available. Invoice paid status is synced, but actual payment date/time is unavailable.';

    const invoiceDates = normalized.map((r) => r.invoiceDate).filter(Boolean).sort();
    const minInvoiceDate = invoiceDates[0] ?? null;
    const maxInvoiceDate = invoiceDates[invoiceDates.length - 1] ?? null;

    const lastSyncedAt =
      dbRows
        .map((r) => r.updated_at)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;

    const filtered = applyFilters(normalized, {
      dateFrom,
      dateTo,
      dateType,
      status,
      studentSearch,
    });

    return jsonResponse({
      success: true,
      debug: {
        invoiceCount: normalized.length,
        paymentCount: paymentCount ?? 0,
        matchedPaymentCount,
        unmatchedPaymentCount,
        paymentEndpointUsed: paymentEndpointUsed ? String(paymentEndpointUsed) : null,
        paymentEndpointWarning,
        rawCount: normalized.length,
        filteredCount: filtered.length,
        minInvoiceDate,
        maxInvoiceDate,
        dateFilterApplied: Boolean(dateFrom || dateTo) || dateType === 'last_payment_date',
        dateType,
        dateFrom,
        dateTo,
        lastSyncedAt,
      },
      summary: buildSummary(filtered),
      rows: filtered,
      charts: buildCharts(filtered, hasPaymentDates),
    });
  } catch (err) {
    console.error('axcelerate-finance-reports error', err);
    return jsonResponse(
      {
        success: false,
        message: err instanceof Error ? err.message : 'Failed to load finance report.',
        details: String(err),
      },
      500
    );
  }
});
