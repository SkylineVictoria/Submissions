import { supabase } from '../lib/supabase';
import type {
  FinanceReportsFilters,
  FinanceReportsResponse,
  FinanceReportsSuccessResponse,
  FinanceSyncResponse,
} from '../types/financeReports';

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

export function getDefaultFinanceFilters(): FinanceReportsFilters {
  return {
    dateFrom: '',
    dateTo: '',
    dateType: 'invoice_date',
    status: 'all',
    studentSearch: '',
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

function buildReportsPayload(filters: FinanceReportsFilters): Record<string, string> {
  const dateFrom = toIsoDate(filters.dateFrom);
  const dateTo = toIsoDate(filters.dateTo);
  const payload: Record<string, string> = {
    dateType: filters.dateType,
    status: filters.status,
    studentSearch: filters.studentSearch || '',
  };
  if (dateFrom) payload.dateFrom = dateFrom;
  if (dateTo) payload.dateTo = dateTo;
  return payload;
}

export async function callAxcelerateFinanceReports(
  filters: FinanceReportsFilters
): Promise<FinanceReportsResponse> {
  const payload = buildReportsPayload(filters);

  console.log('Finance filters', payload);

  const { data, error } = await supabase.functions.invoke('axcelerate-finance-reports', {
    body: payload,
  });

  console.log('Finance response', (data as { debug?: unknown } | null)?.debug);

  if (error) {
    return {
      success: false,
      message: error.message || 'Failed to load finance reports.',
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
  options?: { contactID?: string; offset?: number; limit?: number }
): Promise<FinanceSyncResponse> {
  const body: Record<string, string | number> = {};
  if (options?.contactID?.trim()) body.contactID = options.contactID.trim();
  if (options?.offset != null) body.offset = options.offset;
  if (options?.limit != null) body.limit = options.limit;

  const { data, error } = await supabase.functions.invoke('axcelerate-finance-sync', { body });

  if (error) {
    return {
      success: false,
      message: error.message || 'Failed to sync invoices from aXcelerate.',
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

/** Runs batched sync until hasMore is false (safe for Edge Function CPU/time limits). */
export async function syncAxcelerateFinance(
  contactID?: string,
  onProgress?: (progress: { processed: number; total: number }) => void
): Promise<FinanceSyncResponse> {
  if (contactID?.trim()) {
    return syncAxcelerateFinanceBatch({ contactID: contactID.trim() });
  }

  let offset = 0;
  let totalContacts = 0;
  let syncedContacts = 0;
  let syncedInvoices = 0;
  let insertedOrUpdated = 0;
  const errors: string[] = [];

  while (true) {
    const batch = await syncAxcelerateFinanceBatch({ offset });
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
    if (batch.errors?.length) errors.push(...batch.errors);

    const processed = batch.hasMore ? (batch.nextOffset ?? offset + batch.syncedContacts) : totalContacts;
    onProgress?.({ processed: Math.min(processed, totalContacts || processed), total: totalContacts || processed });

    if (!batch.hasMore) {
      return {
        success: true,
        syncedContacts,
        syncedInvoices,
        insertedOrUpdated,
        errors,
        totalContacts,
        hasMore: false,
        nextOffset: null,
      };
    }

    offset = batch.nextOffset ?? offset + batch.syncedContacts;
  }
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
    'Course',
    'Agent',
    'Invoice No',
    'Invoice Date',
    'Due Date',
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
        r.course,
        r.agent,
        r.invoiceNo,
        r.invoiceDate,
        r.dueDate,
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
