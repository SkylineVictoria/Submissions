// Live aXcelerate invoice report proxy — tokens stay server-side only.
// Future: persist reminder_logs in Supabase when send-reminder is implemented.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type StatusFilter = 'all' | 'paid' | 'pending' | 'partially_paid';

type RequestBody = {
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  studentSearch?: string;
  course?: string;
  agent?: string;
};

type NormalizedRow = {
  invoiceId: string;
  invoiceNo: string;
  contactId: string;
  studentName: string;
  email: string;
  organisation: string;
  course: string;
  agent: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: number;
  paidAmount: number;
  balance: number;
  isPaid: boolean;
  status: 'Paid' | 'Pending' | 'Partially Paid';
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

function parseNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function pickField(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function calculateStatus(balance: number, paidAmount: number): NormalizedRow['status'] {
  if (balance === 0) return 'Paid';
  if (paidAmount > 0 && balance > 0) return 'Partially Paid';
  return 'Pending';
}

function normalizeRow(raw: Record<string, unknown>): NormalizedRow {
  const invoiceAmount = parseNumber(
    pickField(raw, 'invoice.pricegross', 'pricegross', 'invoiceAmount', 'InvoiceAmount')
  );
  const paidAmount = parseNumber(
    pickField(raw, 'invoice.actualreceivedamount', 'actualreceivedamount', 'paidAmount', 'PaidAmount')
  );
  const balance = parseNumber(pickField(raw, 'invoice.balance', 'balance', 'Balance'));
  const isPaidRaw = pickField(raw, 'invoice.ispaid', 'ispaid', 'isPaid');
  const isPaid = isPaidRaw === 'true' || isPaidRaw === '1' || balance === 0;

  const organisation = pickField(
    raw,
    'invoice.invoicetoorganisation',
    'invoicetoorganisation',
    'organisation',
    'Organisation'
  );

  return {
    invoiceId: pickField(raw, 'invoice.invoiceid', 'invoiceid', 'invoiceId'),
    invoiceNo: pickField(raw, 'invoice.invoicenr', 'invoicenr', 'invoiceNo'),
    contactId: pickField(raw, 'invoice.invoicecontactid', 'invoicecontactid', 'contactId'),
    studentName: pickField(raw, 'invoice.invoicetofullname', 'invoicetofullname', 'studentName'),
    email: pickField(raw, 'invoice.invoicetoemail', 'invoicetoemail', 'email'),
    organisation,
    course: pickField(raw, 'invoice.course', 'course', 'Course') || '',
    agent: pickField(raw, 'invoice.agent', 'agent', 'Agent') || organisation,
    invoiceDate: pickField(raw, 'invoice.invoicedate', 'invoicedate', 'invoiceDate'),
    dueDate: pickField(raw, 'invoice.invoiceduedate', 'invoiceduedate', 'dueDate'),
    invoiceAmount,
    paidAmount,
    balance,
    isPaid,
    status: calculateStatus(balance, paidAmount),
  };
}

function parseAxData(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const data = obj.DATA ?? obj.data ?? obj.Data ?? obj.rows ?? obj.ROWS;
  if (Array.isArray(data)) {
    return data.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
  }
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    } catch {
      /* ignore */
    }
  }
  return [];
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
    status: StatusFilter;
    studentSearch: string;
    course: string;
    agent: string;
  }
): NormalizedRow[] {
  const search = filters.studentSearch.trim().toLowerCase();
  const course = filters.course.trim().toLowerCase();
  const agent = filters.agent.trim().toLowerCase();

  return rows.filter((r) => {
    const invDate = r.invoiceDate.slice(0, 10);
    if (filters.dateFrom && isIsoDate(filters.dateFrom) && invDate && invDate < filters.dateFrom) return false;
    if (filters.dateTo && isIsoDate(filters.dateTo) && invDate && invDate > filters.dateTo) return false;

    if (filters.status === 'paid' && r.status !== 'Paid') return false;
    if (filters.status === 'pending' && r.status !== 'Pending') return false;
    if (filters.status === 'partially_paid' && r.status !== 'Partially Paid') return false;

    if (search) {
      const hay = `${r.studentName} ${r.email} ${r.invoiceNo}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (course && !r.course.toLowerCase().includes(course)) return false;
    if (agent && !r.agent.toLowerCase().includes(agent)) return false;
    return true;
  });
}

function buildSummary(rows: NormalizedRow[]) {
  let totalInvoiced = 0;
  let totalCollected = 0;
  let totalOutstanding = 0;
  let paidInvoices = 0;
  let pendingInvoices = 0;
  let partiallyPaidInvoices = 0;

  for (const r of rows) {
    totalInvoiced += r.invoiceAmount;
    totalCollected += r.paidAmount;
    totalOutstanding += r.balance;
    if (r.status === 'Paid') paidInvoices++;
    else if (r.status === 'Partially Paid') partiallyPaidInvoices++;
    else pendingInvoices++;
  }

  return {
    totalInvoiced,
    totalCollected,
    totalOutstanding,
    paidInvoices,
    pendingInvoices,
    partiallyPaidInvoices,
  };
}

function buildCharts(rows: NormalizedRow[]) {
  const statusBreakdown: { name: NormalizedRow['status']; value: number }[] = [
    { name: 'Paid', value: 0 },
    { name: 'Pending', value: 0 },
    { name: 'Partially Paid', value: 0 },
  ];
  for (const r of rows) {
    const item = statusBreakdown.find((s) => s.name === r.status);
    if (item) item.value++;
  }

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

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ success: false, message: 'Invalid JSON body.' }, 400);
  }

  const dateFrom = typeof body.dateFrom === 'string' ? body.dateFrom.trim() : '';
  const dateTo = typeof body.dateTo === 'string' ? body.dateTo.trim() : '';
  const statusRaw = typeof body.status === 'string' ? body.status.trim().toLowerCase() : 'all';
  const status: StatusFilter =
    statusRaw === 'paid' || statusRaw === 'pending' || statusRaw === 'partially_paid' ? statusRaw : 'all';
  const studentSearch = typeof body.studentSearch === 'string' ? body.studentSearch : '';
  const course = typeof body.course === 'string' ? body.course : '';
  const agent = typeof body.agent === 'string' ? body.agent : '';

  if (dateFrom && !isIsoDate(dateFrom)) {
    return jsonResponse({ success: false, message: 'dateFrom must be YYYY-MM-DD.' }, 400);
  }
  if (dateTo && !isIsoDate(dateTo)) {
    return jsonResponse({ success: false, message: 'dateTo must be YYYY-MM-DD.' }, 400);
  }

  const baseUrl = (Deno.env.get('AXCELERATE_BASE_URL') || 'https://slit.app.axcelerate.com/api').replace(/\/$/, '');
  const apiToken = Deno.env.get('AXCELERATE_API_TOKEN') ?? '';
  const wsToken = Deno.env.get('AXCELERATE_WS_TOKEN') ?? '';

  if (!apiToken || !wsToken) {
    return jsonResponse(
      {
        success: false,
        message: 'aXcelerate API is not configured.',
        details: 'Set AXCELERATE_API_TOKEN and AXCELERATE_WS_TOKEN secrets on the Edge Function.',
      },
      500
    );
  }

  const selectedFilterFields = JSON.stringify([
    { name: 'invoice.areitemslocked', value: 'true', operator: 'IS' },
  ]);

  const form = new URLSearchParams();
  form.set('reportReference', 'invoices');
  form.set(
    'selectedViewFields',
    [
      'invoice.invoiceid',
      'invoice.invoicenr',
      'invoice.invoicecontactid',
      'invoice.invoicedate',
      'invoice.invoiceduedate',
      'invoice.pricegross',
      'invoice.balance',
      'invoice.actualreceivedamount',
      'invoice.ispaid',
      'invoice.invoicetofullname',
      'invoice.invoicetoemail',
      'invoice.invoicetoorganisation',
    ].join(',')
  );
  form.set('selectedFilterFields', selectedFilterFields);

  try {
    const axRes = await fetch(`${baseUrl}/report/run`, {
      method: 'POST',
      headers: {
        apitoken: apiToken,
        wstoken: wsToken,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    const text = await axRes.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }

    if (!axRes.ok) {
      return jsonResponse(
        {
          success: false,
          message: `aXcelerate report failed (${axRes.status}).`,
          details: payload,
        },
        502
      );
    }

    const rawRows = parseAxData(payload);
    const normalized = rawRows.map((r) => normalizeRow(r));
    const filtered = applyFilters(normalized, {
      dateFrom,
      dateTo,
      status,
      studentSearch,
      course,
      agent,
    });

    const summary = buildSummary(filtered);
    const charts = buildCharts(filtered);

    return jsonResponse({
      success: true,
      summary,
      rows: filtered,
      charts,
    });
  } catch (err) {
    console.error('axcelerate-finance-reports error', err);
    return jsonResponse(
      {
        success: false,
        message: err instanceof Error ? err.message : 'Failed to fetch finance report.',
        details: String(err),
      },
      500
    );
  }
});
