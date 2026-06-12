import { supabase } from '../lib/supabase';
import type {
  FinanceReportsFilters,
  FinanceReportsResponse,
  FinanceReportsSuccessResponse,
  FinanceSyncResponse,
} from '../types/financeReports';

export const ADJUSTMENT_HELPER_TEXT =
  'Adjustment / Unreconciled represents credit notes, write-offs, cancellations, rounding differences, or other invoice accounting differences not represented by paid, outstanding, or void totals.';

export const FINANCE_MAX_DATE_RANGE_DAYS = 365;

function isoDateToPicker(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function pickerDateToIso(value: string): string {
  return toIsoDate(value);
}

/** Clamp report/sync date range to at most one year (inclusive). */
export function clampFinanceDateRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string; clamped: boolean } {
  const fromIso = pickerDateToIso(dateFrom);
  const toIso = pickerDateToIso(dateTo);
  if (!fromIso || !toIso || !/^\d{4}-\d{2}-\d{2}$/.test(fromIso) || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
    return { dateFrom: dateFrom.trim(), dateTo: dateTo.trim(), clamped: false };
  }
  const fromMs = Date.parse(`${fromIso}T00:00:00Z`);
  const toMs = Date.parse(`${toIso}T23:59:59Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return { dateFrom: dateFrom.trim(), dateTo: dateTo.trim(), clamped: false };
  }
  const maxSpanMs = FINANCE_MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (toMs - fromMs <= maxSpanMs) {
    return { dateFrom: fromIso, dateTo: toIso, clamped: false };
  }
  const clampedFrom = new Date(toMs - maxSpanMs).toISOString().slice(0, 10);
  return { dateFrom: clampedFrom, dateTo: toIso, clamped: true };
}

function mapEdgeFunctionError(message: string, action: 'load' | 'sync'): string {
  const raw = String(message ?? '').trim();
  if (/failed to send a request to the edge function/i.test(raw)) {
    return action === 'sync'
      ? 'Finance sync timed out. Sync runs in small batches — wait a moment and click Sync Now again; progress is saved between batches. Date range is limited to 1 year.'
      : 'Could not reach finance reports. Check your connection and retry.';
  }
  if (/520|timed out|timeout|deadline exceeded/i.test(raw)) {
    return action === 'sync'
      ? 'Finance sync batch timed out. Click Sync Now again to continue from the next batch (max 1 year of payments per run).'
      : 'Finance reports request timed out. Try a shorter date range (max 1 year) and retry.';
  }
  return raw || (action === 'sync' ? 'Failed to sync invoices from aXcelerate.' : 'Failed to load finance reports.');
}

/** Convert UI date (DD-MM-YYYY or YYYY-MM-DD) to ISO YYYY-MM-DD for the Edge Function. */
export function toIsoDate(value: string): string {
  const v = String(value ?? '').trim();

  if (!v) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }

  const match = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);

  if (match) {
    const [, dd, mm, yyyy] = match;
    return `${yyyy}-${mm}-${dd}`;
  }

  return v;
}

function defaultCurrentMonthDateRangePicker(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    dateFrom: isoDateToPicker(from.toISOString().slice(0, 10)),
    dateTo: isoDateToPicker(to.toISOString().slice(0, 10)),
  };
}

export function getDefaultFinanceFilters(): FinanceReportsFilters {
  const { dateFrom, dateTo } = defaultCurrentMonthDateRangePicker();
  return {
    dateFrom,
    dateTo,
    dateType: 'last_payment_date',
    status: 'all',
    studentSearch: '',
    reportView: 'invoice_directory',
  };
}

export const DEFAULT_FINANCE_FILTERS: FinanceReportsFilters = getDefaultFinanceFilters();

/** Persisted while a superadmin manual sync runs (survives page refresh). */
export const FINANCE_SYNC_STORAGE_KEY = 'signflow_finance_ax_sync_in_progress';

const FINANCE_SYNC_MAX_WAIT_MS = 25 * 60 * 1000;
const FINANCE_SYNC_POLL_MS = 20_000;

type FinanceSyncMarker = { startedAt: number };

export function markFinanceSyncInProgress(): void {
  try {
    sessionStorage.setItem(
      FINANCE_SYNC_STORAGE_KEY,
      JSON.stringify({ startedAt: Date.now() } satisfies FinanceSyncMarker)
    );
  } catch {
    /* ignore */
  }
}

export function clearFinanceSyncInProgress(): void {
  try {
    sessionStorage.removeItem(FINANCE_SYNC_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function readFinanceSyncInProgress(): FinanceSyncMarker | null {
  try {
    const raw = sessionStorage.getItem(FINANCE_SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FinanceSyncMarker;
    if (!parsed?.startedAt || !Number.isFinite(parsed.startedAt)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isFinanceSyncMarkerStale(startedAt: number): boolean {
  return Date.now() - startedAt > FINANCE_SYNC_MAX_WAIT_MS;
}

export function getFinanceSyncPollIntervalMs(): number {
  return FINANCE_SYNC_POLL_MS;
}

export async function callAxcelerateFinanceReports(
  filters: FinanceReportsFilters
): Promise<FinanceReportsResponse> {
  const clamped = clampFinanceDateRange(filters.dateFrom, filters.dateTo);
  const dateFrom = toIsoDate(clamped.dateFrom);
  const dateTo = toIsoDate(clamped.dateTo);
  const payload = {
    dateType: filters.dateType,
    status: filters.status,
    studentSearch: filters.studentSearch || '',
    reportView: 'invoice_directory' as const,
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };

  console.log('Finance filters', payload);

  const { data, error } = await supabase.functions.invoke('axcelerate-finance-reports', {
    body: payload,
  });

  console.log('Finance response', (data as { debug?: unknown } | null)?.debug);
  if ((data as { debug?: { paymentDateFilterDebug?: unknown } } | null)?.debug?.paymentDateFilterDebug) {
    console.table((data as { debug: { paymentDateFilterDebug: unknown } }).debug.paymentDateFilterDebug);
  }

  if (error) {
    return {
      success: false,
      message: mapEdgeFunctionError(error.message || '', 'load'),
      details: error,
    };
  }

  const parsed = data as FinanceReportsResponse | null;
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, message: 'Empty response from finance reports service.' };
  }
  if (!parsed.success) {
    return parsed;
  }
  return parsed as FinanceReportsSuccessResponse;
}

export async function syncAxcelerateFinanceBatch(
  options?: {
    contactID?: string;
    offset?: number;
    limit?: number;
    syncMode?: string;
    dateFrom?: string;
    dateTo?: string;
    invoicesOnly?: boolean;
  }
): Promise<FinanceSyncResponse> {
  const body: Record<string, string | number | boolean> = {};
  if (options?.contactID?.trim()) body.contactID = options.contactID.trim();
  if (options?.offset != null) body.offset = options.offset;
  if (options?.limit != null) body.limit = options.limit;
  if (options?.syncMode?.trim()) body.syncMode = options.syncMode.trim();
  if (options?.dateFrom?.trim()) body.dateFrom = options.dateFrom.trim();
  if (options?.dateTo?.trim()) body.dateTo = options.dateTo.trim();
  if (options?.invoicesOnly) body.invoicesOnly = true;

  const { data, error } = await supabase.functions.invoke('axcelerate-finance-sync', { body });

  if (error) {
    return {
      success: false,
      message: mapEdgeFunctionError(error.message || '', 'sync'),
      errors: [],
      details: error,
    };
  }

  const parsed = data as FinanceSyncResponse | null;
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, message: 'Empty response from finance sync service.', errors: [] };
  }
  return parsed;
}

export type FinanceSyncProgress = {
  processed: number;
  total: number;
  syncedPayments: number;
  matchedPaymentCount: number;
};

/** Runs batched sync until hasMore is false (safe for Edge Function CPU/time limits). */
export async function syncAxcelerateFinance(
  contactID?: string,
  onProgress?: (progress: FinanceSyncProgress) => void,
  options?: { dateFrom?: string; dateTo?: string; runTransactionsReportFirst?: boolean }
): Promise<FinanceSyncResponse> {
  if (contactID?.trim()) {
    return syncAxcelerateFinanceBatch({ contactID: contactID.trim() });
  }

  const clamped = clampFinanceDateRange(options?.dateFrom ?? '', options?.dateTo ?? '');
  const syncDateFrom = toIsoDate(clamped.dateFrom);
  const syncDateTo = toIsoDate(clamped.dateTo);

  const errors: string[] = [];
  let syncedPayments = 0;
  let matchedPaymentCount = 0;
  let unmatchedPaymentCount = 0;
  let globalPaymentsSynced = false;

  if (options?.runTransactionsReportFirst && syncDateFrom && syncDateTo) {
    const globalBatch = await syncAxcelerateFinanceBatch({
      syncMode: 'transactions_report',
      dateFrom: syncDateFrom,
      dateTo: syncDateTo,
    });
    if (!globalBatch.success) {
      return globalBatch;
    }
    syncedPayments += globalBatch.syncedPayments ?? 0;
    matchedPaymentCount += globalBatch.matchedPaymentCount ?? 0;
    unmatchedPaymentCount += globalBatch.unmatchedPaymentCount ?? 0;
    globalPaymentsSynced = (globalBatch.syncedPayments ?? 0) > 0;
    if (globalBatch.errors?.length) errors.push(...globalBatch.errors);
    onProgress?.({
      processed: 0,
      total: globalBatch.totalContacts ?? 0,
      syncedPayments,
      matchedPaymentCount,
    });
  }

  const BATCH_LIMIT = 5;
  let offset = 0;
  let totalContacts = 0;
  let syncedContacts = 0;
  let syncedInvoices = 0;
  let insertedOrUpdated = 0;
  let batchLimit = BATCH_LIMIT;

  while (true) {
    let batch = await syncAxcelerateFinanceBatch({
      offset,
      limit: batchLimit,
      dateFrom: syncDateFrom || undefined,
      dateTo: syncDateTo || undefined,
      invoicesOnly: globalPaymentsSynced,
    });

    if (!batch.success && batchLimit > 2) {
      batchLimit = Math.max(2, Math.floor(batchLimit / 2));
      batch = await syncAxcelerateFinanceBatch({
        offset,
        limit: batchLimit,
        dateFrom: syncDateFrom || undefined,
        dateTo: syncDateTo || undefined,
        invoicesOnly: globalPaymentsSynced,
      });
    }

    if (!batch.success) {
      return {
        ...batch,
        errors: [...errors, ...(batch.errors ?? [])],
      };
    }

    totalContacts = batch.totalContacts ?? totalContacts;
    syncedContacts += batch.syncedContacts;
    syncedInvoices += batch.syncedInvoices;
    insertedOrUpdated += batch.insertedOrUpdated;
    syncedPayments += batch.syncedPayments ?? 0;
    matchedPaymentCount += batch.matchedPaymentCount ?? 0;
    unmatchedPaymentCount += batch.unmatchedPaymentCount ?? 0;
    if (batch.errors?.length) errors.push(...batch.errors);

    const processed = batch.hasMore ? (batch.nextOffset ?? offset + batch.syncedContacts) : totalContacts;
    onProgress?.({
      processed: Math.min(processed, totalContacts || processed),
      total: totalContacts || processed,
      syncedPayments,
      matchedPaymentCount,
    });

    if (!batch.hasMore) {
      return {
        success: true,
        syncedContacts,
        syncedInvoices,
        insertedOrUpdated,
        syncedPayments,
        matchedPaymentCount,
        unmatchedPaymentCount,
        errors,
        totalContacts,
        hasMore: false,
        nextOffset: null,
        allocationBackfill: batch.allocationBackfill,
      };
    }

    offset = batch.nextOffset ?? offset + batch.syncedContacts;
  }
}

export function formatPaginationRange(currentPage: number, pageSize: number, totalItems: number): string {
  if (totalItems <= 0) return 'Showing 0 of 0';
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);
  return `Showing ${start} to ${end} of ${totalItems}`;
}

export function formatAud(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatFinanceDate(value: string): string {
  const v = String(value ?? '').trim();
  if (!v) return '—';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v;
}

export function formatPaymentDateTime(value: string | null | undefined, opts?: { unavailableLabel?: string }): string {
  const v = String(value ?? '').trim();
  if (!v) return opts?.unavailableLabel ?? 'Paid date unavailable';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Australia/Melbourne',
    }).format(new Date(v));
  } catch {
    return formatFinanceDate(v);
  }
}

export function formatSyncTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Australia/Melbourne',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function exportFinanceRowsToCsv(rows: import('../types/financeReports').FinanceReportRow[]): void {
  const headers = [
    'Student Name',
    'Email',
    'Invoice No',
    'Invoice Date',
    'Due Date',
    'Payment Date',
    'Payment Method',
    'Invoice Amount',
    'Paid Amount',
    'Balance',
    'Status',
  ];
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.studentName,
        r.email,
        r.invoiceNo,
        r.invoiceDate,
        r.dueDate,
        r.paymentDate ?? r.lastPaymentDate ?? '',
        r.paymentMethod ?? '',
        r.invoiceAmount,
        r.paidAmount,
        r.balance,
        r.status,
      ]
        .map((c) => escape(String(c)))
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finance-reports-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export type FinanceReminderLogPlaceholder = {
  invoiceId: string;
  sentAt: string;
  sentBy: number | null;
};
