// Finance reports from cached public.ax_invoices (no live aXcelerate calls).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DateType = 'invoice_date' | 'due_date';
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
  updated_at: string | null;
};

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
  };
}

function monthKey(isoDate: string): string | null {
  const m = String(isoDate).trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
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
    if (applyDateFilter) {
      const dateValue = (filters.dateType === 'due_date' ? r.dueDate : r.invoiceDate).slice(0, 10);
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
  }

  totalInvoiced = roundMoney(totalInvoiced);
  paidTotal = roundMoney(paidTotal);
  outstandingTotal = roundMoney(outstandingTotal);
  voidTotal = roundMoney(voidTotal);
  cancelledTotal = roundMoney(cancelledTotal);

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
  };
}

function buildCharts(rows: NormalizedRow[]) {
  const statusNames: InvoiceStatus[] = ['Paid', 'Pending', 'Void', 'Cancelled'];
  const statusBreakdown = statusNames.map((name) => ({
    name,
    value:
      name === 'Pending'
        ? rows.filter((r) => r.status === 'Pending' || r.status === 'Partially Paid').length
        : rows.filter((r) => r.status === name).length,
  }));

  const trendMap = new Map<string, { invoiced: number; collected: number }>();
  for (const r of rows) {
    const mk = monthKey(r.invoiceDate);
    if (!mk) continue;
    const cur = trendMap.get(mk) ?? { invoiced: 0, collected: 0 };
    cur.invoiced += r.invoiceAmount;
    cur.collected += r.paidAmount;
    trendMap.set(mk, cur);
  }
  const monthlyCollectionTrend = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, invoiced: v.invoiced, collected: v.collected }));

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

  return { statusBreakdown, monthlyCollectionTrend, outstandingByDueMonth };
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
  const dateType: DateType = dateTypeRaw === 'due_date' ? 'due_date' : 'invoice_date';

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
    const { data, error } = await supabase
      .from('ax_invoices')
      .select(
        'invoice_id, invoice_number, contact_id, student_name, email, invoice_date, due_date, invoice_amount, paid_amount, balance, is_paid, is_void, is_cancelled, updated_at'
      )
      .order('invoice_date', { ascending: true, nullsFirst: false });

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
    const normalized = dbRows.map((r) => dbToRow(r));

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
        rawCount: normalized.length,
        filteredCount: filtered.length,
        minInvoiceDate,
        maxInvoiceDate,
        dateFilterApplied: Boolean(dateFrom || dateTo),
        dateType,
        dateFrom,
        dateTo,
        lastSyncedAt,
      },
      summary: buildSummary(filtered),
      rows: filtered,
      charts: buildCharts(filtered),
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
