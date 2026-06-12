// Student Ledger report from ax_student_ledger_entries cache.

export type DbLedgerEntry = {
  ledger_entry_id: string;
  contact_id: number | null;
  student_name: string | null;
  email: string | null;
  ledger_date: string | null;
  entry_datetime: string | null;
  entry_type: string | null;
  reference: string | null;
  description: string | null;
  related_invoice_number: string | null;
  related_invoice_id: number | null;
  debit: number | string | null;
  credit: number | string | null;
  balance: number | string | null;
  payment_method: string | null;
  updated_at?: string | null;
};

export type LedgerReportRow = {
  contactId: string;
  studentName: string;
  email: string;
  ledgerDate: string;
  entryDateTime: string | null;
  entryType: string;
  reference: string;
  description: string;
  relatedInvoiceNo: string;
  relatedInvoiceId: string;
  debit: number;
  credit: number;
  balance: number;
  paymentMethod: string;
};

export type LedgerReportSummary = {
  totalDebit: number;
  totalCredit: number;
  netMovement: number;
  paymentReceivedTotal: number;
  invoiceDebitTotal: number;
  ledgerEntries: number;
  summaryNote: string | null;
};

export type LedgerDateType = 'ledger_date' | 'entry_date' | 'payment_date';

function parseAmount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function ledgerDay(entry: DbLedgerEntry): string {
  if (entry.ledger_date) return String(entry.ledger_date).slice(0, 10);
  if (entry.entry_datetime) return String(entry.entry_datetime).slice(0, 10);
  return '';
}

function entryDay(entry: DbLedgerEntry): string {
  if (entry.entry_datetime) return String(entry.entry_datetime).slice(0, 10);
  return ledgerDay(entry);
}

function isDayInRange(day: string, dateFrom: string, dateTo: string): boolean {
  if (!day) return false;
  if (dateFrom && isIsoDate(dateFrom) && day < dateFrom) return false;
  if (dateTo && isIsoDate(dateTo) && day > dateTo) return false;
  return true;
}

function isPaymentReceivedEntry(entryType: string | null): boolean {
  const t = String(entryType ?? '').toLowerCase();
  return t.includes('payment received') || t.includes('money received');
}

function isInvoiceEntry(entryType: string | null): boolean {
  const t = String(entryType ?? '').toLowerCase();
  return t.includes('invoice') && !t.includes('payment');
}

export function dbToLedgerRow(entry: DbLedgerEntry): LedgerReportRow {
  return {
    contactId: entry.contact_id != null ? String(entry.contact_id) : '',
    studentName: entry.student_name ?? '',
    email: entry.email ?? '',
    ledgerDate: ledgerDay(entry),
    entryDateTime: entry.entry_datetime ? String(entry.entry_datetime) : null,
    entryType: entry.entry_type ?? '',
    reference: entry.reference ?? '',
    description: entry.description ?? '',
    relatedInvoiceNo: entry.related_invoice_number ?? '',
    relatedInvoiceId: entry.related_invoice_id != null ? String(entry.related_invoice_id) : '',
    debit: parseAmount(entry.debit),
    credit: parseAmount(entry.credit),
    balance: parseAmount(entry.balance),
    paymentMethod: entry.payment_method ?? '',
  };
}

export function filterLedgerEntries(
  entries: DbLedgerEntry[],
  filters: {
    dateFrom: string;
    dateTo: string;
    dateType: LedgerDateType;
    studentSearch: string;
    paymentsOnly: boolean;
  }
): DbLedgerEntry[] {
  const search = filters.studentSearch.trim().toLowerCase();
  const applyDate = Boolean(filters.dateFrom || filters.dateTo);

  return entries.filter((entry) => {
    if (filters.paymentsOnly && !isPaymentReceivedEntry(entry.entry_type)) return false;

    if (applyDate) {
      const day =
        filters.dateType === 'entry_date'
          ? entryDay(entry)
          : ledgerDay(entry);
      if (!isDayInRange(day, filters.dateFrom, filters.dateTo)) return false;
    }

    if (search) {
      const hay = [
        entry.student_name,
        entry.email,
        entry.reference,
        entry.related_invoice_number,
        entry.description,
        entry.entry_type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }

    return true;
  });
}

export function buildLedgerSummary(rows: LedgerReportRow[]): LedgerReportSummary {
  let totalDebit = 0;
  let totalCredit = 0;
  let paymentReceivedTotal = 0;
  let invoiceDebitTotal = 0;

  for (const row of rows) {
    totalDebit += row.debit;
    totalCredit += row.credit;
    if (isPaymentReceivedEntry(row.entryType)) paymentReceivedTotal += row.credit;
    if (isInvoiceEntry(row.entryType)) invoiceDebitTotal += row.debit;
  }

  totalDebit = roundMoney(totalDebit);
  totalCredit = roundMoney(totalCredit);
  paymentReceivedTotal = roundMoney(paymentReceivedTotal);
  invoiceDebitTotal = roundMoney(invoiceDebitTotal);

  return {
    totalDebit,
    totalCredit,
    netMovement: roundMoney(totalDebit - totalCredit),
    paymentReceivedTotal,
    invoiceDebitTotal,
    ledgerEntries: rows.length,
    summaryNote: 'Filtered from synced aXcelerate Ledger View entries.',
  };
}

export type InvoicePaymentEntry = { date: string; method: string | null };

/** Enrich invoice payment dates from ledger entries (preferred over transaction matching). */
export function buildInvoicePaymentMapFromLedger(
  entries: DbLedgerEntry[]
): Map<number, InvoicePaymentEntry[]> {
  const map = new Map<number, InvoicePaymentEntry[]>();

  for (const entry of entries) {
    if (!isPaymentReceivedEntry(entry.entry_type)) continue;
    const invoiceId = entry.related_invoice_id;
    if (invoiceId == null || invoiceId <= 0) continue;

    const date = entry.entry_datetime
      ? String(entry.entry_datetime)
      : entry.ledger_date
        ? `${String(entry.ledger_date).slice(0, 10)}T00:00:00Z`
        : null;
    if (!date) continue;

    const list = map.get(invoiceId) ?? [];
    list.push({ date, method: entry.payment_method });
    map.set(invoiceId, list);
  }

  for (const [invoiceId, list] of map.entries()) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    map.set(invoiceId, list);
  }

  return map;
}

export function mergeLedgerPaymentEntries(
  invoiceId: number,
  ledgerMap: Map<number, InvoicePaymentEntry[]>,
  existing: InvoicePaymentEntry[]
): InvoicePaymentEntry[] {
  const fromLedger = ledgerMap.get(invoiceId) ?? [];
  if (fromLedger.length === 0) return existing;
  if (existing.length === 0) return fromLedger;
  const merged = [...fromLedger, ...existing];
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

export function buildInvoiceIdsFromLedgerPayments(
  entries: DbLedgerEntry[],
  dateFrom: string,
  dateTo: string,
  dateType: LedgerDateType
): Set<number> {
  const set = new Set<number>();
  const filtered = filterLedgerEntries(entries, {
    dateFrom,
    dateTo,
    dateType,
    studentSearch: '',
    paymentsOnly: true,
  });
  for (const entry of filtered) {
    if (entry.related_invoice_id != null && entry.related_invoice_id > 0) {
      set.add(entry.related_invoice_id);
    }
  }
  return set;
}

export function buildLedgerPaymentEntriesInRange(
  entries: DbLedgerEntry[],
  invoiceId: number,
  dateFrom: string,
  dateTo: string
): InvoicePaymentEntry[] {
  const list: InvoicePaymentEntry[] = [];
  for (const entry of entries) {
    if (entry.related_invoice_id !== invoiceId) continue;
    if (!isPaymentReceivedEntry(entry.entry_type)) continue;
    const day = ledgerDay(entry);
    if (!isDayInRange(day, dateFrom, dateTo)) continue;
    const date = entry.entry_datetime
      ? String(entry.entry_datetime)
      : day
        ? `${day}T00:00:00Z`
        : null;
    if (!date) continue;
    list.push({ date, method: entry.payment_method });
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  return list;
}
