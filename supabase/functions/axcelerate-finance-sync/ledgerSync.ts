// Sync aXcelerate contact Ledger View into ax_student_ledger_entries.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const LEDGER_ENDPOINT_CANDIDATES = [
  '/accounting/ledger/?contactID=',
  '/accounting/contactLedger/?contactID=',
  '/accounting/contact/ledger/?contactID=',
  '/accounting/finance/ledger/?contactID=',
  '/accounting/transaction/?contactID=',
] as const;

export const LEDGER_UNAVAILABLE_WARNING =
  'Ledger endpoint not found. Need to inspect aXcelerate API/network request for Ledger View.';

const LEDGER_VIEW_QUERY = '&view=ledger';

export type LedgerEndpointState = {
  path: string | null;
  checked: boolean;
  warning: string | null;
};

export type AxLedgerRow = {
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
  debit: number;
  credit: number;
  balance: number;
  payment_method: string | null;
  raw_json: Record<string, unknown>;
};

export type LedgerSyncContactResult = {
  rowsFetched: number;
  rowsUpserted: number;
  rowsWithRelatedInvoice: number;
  rowsWithoutRelatedInvoice: number;
  rowsLinkedToInvoice: number;
  rowsUnlinkedToInvoice: number;
  sampleRawKeys: string[];
  sampleRows: Record<string, unknown>[];
};

export type LedgerSyncAggregate = {
  ledgerEndpointUsed: string | null;
  ledgerEndpointWarning: string | null;
  ledgerContactsSynced: number;
  ledgerRowsFetched: number;
  ledgerRowsUpserted: number;
  ledgerRowsWithRelatedInvoice: number;
  ledgerRowsWithoutRelatedInvoice: number;
  ledgerRowsLinkedToInvoice: number;
  ledgerRowsUnlinkedToInvoice: number;
  sampleLedgerRows: Record<string, unknown>[];
  sampleLedgerRawKeys: string[];
};

type AxFetchResult = {
  ok: boolean;
  status: number;
  payload: unknown;
  text: string;
};

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
    for (const variant of variants) {
      const v = map.get(variant);
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
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
    obj.ledger,
    obj.LEDGER,
    obj.entries,
    obj.ENTRIES,
    obj.rows,
    obj.ROWS,
    obj.transactions,
    obj.TRANSACTIONS,
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

function parseDateTime(value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const hh = iso[4] ?? '00';
    const mm = iso[5] ?? '00';
    const ss = iso[6] ?? '00';
    return `${iso[1]}-${iso[2]}-${iso[3]}T${hh}:${mm}:${ss}Z`;
  }
  const dmy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    const hh = dmy[4]?.padStart(2, '0') ?? '00';
    const min = dmy[5]?.padStart(2, '0') ?? '00';
    const ss = dmy[6]?.padStart(2, '0') ?? '00';
    return `${dmy[3]}-${mm}-${dd}T${hh}:${min}:${ss}Z`;
  }
  const parsed = Date.parse(v);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return null;
}

function parseLedgerDate(value: string): string | null {
  const dt = parseDateTime(value);
  return dt ? dt.slice(0, 10) : null;
}

/** Extract SINV invoice number from ledger related-invoice text. */
export function extractRelatedInvoiceNumber(raw: string): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const match = v.match(/SINV[0-9]+/i);
  return match ? match[0].toUpperCase() : null;
}

function normalizeInvoiceNumber(value: string): string {
  return String(value ?? '').trim().toUpperCase().replace(/^0+/, '');
}

export function buildLedgerEntryId(
  contactId: number | null,
  row: Record<string, unknown>,
  relatedInvoiceNumber: string | null,
  debit: number,
  credit: number
): string {
  const apiId = pickField(row, 'LEDGERID', 'ledgerId', 'ledger_id', 'ID', 'id', 'ENTRYID', 'entryId');
  if (apiId) return `api:${apiId}`;

  const reference = pickField(row, 'REFERENCE', 'Reference', 'ref', 'TRANSACTIONID', 'transactionId');
  const ledgerDate =
    parseLedgerDate(pickField(row, 'DATE', 'Date', 'date', 'LEDGERDATE', 'ledgerDate')) ?? '';
  const entryType = pickField(row, 'TYPE', 'Type', 'entryType', 'TRANSACTIONTYPE', 'transactionType');
  return [
    String(contactId ?? ''),
    reference,
    ledgerDate,
    entryType,
    relatedInvoiceNumber ?? '',
    String(debit),
    String(credit),
  ].join('|');
}

function normalizeLedgerRow(
  row: Record<string, unknown>,
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  endpoint: string
): AxLedgerRow | null {
  const ledgerDateRaw = pickField(row, 'DATE', 'Date', 'date', 'LEDGERDATE', 'ledgerDate');
  const entryDateRaw = pickField(
    row,
    'ENTRYDATE',
    'Entry Date',
    'entryDate',
    'CREATEDDATE',
    'createdDate',
    'DATETIME',
    'datetime'
  );
  const entryDatetime = parseDateTime(entryDateRaw || ledgerDateRaw);
  const ledgerDate = parseLedgerDate(ledgerDateRaw || entryDateRaw);

  const relatedRaw = pickField(
    row,
    'RELATEDINVOICES',
    'Related Invoices',
    'relatedInvoices',
    'INVOICE',
    'invoice',
    'INVOICENR',
    'invoiceNumber',
    'INVOICENUMBER'
  );
  const relatedInvoiceNumber = extractRelatedInvoiceNumber(relatedRaw);

  const debit = parseNumber(pickField(row, 'DEBIT', 'Debit', 'debit') || row.DEBIT || row.debit);
  const credit = parseNumber(pickField(row, 'CREDIT', 'Credit', 'credit') || row.CREDIT || row.credit);
  const balance = parseNumber(pickField(row, 'BALANCE', 'Balance', 'balance') || row.BALANCE || row.balance);

  const entryType = pickField(row, 'TYPE', 'Type', 'entryType', 'TRANSACTIONTYPE', 'transactionType') || null;
  const reference = pickField(row, 'REFERENCE', 'Reference', 'ref', 'TRANSACTIONID', 'transactionId') || null;
  const description = pickField(row, 'DESCRIPTION', 'Description', 'DETAILS', 'details') || null;
  const paymentMethod = pickField(row, 'PAYMENTMETHOD', 'Payment Method', 'paymentMethod', 'METHOD', 'method') || null;

  const studentName =
    pickField(row, 'FULLNAME', 'Full Name', 'fullName', 'STUDENTNAME', 'studentName', 'CONTACTNAME', 'contactName') ||
    hint?.name ||
    null;

  const email = pickField(row, 'EMAIL', 'email', 'Email') || hint?.email || null;

  const ledgerEntryId = buildLedgerEntryId(contactId, row, relatedInvoiceNumber, debit, credit);

  return {
    ledger_entry_id: ledgerEntryId,
    contact_id: contactId,
    student_name: studentName,
    email,
    ledger_date: ledgerDate,
    entry_datetime: entryDatetime,
    entry_type: entryType,
    reference,
    description,
    related_invoice_number: relatedInvoiceNumber,
    related_invoice_id: null,
    debit,
    credit,
    balance,
    payment_method: paymentMethod,
    raw_json: { ...row, _endpoint: endpoint },
  };
}

function ledgerPathForContact(basePath: string, contactId: number): string {
  if (basePath.includes('transaction')) {
    return `${basePath}${contactId}${LEDGER_VIEW_QUERY}`;
  }
  return `${basePath}${contactId}`;
}

export async function resolveLedgerEndpoint(
  axFetch: (path: string) => Promise<AxFetchResult>,
  contactId: number,
  state: LedgerEndpointState
): Promise<LedgerEndpointState> {
  if (state.checked) return state;

  for (const base of LEDGER_ENDPOINT_CANDIDATES) {
    const path = ledgerPathForContact(base, contactId);
    const { ok, payload } = await axFetch(path);
    if (!ok) continue;
    const records = parseRecordList(payload);
    if (records.length > 0) {
      return { path: base, checked: true, warning: null };
    }
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const obj = payload as Record<string, unknown>;
      if (Object.keys(obj).length > 0 && (obj.DATA != null || obj.data != null || obj.ledger != null)) {
        return { path: base, checked: true, warning: null };
      }
    }
  }

  return {
    path: null,
    checked: true,
    warning: LEDGER_UNAVAILABLE_WARNING,
  };
}

async function loadInvoiceIdByNumber(
  supabase: SupabaseClient,
  numbers: string[]
): Promise<Map<string, number>> {
  const unique = [...new Set(numbers.map(normalizeInvoiceNumber).filter(Boolean))];
  const map = new Map<string, number>();
  if (unique.length === 0) return map;

  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { data } = await supabase
      .from('ax_invoices')
      .select('invoice_id, invoice_number')
      .in('invoice_number', chunk);
    for (const row of data ?? []) {
      const num = normalizeInvoiceNumber(String((row as { invoice_number?: string }).invoice_number ?? ''));
      const id = Number((row as { invoice_id?: number }).invoice_id);
      if (num && Number.isFinite(id)) map.set(num, id);
    }
  }
  return map;
}

function linkLedgerRowsToInvoices(
  rows: AxLedgerRow[],
  invoiceIdByNumber: Map<string, number>
): { linked: number; unlinked: number } {
  let linked = 0;
  let unlinked = 0;
  for (const row of rows) {
    if (!row.related_invoice_number) {
      unlinked += 1;
      continue;
    }
    const id = invoiceIdByNumber.get(normalizeInvoiceNumber(row.related_invoice_number));
    if (id != null) {
      row.related_invoice_id = id;
      linked += 1;
    } else {
      unlinked += 1;
    }
  }
  return { linked, unlinked };
}

export async function syncContactLedger(
  axFetch: (path: string) => Promise<AxFetchResult>,
  supabase: SupabaseClient,
  contactId: number,
  hint: { name?: string; email?: string } | undefined,
  errors: string[],
  endpointState: LedgerEndpointState
): Promise<{ result: LedgerSyncContactResult; endpointState: LedgerEndpointState }> {
  const empty: LedgerSyncContactResult = {
    rowsFetched: 0,
    rowsUpserted: 0,
    rowsWithRelatedInvoice: 0,
    rowsWithoutRelatedInvoice: 0,
    rowsLinkedToInvoice: 0,
    rowsUnlinkedToInvoice: 0,
    sampleRawKeys: [],
    sampleRows: [],
  };

  const resolved = await resolveLedgerEndpoint(axFetch, contactId, endpointState);
  if (!resolved.path) {
    return { result: empty, endpointState: resolved };
  }

  const path = ledgerPathForContact(resolved.path, contactId);
  const { ok, status, payload } = await axFetch(path);
  if (!ok) {
    errors.push(`contact ${contactId}: ledger fetch failed (${status})`);
    return { result: empty, endpointState: resolved };
  }

  const records = parseRecordList(payload);
  const endpointTag = resolved.path.split('?')[0];
  const rows: AxLedgerRow[] = [];
  let sampleRawKeys: string[] = [];
  const sampleRows: Record<string, unknown>[] = [];

  for (const record of records) {
    if (sampleRawKeys.length === 0) sampleRawKeys = Object.keys(record).slice(0, 40);
    const normalized = normalizeLedgerRow(record, contactId, hint, endpointTag);
    if (normalized) rows.push(normalized);
    if (sampleRows.length < 3) {
      sampleRows.push({
        entryType: normalized?.entry_type,
        reference: normalized?.reference,
        relatedInvoice: normalized?.related_invoice_number,
        credit: normalized?.credit,
        debit: normalized?.debit,
        ledgerDate: normalized?.ledger_date,
      });
    }
  }

  if (rows.length === 0) {
    return { result: empty, endpointState: resolved };
  }

  const invoiceNumbers = rows.map((r) => r.related_invoice_number).filter(Boolean) as string[];
  const invoiceIdByNumber = await loadInvoiceIdByNumber(supabase, invoiceNumbers);
  const { linked, unlinked } = linkLedgerRowsToInvoices(rows, invoiceIdByNumber);

  const rowsWithRelatedInvoice = rows.filter((r) => r.related_invoice_number).length;
  const rowsWithoutRelatedInvoice = rows.length - rowsWithRelatedInvoice;

  let rowsUpserted = 0;
  const { error: upsertError } = await supabase.from('ax_student_ledger_entries').upsert(rows, {
    onConflict: 'ledger_entry_id',
  });
  if (upsertError) {
    errors.push(`contact ${contactId}: ledger upsert failed (${upsertError.message})`);
  } else {
    rowsUpserted = rows.length;
  }

  return {
    result: {
      rowsFetched: rows.length,
      rowsUpserted,
      rowsWithRelatedInvoice,
      rowsWithoutRelatedInvoice,
      rowsLinkedToInvoice: linked,
      rowsUnlinkedToInvoice: unlinked,
      sampleRawKeys,
      sampleRows,
    },
    endpointState: resolved,
  };
}

export function emptyLedgerAggregate(warning: string | null = LEDGER_UNAVAILABLE_WARNING): LedgerSyncAggregate {
  return {
    ledgerEndpointUsed: null,
    ledgerEndpointWarning: warning,
    ledgerContactsSynced: 0,
    ledgerRowsFetched: 0,
    ledgerRowsUpserted: 0,
    ledgerRowsWithRelatedInvoice: 0,
    ledgerRowsWithoutRelatedInvoice: 0,
    ledgerRowsLinkedToInvoice: 0,
    ledgerRowsUnlinkedToInvoice: 0,
    sampleLedgerRows: [],
    sampleLedgerRawKeys: [],
  };
}

export function mergeLedgerAggregate(
  agg: LedgerSyncAggregate,
  contactResult: LedgerSyncContactResult,
  endpointUsed: string | null
): void {
  agg.ledgerContactsSynced += 1;
  agg.ledgerRowsFetched += contactResult.rowsFetched;
  agg.ledgerRowsUpserted += contactResult.rowsUpserted;
  agg.ledgerRowsWithRelatedInvoice += contactResult.rowsWithRelatedInvoice;
  agg.ledgerRowsWithoutRelatedInvoice += contactResult.rowsWithoutRelatedInvoice;
  agg.ledgerRowsLinkedToInvoice += contactResult.rowsLinkedToInvoice;
  agg.ledgerRowsUnlinkedToInvoice += contactResult.rowsUnlinkedToInvoice;
  if (agg.sampleLedgerRawKeys.length === 0 && contactResult.sampleRawKeys.length > 0) {
    agg.sampleLedgerRawKeys = contactResult.sampleRawKeys;
  }
  if (agg.sampleLedgerRows.length < 5) {
    agg.sampleLedgerRows.push(...contactResult.sampleRows.slice(0, 5 - agg.sampleLedgerRows.length));
  }
  if (endpointUsed) agg.ledgerEndpointUsed = endpointUsed;
}
