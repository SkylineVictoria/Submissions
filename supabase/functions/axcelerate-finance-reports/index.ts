// Finance reports from cached public.ax_invoices + ax_invoice_payment_allocations (no live aXcelerate calls).
//
// SQL verification:
// -- Paid invoices missing payment date (no allocation row)
// SELECT COUNT(*)
// FROM public.ax_invoices i
// LEFT JOIN public.ax_invoice_payment_allocations a ON a.invoice_id = i.invoice_id
// WHERE i.paid_amount > 0
//   AND COALESCE(i.is_void, false) = false
//   AND COALESCE(i.is_cancelled, false) = false
//   AND a.invoice_id IS NULL;
//
// -- Allocated invoices with payment dates
// SELECT COUNT(DISTINCT invoice_id)
// FROM public.ax_invoice_payment_allocations;
//
// -- Allocation sample
// SELECT
//   i.invoice_number,
//   i.student_name,
//   i.invoice_amount,
//   i.paid_amount,
//   a.allocated_amount,
//   a.allocation_date,
//   a.payment_method,
//   a.match_method,
//   a.match_confidence
// FROM public.ax_invoice_payment_allocations a
// JOIN public.ax_invoices i ON i.invoice_id = a.invoice_id
// ORDER BY a.allocation_date DESC
// LIMIT 100;

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { allocatePaymentsForDateFilter, isAxMoneyReceivedPayment } from './paymentDateFilter.ts';
import {
  buildInvoiceIdsFromLedgerPayments,
  buildInvoicePaymentMapFromLedger,
  buildLedgerPaymentEntriesInRange,
  buildLedgerSummary,
  dbToLedgerRow,
  filterLedgerEntries,
  mergeLedgerPaymentEntries,
  type DbLedgerEntry,
  type LedgerDateType,
} from './ledgerReport.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type DateType = 'invoice_date' | 'due_date' | 'last_payment_date' | 'ledger_date' | 'entry_date';
type ReportView = 'invoice_directory' | 'ledger';
type StatusFilter = 'all' | 'paid' | 'pending' | 'void' | 'cancelled';

type RequestBody = {
  dateFrom?: string;
  dateTo?: string;
  dateType?: string;
  status?: string;
  studentSearch?: string;
  reportView?: string;
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
  paymentDate: string | null;
  paymentCount: number;
  paymentMethod: string | null;
  hasPaymentDate: boolean;
  paymentDateMissing: boolean;
};

type InvoicePaymentEntry = {
  date: string;
  method: string | null;
};

type DbAllocation = {
  invoice_id: number;
  payment_id: string;
  allocated_amount: number | string | null;
  allocation_date: string | null;
  payment_method: string | null;
  match_method: string;
  match_confidence: string;
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

type PaymentTransactionRow = {
  paymentId: string;
  transactionId: string | null;
  invoiceId: string | null;
  invoiceNo: string;
  contactId: string;
  studentName: string;
  paymentDate: string | null;
  transactionDate: string | null;
  paymentMethod: string | null;
  transactionType: string | null;
  paymentAmount: number;
  unappliedAmount: number;
  userFullName: string | null;
  reference: string | null;
};

type DbPayment = {
  payment_id: string;
  transaction_id: string | null;
  invoice_id: number | null;
  invoice_number: string | null;
  contact_id: number | null;
  student_name: string | null;
  payment_date: string | null;
  transaction_date: string | null;
  payment_method: string | null;
  transaction_type: string | null;
  payment_amount: number | string | null;
  unapplied_amount: number | string | null;
  user_full_name: string | null;
  reference: string | null;
  raw_json: Record<string, unknown> | null;
};

const PAYMENT_DATE_RAW_KEYS = [
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
  if (p.transaction_date) return parsePaymentDateTime(String(p.transaction_date));
  if (p.payment_date) return parsePaymentDateTime(String(p.payment_date));
  const raw = p.raw_json;
  if (!raw || typeof raw !== 'object') return null;
  for (const key of PAYMENT_DATE_RAW_KEYS) {
    const candidate = raw[key];
    if (candidate == null || String(candidate).trim() === '') continue;
    const parsed = parsePaymentDateTime(String(candidate));
    if (parsed) return parsed;
  }
  return null;
}

function paymentDateDay(p: DbPayment): string {
  const dt = paymentDateFromRecord(p);
  return dt ? dt.slice(0, 10) : '';
}

function isPaymentDayInRange(day: string, dateFrom: string, dateTo: string): boolean {
  if (!day) return false;
  if (dateFrom && isIsoDate(dateFrom) && day < dateFrom) return false;
  if (dateTo && isIsoDate(dateTo) && day > dateTo) return false;
  return true;
}

function buildInvoiceByNumberMap(invoices: DbInvoice[]): Map<string, number> {
  const invoiceByNumber = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.invoice_number) continue;
    invoiceByNumber.set(inv.invoice_number.toLowerCase(), inv.invoice_id);
    invoiceByNumber.set(inv.invoice_number.replace(/^0+/, '').toLowerCase(), inv.invoice_id);
  }
  return invoiceByNumber;
}

function buildPaymentTransactionRows(
  payments: DbPayment[],
  invoices: DbInvoice[],
  invoiceByNumber: Map<string, number>
): PaymentTransactionRow[] {
  const invoiceById = new Map(invoices.map((inv) => [inv.invoice_id, inv]));

  return payments.map((p) => {
    const resolvedInvoiceId = resolvePaymentInvoiceId(p, invoiceByNumber, invoices);
    const inv = resolvedInvoiceId != null ? invoiceById.get(resolvedInvoiceId) : undefined;
    const effectiveDate = paymentDateFromRecord(p);

    return {
      paymentId: String(p.payment_id),
      transactionId: p.transaction_id ? String(p.transaction_id) : null,
      invoiceId: resolvedInvoiceId != null ? String(resolvedInvoiceId) : null,
      invoiceNo: String(p.invoice_number ?? inv?.invoice_number ?? ''),
      contactId: p.contact_id != null ? String(p.contact_id) : inv?.contact_id != null ? String(inv.contact_id) : '',
      studentName: String(p.student_name ?? inv?.student_name ?? ''),
      paymentDate: effectiveDate,
      transactionDate: p.transaction_date ? parsePaymentDateTime(String(p.transaction_date)) : effectiveDate,
      paymentMethod: p.payment_method ? String(p.payment_method) : null,
      transactionType: p.transaction_type ? String(p.transaction_type) : null,
      paymentAmount: parseAmount(p.payment_amount),
      unappliedAmount: parseAmount(p.unapplied_amount),
      userFullName: p.user_full_name ? String(p.user_full_name) : null,
      reference: p.reference ? String(p.reference) : null,
    };
  });
}

function buildInvoicePaymentMapFromAllocations(
  allocations: DbAllocation[]
): Map<number, InvoicePaymentEntry[]> {
  const map = new Map<number, InvoicePaymentEntry[]>();

  for (const a of allocations) {
    if (!a.allocation_date) continue;
    const date = parsePaymentDateTime(String(a.allocation_date));
    if (!date) continue;
    const list = map.get(a.invoice_id) ?? [];
    list.push({
      date,
      method: a.payment_method ? String(a.payment_method) : null,
    });
    map.set(a.invoice_id, list);
  }

  for (const [invoiceId, list] of map.entries()) {
    list.sort((x, y) => x.date.localeCompare(y.date));
    map.set(invoiceId, list);
  }

  return map;
}

function resolveInvoicePaymentEntries(
  invoiceId: number,
  allocationMap: Map<number, InvoicePaymentEntry[]>,
  paymentMap: Map<number, InvoicePaymentEntry[]>,
  row: NormalizedRow
): InvoicePaymentEntry[] {
  const fromAlloc = allocationMap.get(invoiceId);
  if (fromAlloc && fromAlloc.length > 0) return fromAlloc;

  const fromPayments = paymentMap.get(invoiceId);
  if (fromPayments && fromPayments.length > 0) return fromPayments;

  if (row.lastPaymentDate) {
    return [{ date: row.lastPaymentDate, method: row.paymentMethod }];
  }

  return [];
}

function buildInvoiceIdsWithAllocationInRange(
  allocations: DbAllocation[],
  dateFrom: string,
  dateTo: string
): Set<number> {
  const set = new Set<number>();
  for (const a of allocations) {
    if (!a.allocation_date) continue;
    const day = String(a.allocation_date).slice(0, 10);
    if (!isPaymentDayInRange(day, dateFrom, dateTo)) continue;
    set.add(a.invoice_id);
  }
  return set;
}

function buildAllocationDiagnostics(allocations: DbAllocation[]) {
  let highConfidenceAllocations = 0;
  let mediumConfidenceAllocations = 0;
  let lowConfidenceAllocations = 0;
  for (const a of allocations) {
    if (a.match_confidence === 'high') highConfidenceAllocations += 1;
    else if (a.match_confidence === 'medium') mediumConfidenceAllocations += 1;
    else lowConfidenceAllocations += 1;
  }
  return {
    allocationsCreated: allocations.length,
    highConfidenceAllocations,
    mediumConfidenceAllocations,
    lowConfidenceAllocations,
    distinctAllocatedInvoices: new Set(allocations.map((a) => a.invoice_id)).size,
  };
}

function buildInvoicePaymentMap(
  payments: DbPayment[],
  invoices: DbInvoice[],
  invoiceByNumber: Map<string, number>
): Map<number, InvoicePaymentEntry[]> {
  const map = new Map<number, InvoicePaymentEntry[]>();

  for (const p of payments) {
    if (!isMoneyReceivedPaymentRow(p.transaction_type, parseAmount(p.payment_amount))) continue;
    if (isExcludedPaymentMethod(p.payment_method)) continue;

    const date = paymentDateFromRecord(p);
    if (!date) continue;

    const invoiceIds = paymentInvoiceIdsFromRecord(p, invoiceByNumber, invoices);
    const method = p.payment_method ? String(p.payment_method) : null;

    for (const invoiceId of invoiceIds) {
      const list = map.get(invoiceId) ?? [];
      list.push({ date, method });
      map.set(invoiceId, list);
    }
  }

  for (const [invoiceId, list] of map.entries()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    map.set(invoiceId, list);
  }

  return map;
}

function applyPaymentDisplayToRow(
  row: NormalizedRow,
  payments: InvoicePaymentEntry[] | undefined,
  dateType: DateType,
  dateFrom: string,
  dateTo: string
): NormalizedRow {
  const all = payments ?? [];
  const applyRange = dateType === 'last_payment_date' && Boolean(dateFrom || dateTo);
  const displayPayments = applyRange
    ? all.filter((p) => isPaymentDayInRange(p.date.slice(0, 10), dateFrom, dateTo))
    : all;

  const latestInView =
    displayPayments.length > 0
      ? displayPayments[displayPayments.length - 1]
      : all.length > 0
        ? all[all.length - 1]
        : null;

  const paymentDate = latestInView?.date ?? row.lastPaymentDate ?? null;
  const paymentMethod = latestInView?.method ?? row.paymentMethod ?? null;
  const firstPaymentDate = all.length > 0 ? all[0].date : row.firstPaymentDate;
  const lastPaymentDate = all.length > 0 ? all[all.length - 1].date : row.lastPaymentDate;
  const paymentCount = all.length > 0 ? all.length : row.paymentCount;
  const hasPaymentDate = Boolean(paymentDate);
  const needsPaymentDate =
    (row.status === 'Paid' || row.status === 'Partially Paid') && row.paidAmount > 0;

  return {
    ...row,
    firstPaymentDate,
    lastPaymentDate,
    paymentDate,
    paymentMethod,
    paymentCount,
    hasPaymentDate,
    paymentDateMissing: needsPaymentDate && !hasPaymentDate,
  };
}

function buildInvoiceIdsWithPaymentsInRange(
  payments: DbPayment[],
  invoices: DbInvoice[],
  invoiceByNumber: Map<string, number>,
  dateFrom: string,
  dateTo: string
): Set<number> {
  const set = new Set<number>();
  for (const p of payments) {
    if (!isMoneyReceivedPaymentRow(p.transaction_type, parseAmount(p.payment_amount))) continue;
    if (isExcludedPaymentMethod(p.payment_method)) continue;
    const day = paymentDateDay(p);
    if (!isPaymentDayInRange(day, dateFrom, dateTo)) continue;
    for (const invoiceId of paymentInvoiceIdsFromRecord(p, invoiceByNumber, invoices)) {
      set.add(invoiceId);
    }
  }
  return set;
}

function buildInvoiceIdsWithAnyPayment(
  payments: DbPayment[],
  invoices: DbInvoice[],
  invoiceByNumber: Map<string, number>
): Set<number> {
  const set = new Set<number>();
  for (const p of payments) {
    if (!isMoneyReceivedPaymentRow(p.transaction_type, parseAmount(p.payment_amount))) continue;
    if (isExcludedPaymentMethod(p.payment_method)) continue;
    for (const invoiceId of paymentInvoiceIdsFromRecord(p, invoiceByNumber, invoices)) {
      set.add(invoiceId);
    }
  }
  return set;
}

function resolvePaymentInvoiceId(
  p: DbPayment,
  invoiceByNumber: Map<string, number>,
  invoices: DbInvoice[]
): number | null {
  return paymentInvoiceIdsFromRecord(p, invoiceByNumber, invoices)[0] ?? null;
}

function isMoneyReceivedPaymentRow(
  transactionType: string | null,
  paymentAmount: number
): boolean {
  const type = String(transactionType ?? '').toLowerCase();
  if (!type) return paymentAmount > 0;
  return type.includes('money received') || type.includes('payment') || type.includes('receipt');
}

function isExcludedPaymentMethod(method: string | null): boolean {
  const m = String(method ?? '').toLowerCase();
  return m.includes('bad debt') || m.includes('credit note');
}

type ExcludedPaymentSample = {
  paymentId: string;
  transactionId: string | null;
  invoiceId: string | null;
  paymentDate: string | null;
  transactionType: string | null;
  paymentMethod: string | null;
  reason: string;
};

type PaymentDiagnostics = {
  dateFromIso: string;
  dateToIso: string;
  totalRowsInAxInvoicePayments: number;
  rowsWithAnyPaymentDate: number;
  rowsInDateRangeBeforeTypeMethodFilter: number;
  rowsAfterMoneyReceivedFilter: number;
  rowsAfterMethodExclusion: number;
  rowsAfterStudentSearch: number;
  paymentTransactionsReturned: number;
  matchedTransactionsReturned: number;
  unmatchedTransactionsReturned: number;
  distinctInvoiceIdsFromTransactions: number;
  distinctInvoiceIdsFoundInAxInvoices: number;
  distinctInvoiceIdsMissingFromAxInvoices: number;
  missingInvoiceIds: string[];
  missingInvoiceIdsFromLocalCache: string[];
  sampleExcludedRowsByReason: {
    noDate: ExcludedPaymentSample[];
    outsideDateRange: ExcludedPaymentSample[];
    nonMoneyReceived: ExcludedPaymentSample[];
    excludedMethod: ExcludedPaymentSample[];
    searchFiltered: ExcludedPaymentSample[];
    missingInvoice: ExcludedPaymentSample[];
  };
};

function toExcludedSample(
  t: PaymentTransactionRow,
  reason: string
): ExcludedPaymentSample {
  return {
    paymentId: t.paymentId,
    transactionId: t.transactionId,
    invoiceId: t.invoiceId,
    paymentDate: t.transactionDate ?? t.paymentDate,
    transactionType: t.transactionType,
    paymentMethod: t.paymentMethod,
    reason,
  };
}

function pushSample(
  bucket: ExcludedPaymentSample[],
  sample: ExcludedPaymentSample,
  max = 5
): void {
  if (bucket.length < max) bucket.push(sample);
}

function buildPaymentDiagnostics(
  allTransactions: PaymentTransactionRow[],
  filteredTransactions: PaymentTransactionRow[],
  dateFrom: string,
  dateTo: string,
  studentSearch: string,
  dbInvoiceIds: Set<number>
): PaymentDiagnostics {
  const search = studentSearch.trim().toLowerCase();
  const applyDateRange = Boolean(dateFrom || dateTo);

  const samples = {
    noDate: [] as ExcludedPaymentSample[],
    outsideDateRange: [] as ExcludedPaymentSample[],
    nonMoneyReceived: [] as ExcludedPaymentSample[],
    excludedMethod: [] as ExcludedPaymentSample[],
    searchFiltered: [] as ExcludedPaymentSample[],
    missingInvoice: [] as ExcludedPaymentSample[],
  };

  let rowsWithAnyPaymentDate = 0;
  let rowsInDateRangeBeforeTypeMethodFilter = 0;
  let rowsAfterMoneyReceivedFilter = 0;
  let rowsAfterMethodExclusion = 0;
  let rowsAfterStudentSearch = 0;

  const afterMoneyReceived: PaymentTransactionRow[] = [];
  const afterMethod: PaymentTransactionRow[] = [];
  const afterSearch: PaymentTransactionRow[] = [];

  for (const t of allTransactions) {
    const day = (t.transactionDate ?? t.paymentDate ?? '').slice(0, 10);
    if (day) rowsWithAnyPaymentDate += 1;
    else pushSample(samples.noDate, toExcludedSample(t, 'noDate'));

    if (applyDateRange) {
      if (!isPaymentDayInRange(day, dateFrom, dateTo)) {
        pushSample(samples.outsideDateRange, toExcludedSample(t, 'outsideDateRange'));
        continue;
      }
    } else if (!day) {
      continue;
    }

    rowsInDateRangeBeforeTypeMethodFilter += 1;

    if (!isMoneyReceivedPaymentRow(t.transactionType, t.paymentAmount)) {
      pushSample(samples.nonMoneyReceived, toExcludedSample(t, 'nonMoneyReceived'));
      continue;
    }
    rowsAfterMoneyReceivedFilter += 1;
    afterMoneyReceived.push(t);

    if (isExcludedPaymentMethod(t.paymentMethod)) {
      pushSample(samples.excludedMethod, toExcludedSample(t, 'excludedMethod'));
      continue;
    }
    rowsAfterMethodExclusion += 1;
    afterMethod.push(t);

    if (search) {
      const hay = `${t.studentName} ${t.invoiceNo} ${t.contactId} ${t.reference ?? ''}`.toLowerCase();
      if (!hay.includes(search)) {
        pushSample(samples.searchFiltered, toExcludedSample(t, 'searchFiltered'));
        continue;
      }
    }
    rowsAfterStudentSearch += 1;
    afterSearch.push(t);
  }

  const distinctInvoiceIdSet = new Set(
    filteredTransactions.map((t) => t.invoiceId).filter(Boolean) as string[]
  );
  const missingInvoiceIdsFromLocalCache: string[] = [];
  let distinctInvoiceIdsFoundInAxInvoices = 0;

  for (const invoiceId of distinctInvoiceIdSet) {
    const idNum = Number(invoiceId);
    if (dbInvoiceIds.has(idNum)) {
      distinctInvoiceIdsFoundInAxInvoices += 1;
    } else {
      missingInvoiceIdsFromLocalCache.push(invoiceId);
      pushSample(samples.missingInvoice, toExcludedSample(
        filteredTransactions.find((t) => t.invoiceId === invoiceId) ?? {
          paymentId: `missing-invoice-${invoiceId}`,
          transactionId: null,
          invoiceId,
          invoiceNo: '',
          contactId: '',
          studentName: '',
          paymentDate: null,
          transactionDate: null,
          paymentMethod: null,
          transactionType: null,
          paymentAmount: 0,
          unappliedAmount: 0,
          userFullName: null,
          reference: null,
        },
        'missingInvoice'
      ));
    }
  }

  return {
    dateFromIso: dateFrom,
    dateToIso: dateTo,
    totalRowsInAxInvoicePayments: allTransactions.length,
    rowsWithAnyPaymentDate,
    rowsInDateRangeBeforeTypeMethodFilter,
    rowsAfterMoneyReceivedFilter,
    rowsAfterMethodExclusion,
    rowsAfterStudentSearch,
    paymentTransactionsReturned: filteredTransactions.length,
    matchedTransactionsReturned: filteredTransactions.filter((t) => t.invoiceId).length,
    unmatchedTransactionsReturned: filteredTransactions.filter((t) => !t.invoiceId).length,
    distinctInvoiceIdsFromTransactions: distinctInvoiceIdSet.size,
    distinctInvoiceIdsFoundInAxInvoices,
    distinctInvoiceIdsMissingFromAxInvoices: missingInvoiceIdsFromLocalCache.length,
    missingInvoiceIds: missingInvoiceIdsFromLocalCache.slice(0, 20),
    missingInvoiceIdsFromLocalCache,
    sampleExcludedRowsByReason: samples,
  };
}

function filterPaymentTransactionsForReport(
  transactions: PaymentTransactionRow[],
  filters: {
    dateFrom: string;
    dateTo: string;
    dateType: DateType;
    status: StatusFilter;
    studentSearch: string;
  },
  invoiceStatusById: Map<string, InvoiceStatus>
): PaymentTransactionRow[] {
  const search = filters.studentSearch.trim().toLowerCase();
  const applyPaymentDateFilter =
    filters.dateType === 'last_payment_date' && Boolean(filters.dateFrom || filters.dateTo);

  return transactions.filter((t) => {
    const day = (t.transactionDate ?? t.paymentDate ?? '').slice(0, 10);
    if (applyPaymentDateFilter) {
      if (!isPaymentDayInRange(day, filters.dateFrom, filters.dateTo)) return false;
    } else if (filters.dateType === 'last_payment_date' && !day) {
      return false;
    }

    if (!isMoneyReceivedPaymentRow(t.transactionType, t.paymentAmount)) return false;
    if (isExcludedPaymentMethod(t.paymentMethod)) return false;

    if (filters.status !== 'all' && t.invoiceId) {
      const invStatus = invoiceStatusById.get(t.invoiceId);
      if (filters.status === 'paid' && invStatus !== 'Paid') return false;
      if (filters.status === 'pending' && invStatus !== 'Pending' && invStatus !== 'Partially Paid') return false;
      if (filters.status === 'void' && invStatus !== 'Void') return false;
      if (filters.status === 'cancelled' && invStatus !== 'Cancelled') return false;
    }

    if (search) {
      const hay = `${t.studentName} ${t.invoiceNo} ${t.contactId} ${t.reference ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }

    return true;
  });
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

function resolveRowPaymentDates(
  r: DbInvoice,
  agg?: PaymentAggregate
): { firstPaymentDate: string | null; lastPaymentDate: string | null; paymentMethod: string | null } {
  const firstPaymentDate = r.first_payment_date ?? agg?.first ?? null;
  const lastPaymentDate = r.last_payment_date ?? agg?.last ?? null;
  const paymentMethod = r.payment_method ?? agg?.method ?? null;
  return {
    firstPaymentDate: firstPaymentDate ? String(firstPaymentDate) : null,
    lastPaymentDate: lastPaymentDate ? String(lastPaymentDate) : null,
    paymentMethod: paymentMethod ? String(paymentMethod) : null,
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

const MAX_REPORT_DATE_RANGE_DAYS = 365;

function clampReportDateRange(
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
  const maxSpanMs = MAX_REPORT_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (toMs - fromMs <= maxSpanMs) {
    return { dateFrom: from, dateTo: to, clamped: false };
  }
  return {
    dateFrom: new Date(toMs - maxSpanMs).toISOString().slice(0, 10),
    dateTo: to,
    clamped: true,
  };
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

function dbToRow(r: DbInvoice, agg?: PaymentAggregate): NormalizedRow {
  const balance = parseAmount(r.balance);
  const invoiceAmount = parseAmount(r.invoice_amount);
  const paidAmount = derivePaidAmount(invoiceAmount, balance, parseAmount(r.paid_amount));
  const isPaid = Boolean(r.is_paid) || balance <= 0 || (invoiceAmount > 0 && paidAmount >= invoiceAmount);
  const isVoid = Boolean(r.is_void);
  const isCancelled = Boolean(r.is_cancelled);
  const paymentDates = resolveRowPaymentDates(r, agg);

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
    firstPaymentDate: paymentDates.firstPaymentDate,
    lastPaymentDate: paymentDates.lastPaymentDate,
    paymentDate: paymentDates.lastPaymentDate,
    paymentCount: Math.max(Number(r.payment_count ?? 0) || 0, agg?.count ?? 0),
    paymentMethod: paymentDates.paymentMethod,
    hasPaymentDate: Boolean(paymentDates.lastPaymentDate),
    paymentDateMissing: false,
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
  },
  options?: {
    invoiceIdsWithPaymentInRange?: Set<number>;
    invoiceIdsWithAnyPayment?: Set<number>;
  }
): NormalizedRow[] {
  const search = filters.studentSearch.trim().toLowerCase();
  const applyDateFilter = Boolean(filters.dateFrom || filters.dateTo);
  const isPaymentDateType = filters.dateType === 'last_payment_date';

  return rows.filter((r) => {
    if (isPaymentDateType) {
      const invoiceId = Number(r.invoiceId);
      if (applyDateFilter) {
        if (!options?.invoiceIdsWithPaymentInRange?.has(invoiceId)) return false;
      } else if (!options?.invoiceIdsWithAnyPayment?.has(invoiceId) && !r.lastPaymentDate && (r.paymentCount ?? 0) === 0) {
        return false;
      }
    } else if (applyDateFilter) {
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

function buildSummary(rows: NormalizedRow[], dateType: DateType) {
  let totalInvoiced = 0;
  let paidTotal = 0;
  let outstandingTotal = 0;
  let voidTotal = 0;
  let cancelledTotal = 0;
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

    if (r.paymentDateMissing) {
      paidWithoutPaymentDateCount += 1;
    }
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
    paidWithoutPaymentDateCount,
    summaryNote:
      dateType === 'last_payment_date'
        ? 'Filtered by payment transaction date. Invoice totals are based on invoices linked to payments in the selected date range.'
        : null,
  };
}

function buildCharts(
  rows: NormalizedRow[],
  hasPaymentDates: boolean
) {
  const statusNames: InvoiceStatus[] = ['Paid', 'Pending', 'Void', 'Cancelled'];
  const statusBreakdown = statusNames.map((name) => ({
    name,
    value:
      name === 'Pending'
        ? rows.filter((r) => r.status === 'Pending' || r.status === 'Partially Paid').length
        : rows.filter((r) => r.status === name).length,
  }));

  const paymentMap = new Map<string, number>();
  const invoiceMap = new Map<string, number>();
  const dueMap = new Map<string, number>();

  for (const r of rows) {
    const paymentMonth = monthKey(r.paymentDate ?? r.lastPaymentDate ?? '');
    if (paymentMonth && r.paidAmount > 0) {
      paymentMap.set(paymentMonth, roundMoney((paymentMap.get(paymentMonth) ?? 0) + r.paidAmount));
    }

    const invoiceMonth = monthKey(r.invoiceDate);
    if (invoiceMonth) {
      invoiceMap.set(invoiceMonth, roundMoney((invoiceMap.get(invoiceMonth) ?? 0) + r.invoiceAmount));
    }

    if (r.balance > 0) {
      const dueMonth = monthKey(r.dueDate) || monthKey(r.invoiceDate);
      if (dueMonth) {
        dueMap.set(dueMonth, roundMoney((dueMap.get(dueMonth) ?? 0) + r.balance));
      }
    }
  }

  const monthlyByPaymentDate = [...paymentMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

  const monthlyByInvoiceDate = [...invoiceMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }));

  const outstandingByDueMonth = [...dueMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, outstanding]) => ({ month, outstanding }));

  return {
    statusBreakdown,
    monthlyByPaymentDate,
    monthlyByInvoiceDate,
    outstandingByDueMonth,
    paymentDatesAvailable: hasPaymentDates,
    paymentTrendWarning: hasPaymentDates ? null : PAYMENT_UNAVAILABLE_WARNING,
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

  let dateFrom = typeof body.dateFrom === 'string' ? body.dateFrom.trim() : '';
  let dateTo = typeof body.dateTo === 'string' ? body.dateTo.trim() : '';
  const dateRangeClamped = clampReportDateRange(dateFrom, dateTo);
  dateFrom = dateRangeClamped.dateFrom;
  dateTo = dateRangeClamped.dateTo;
  const dateTypeRaw = typeof body.dateType === 'string' ? body.dateType.trim().toLowerCase() : 'invoice_date';
  const dateType: DateType =
    dateTypeRaw === 'due_date'
      ? 'due_date'
      : dateTypeRaw === 'ledger_date'
        ? 'ledger_date'
        : dateTypeRaw === 'entry_date'
          ? 'entry_date'
          : dateTypeRaw === 'last_payment_date' || dateTypeRaw === 'payment_date'
            ? 'last_payment_date'
            : 'invoice_date';

  const reportViewRaw = typeof body.reportView === 'string' ? body.reportView.trim().toLowerCase() : '';
  const reportView: ReportView = reportViewRaw === 'ledger' ? 'ledger' : 'invoice_directory';

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
    const [{ data, error }, { count: paymentCount }, { data: allPayments }, { data: allAllocations }, { data: allLedger, count: ledgerCount }] =
      await Promise.all([
      supabase
        .from('ax_invoices')
        .select(
          'invoice_id, invoice_number, contact_id, student_name, email, invoice_date, due_date, invoice_amount, paid_amount, balance, is_paid, is_void, is_cancelled, first_payment_date, last_payment_date, payment_count, payment_method, updated_at'
        )
        .order('invoice_date', { ascending: true, nullsFirst: false }),
      supabase.from('ax_invoice_payments').select('*', { count: 'exact', head: true }),
      supabase
        .from('ax_invoice_payments')
        .select(
          'payment_id, transaction_id, invoice_id, invoice_number, contact_id, student_name, payment_date, transaction_date, payment_method, transaction_type, payment_amount, unapplied_amount, user_full_name, reference, raw_json'
        ),
      supabase
        .from('ax_invoice_payment_allocations')
        .select(
          'invoice_id, payment_id, allocated_amount, allocation_date, payment_method, match_method, match_confidence'
        ),
      supabase
        .from('ax_student_ledger_entries')
        .select(
          'ledger_entry_id, contact_id, student_name, email, ledger_date, entry_datetime, entry_type, reference, description, related_invoice_number, related_invoice_id, debit, credit, balance, payment_method, updated_at'
        )
        .order('ledger_date', { ascending: true, nullsFirst: false }),
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
    const allocationRecords = (allAllocations ?? []) as DbAllocation[];
    const ledgerEntries = (allLedger ?? []) as DbLedgerEntry[];
    const invoiceByNumber = buildInvoiceByNumberMap(dbRows);

    if (reportView === 'ledger') {
      const ledgerDateType: LedgerDateType =
        dateType === 'entry_date'
          ? 'entry_date'
          : dateType === 'last_payment_date'
            ? 'payment_date'
            : 'ledger_date';

      const filteredLedger = filterLedgerEntries(ledgerEntries, {
        dateFrom,
        dateTo,
        dateType: ledgerDateType,
        studentSearch,
        paymentsOnly: dateType === 'last_payment_date',
      });
      const ledgerRows = filteredLedger.map(dbToLedgerRow);
      const ledgerSummary = buildLedgerSummary(ledgerRows);
      const lastSyncedAt =
        ledgerEntries
          .map((r) => r.updated_at)
          .filter(Boolean)
          .sort()
          .at(-1) ?? null;

      return jsonResponse({
        success: true,
        reportView: 'ledger',
        summary: buildSummary([], dateType),
        ledgerSummary,
        rows: [],
        ledgerRows,
        charts: buildCharts([], false),
        debug: {
          invoiceCount: dbRows.length,
          paymentCount: paymentCount ?? 0,
          ledgerCount: ledgerCount ?? ledgerEntries.length,
          ledgerRowsTotal: ledgerEntries.length,
          ledgerRowsFiltered: ledgerRows.length,
          matchedPaymentCount: 0,
          unmatchedPaymentCount: 0,
          rowsWithPaymentDate: 0,
          rowsWithoutPaymentDate: 0,
          paymentEndpointUsed: null,
          paymentEndpointWarning: null,
          rawCount: ledgerEntries.length,
          filteredCount: ledgerRows.length,
          minInvoiceDate: null,
          maxInvoiceDate: null,
          dateFilterApplied: Boolean(dateFrom || dateTo),
          dateType,
          dateFrom,
          dateTo,
          dateRangeClamped: dateRangeClamped.clamped,
          lastSyncedAt,
          reportView,
        },
      });
    }

    const ledgerPaymentMap = buildInvoicePaymentMapFromLedger(ledgerEntries);
    const paymentAggregates = buildPaymentAggregates(paymentRecords, dbRows);
    const allocationPaymentMap = buildInvoicePaymentMapFromAllocations(allocationRecords);
    const directPaymentMap = buildInvoicePaymentMap(paymentRecords, dbRows, invoiceByNumber);

    const normalized = dbRows.map((r) => {
      const base = dbToRow(
        enrichInvoiceWithPayments(r, paymentAggregates.get(r.invoice_id)),
        paymentAggregates.get(r.invoice_id)
      );
      const paymentEntries = mergeLedgerPaymentEntries(
        r.invoice_id,
        ledgerPaymentMap,
        resolveInvoicePaymentEntries(r.invoice_id, allocationPaymentMap, directPaymentMap, base)
      );
      return applyPaymentDisplayToRow(base, paymentEntries, dateType, dateFrom, dateTo);
    });

    const allPaymentTransactions = buildPaymentTransactionRows(paymentRecords, dbRows, invoiceByNumber);
    const invoiceStatusById = new Map(normalized.map((r) => [r.invoiceId, r.status]));

    const invoiceIdsWithAnyPayment = new Set([
      ...buildInvoiceIdsWithAnyPayment(paymentRecords, dbRows, invoiceByNumber),
      ...allocationRecords.map((a) => a.invoice_id),
    ]);

    const ledgerInvoiceIdsInRange =
      dateType === 'last_payment_date' && (dateFrom || dateTo) && ledgerEntries.length > 0
        ? buildInvoiceIdsFromLedgerPayments(ledgerEntries, dateFrom, dateTo, 'payment_date')
        : new Set<number>();

    const paymentDateFilterResult =
      dateType === 'last_payment_date' && (dateFrom || dateTo) && ledgerInvoiceIdsInRange.size === 0
        ? allocatePaymentsForDateFilter(paymentRecords, dbRows, dateFrom, dateTo)
        : null;

    const invoiceIdsWithPaymentInRange =
      ledgerInvoiceIdsInRange.size > 0
        ? ledgerInvoiceIdsInRange
        : paymentDateFilterResult
          ? paymentDateFilterResult.invoiceIdsInRange
          : dateType === 'last_payment_date' && (dateFrom || dateTo)
            ? new Set([
                ...buildInvoiceIdsWithAllocationInRange(allocationRecords, dateFrom, dateTo),
                ...buildInvoiceIdsWithPaymentsInRange(paymentRecords, dbRows, invoiceByNumber, dateFrom, dateTo),
              ])
            : undefined;

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

    const hasPaymentDates =
      normalized.some((r) => r.hasPaymentDate) ||
      allPaymentTransactions.some((t) => Boolean(t.transactionDate ?? t.paymentDate));
    const rowsWithPaymentDate = normalized.filter((r) => r.hasPaymentDate).length;
    const rowsWithoutPaymentDate = normalized.length - rowsWithPaymentDate;

    const paymentTransactionsInDateRange =
      paymentDateFilterResult != null
        ? paymentRecords.filter(
            (p) =>
              isAxMoneyReceivedPayment(p) &&
              !isExcludedPaymentMethod(p.payment_method) &&
              isPaymentDayInRange(paymentDateDay(p), dateFrom, dateTo)
          )
        : dateFrom || dateTo
          ? allPaymentTransactions.filter((t) => {
              const day = (t.transactionDate ?? t.paymentDate ?? '').slice(0, 10);
              return isPaymentDayInRange(day, dateFrom, dateTo);
            })
          : allPaymentTransactions;

    let unmatchedPaymentsInDateRange = 0;
    for (const p of paymentRecords) {
      const day = paymentDateDay(p);
      if (!isPaymentDayInRange(day, dateFrom, dateTo)) continue;
      if (!resolvePaymentInvoiceId(p, invoiceByNumber, dbRows)) unmatchedPaymentsInDateRange += 1;
    }

    const distinctInvoicesWithPaymentsInDateRange = paymentDateFilterResult
      ? paymentDateFilterResult.invoiceIdsInRange.size
      : new Set(
          allPaymentTransactions
            .filter((t) => {
              const day = (t.transactionDate ?? t.paymentDate ?? '').slice(0, 10);
              return isPaymentDayInRange(day, dateFrom, dateTo);
            })
            .map((t) => t.invoiceId)
            .filter(Boolean)
        ).size;

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

    const filteredPaymentTransactions = filterPaymentTransactionsForReport(
      allPaymentTransactions,
      { dateFrom, dateTo, dateType, status, studentSearch },
      invoiceStatusById
    );

    const dbInvoiceIdSet = new Set(dbRows.map((r) => r.invoice_id));
    const paymentDiagnostics =
      dateType === 'last_payment_date'
        ? buildPaymentDiagnostics(
            allPaymentTransactions,
            filteredPaymentTransactions,
            dateFrom,
            dateTo,
            studentSearch,
            dbInvoiceIdSet
          )
        : undefined;

    const filtered = applyFilters(
      normalized,
      {
        dateFrom,
        dateTo,
        dateType,
        status,
        studentSearch,
      },
      {
        invoiceIdsWithPaymentInRange,
        invoiceIdsWithAnyPayment,
      }
    ).map((row) => {
      const invoiceId = Number(row.invoiceId);
      let paymentEntries =
        ledgerInvoiceIdsInRange.size > 0
          ? buildLedgerPaymentEntriesInRange(ledgerEntries, invoiceId, dateFrom, dateTo)
          : paymentDateFilterResult != null
            ? paymentDateFilterResult.invoicePaymentEntriesInRange.get(invoiceId) ?? []
            : mergeLedgerPaymentEntries(
                invoiceId,
                ledgerPaymentMap,
                resolveInvoicePaymentEntries(invoiceId, allocationPaymentMap, directPaymentMap, row)
              );
      if (paymentEntries.length === 0) {
        paymentEntries = mergeLedgerPaymentEntries(
          invoiceId,
          ledgerPaymentMap,
          resolveInvoicePaymentEntries(invoiceId, allocationPaymentMap, directPaymentMap, row)
        );
      }
      return applyPaymentDisplayToRow(row, paymentEntries, dateType, dateFrom, dateTo);
    });

    if (paymentDateFilterResult) {
      paymentDateFilterResult.debug.invoiceRowsReturned = filtered.length;
    }

    const paidInvoiceRows = filtered.filter(
      (r) =>
        (r.status === 'Paid' || r.status === 'Partially Paid') &&
        r.paidAmount > 0 &&
        !r.isVoid &&
        !r.isCancelled
    );
    const paidInvoicesTotal = paidInvoiceRows.length;
    const paidInvoicesWithPaymentDate = paidInvoiceRows.filter((r) => r.hasPaymentDate).length;
    const paidInvoicesMissingPaymentDate = paidInvoiceRows.filter((r) => r.paymentDateMissing).length;
    const allocationDiagnostics = buildAllocationDiagnostics(allocationRecords);

    return jsonResponse({
      success: true,
      reportView: 'invoice_directory',
      debug: {
        invoiceCount: normalized.length,
        invoiceRowsTotal: normalized.length,
        invoiceRowsFiltered: filtered.length,
        paymentCount: paymentCount ?? 0,
        ledgerCount: ledgerCount ?? ledgerEntries.length,
        ledgerRowsTotal: ledgerEntries.length,
        ledgerInvoiceIdsInRange: ledgerInvoiceIdsInRange.size,
        paymentTransactionsTotal: allPaymentTransactions.length,
        paymentTransactionsInDateRange: paymentDateFilterResult
          ? paymentDateFilterResult.debug.paymentTransactionsInRange
          : paymentTransactionsInDateRange.length,
        paymentDateFilterDebug: paymentDateFilterResult?.debug ?? null,
        distinctInvoicesWithPaymentsInDateRange,
        unmatchedPaymentsInDateRange,
        matchedPaymentCount,
        unmatchedPaymentCount,
        rowsWithPaymentDate,
        rowsWithoutPaymentDate,
        missingInvoiceIdsFromLocalCache: paymentDiagnostics?.missingInvoiceIdsFromLocalCache ?? [],
        paidInvoicesMissingPaymentDate,
        paidInvoicesTotal,
        paidInvoicesWithPaymentDate,
        allocationsCreated: allocationDiagnostics.allocationsCreated,
        highConfidenceAllocations: allocationDiagnostics.highConfidenceAllocations,
        mediumConfidenceAllocations: allocationDiagnostics.mediumConfidenceAllocations,
        lowConfidenceAllocations: allocationDiagnostics.lowConfidenceAllocations,
        distinctAllocatedInvoices: allocationDiagnostics.distinctAllocatedInvoices,
        unmatchedPayments: unmatchedPaymentCount,
        unallocatedPaidInvoices: paidInvoicesMissingPaymentDate,
        paymentDiagnostics,
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
        dateRangeClamped: dateRangeClamped.clamped,
        lastSyncedAt,
        debugPaymentTransactions: filteredPaymentTransactions,
      },
      summary: buildSummary(filtered, dateType),
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
