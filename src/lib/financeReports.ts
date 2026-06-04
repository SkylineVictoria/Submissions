import { supabase } from './supabase';
import type {
  FinanceReportsFilters,
  FinanceReportsResponse,
  FinanceReportsSuccessResponse,
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

const todayIso = () => new Date().toISOString().slice(0, 10);

export function getDefaultFinanceFilters(): FinanceReportsFilters {
  return {
    dateFrom: '2024-01-01',
    dateTo: todayIso(),
    status: 'all',
    studentSearch: '',
    course: '',
    agent: '',
  };
}

export const DEFAULT_FINANCE_FILTERS: FinanceReportsFilters = getDefaultFinanceFilters();

export async function callAxcelerateFinanceReports(
  filters: FinanceReportsFilters
): Promise<FinanceReportsResponse> {
  const payload = {
    dateFrom: toIsoDate(filters.dateFrom),
    dateTo: toIsoDate(filters.dateTo),
    status: filters.status,
    studentSearch: filters.studentSearch || '',
    course: filters.course || '',
    agent: filters.agent || '',
  };

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

// Placeholder for future reminder_logs persistence (Supabase table not created yet).
export type FinanceReminderLogPlaceholder = {
  invoiceId: string;
  sentAt: string;
  sentBy: number | null;
};
