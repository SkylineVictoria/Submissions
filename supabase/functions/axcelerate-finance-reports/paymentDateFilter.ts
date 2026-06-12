// Payment Date filter: start from in-range transactions, map to invoices via contact/name/email/FIFO.

export type InvoicePaymentEntry = {
  date: string;
  method: string | null;
};

export type PaymentDateFilterDebug = {
  paymentTransactionsInRange: number;
  paymentsWithDirectInvoiceId: number;
  paymentsWithoutInvoiceId: number;
  paymentsResolvedByContactId: number;
  paymentsResolvedByStudentName: number;
  paymentsAllocatedByFifo: number;
  invoiceRowsReturned: number;
  distinctStudentsInPayments: number;
  distinctStudentsMappedToInvoices: number;
  unmappedPaymentSamples: Array<{
    studentName: string;
    paymentAmount: number;
    paymentDate: string | null;
    reference: string | null;
    contactId: string | null;
    rawJsonKeys: string[];
  }>;
};

export type PaymentDateFilterResult = {
  invoiceIdsInRange: Set<number>;
  invoicePaymentEntriesInRange: Map<number, InvoicePaymentEntry[]>;
  debug: PaymentDateFilterDebug;
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
  is_void: boolean | null;
  is_cancelled: boolean | null;
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
  user_full_name: string | null;
  reference: string | null;
  raw_json: Record<string, unknown> | null;
};

type InternalAllocation = {
  invoiceId: number;
  paymentId: string;
  amount: number;
  date: string;
  method: string | null;
  matchMethod: string;
};

const CONTACT_ID_RAW_KEYS = ['CONTACTID', 'contactID', 'contactid', 'contact_id', 'CONTACT_ID'] as const;
const NAME_RAW_KEYS = [
  'FULLNAME',
  'Full Name',
  'fullName',
  'fullname',
  'STUDENTNAME',
  'studentName',
  'studentname',
  'STUDENT_NAME',
  'student_name',
] as const;
const EMAIL_RAW_KEYS = ['EMAIL', 'email', 'Email', 'CONTACTEMAIL', 'contactEmail'] as const;

function parseAmount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeName(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value: string): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeInvoiceNumber(value: string): string {
  return normalizeName(value).replace(/^0+/, '');
}

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

function paymentEffectiveDate(p: DbPayment): string | null {
  if (p.transaction_date) return parsePaymentDateTime(String(p.transaction_date));
  if (p.payment_date) return parsePaymentDateTime(String(p.payment_date));
  return null;
}

function paymentDay(p: DbPayment): string {
  const dt = paymentEffectiveDate(p);
  return dt ? dt.slice(0, 10) : '';
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function isPaymentDayInRange(day: string, dateFrom: string, dateTo: string): boolean {
  if (!day) return false;
  if (dateFrom && isIsoDate(dateFrom) && day < dateFrom) return false;
  if (dateTo && isIsoDate(dateTo) && day > dateTo) return false;
  return true;
}

/** Match aXcelerate Transactions report: Money Received only, exclude Bad Debt / Credit Note. */
export function isAxMoneyReceivedPayment(p: DbPayment): boolean {
  const type = String(p.transaction_type ?? '').toLowerCase();
  const amount = Math.abs(parseAmount(p.payment_amount));
  if (amount <= 0) return false;
  if (type.includes('money received')) return true;
  if (!type.trim()) return true;
  return false;
}

function isExcludedPaymentMethod(method: string | null): boolean {
  const m = String(method ?? '').toLowerCase();
  return m.includes('bad debt') || m.includes('credit note');
}

/** Eligible targets for payment-in-range mapping (includes outstanding instalments). */
function isAllocatableInvoice(inv: DbInvoice): boolean {
  if (inv.is_void || inv.is_cancelled) return false;
  const paid = parseAmount(inv.paid_amount);
  if (paid > 0) return true;
  const balance = parseAmount(inv.balance);
  const amount = parseAmount(inv.invoice_amount);
  return amount > 0 && balance > 0;
}

function invoiceSortKey(inv: DbInvoice): string {
  const invoiceDate = inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '9999-99-99';
  const due = inv.due_date ? String(inv.due_date).slice(0, 10) : '9999-99-99';
  return `${invoiceDate}|${due}|${String(inv.invoice_id).padStart(12, '0')}`;
}

function invoiceMonth(inv: DbInvoice): string {
  const d = inv.invoice_date ?? inv.due_date ?? '';
  return String(d).slice(0, 7);
}

function invoiceDay(inv: DbInvoice): string {
  const d = inv.invoice_date ?? inv.due_date ?? '';
  return String(d).slice(0, 10);
}

function pickRawField(raw: Record<string, unknown>, keys: readonly string[]): string {
  const map = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw)) {
    map.set(k, v);
    map.set(k.toLowerCase(), v);
  }
  for (const key of keys) {
    const v = map.get(key) ?? map.get(key.toLowerCase());
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function resolvePaymentStudentName(p: DbPayment): string {
  const fromRow = String(p.student_name ?? p.user_full_name ?? '').trim();
  if (fromRow) return fromRow;
  const raw = p.raw_json;
  if (!raw || typeof raw !== 'object') return '';
  return pickRawField(raw, NAME_RAW_KEYS);
}

function resolvePaymentEmail(p: DbPayment): string {
  const raw = p.raw_json;
  if (!raw || typeof raw !== 'object') return '';
  return pickRawField(raw, EMAIL_RAW_KEYS);
}

function resolvePaymentContactIdRaw(p: DbPayment): number | null {
  if (p.contact_id != null && p.contact_id > 0) return p.contact_id;
  const raw = p.raw_json;
  if (!raw || typeof raw !== 'object') return null;
  const idRaw = pickRawField(raw, CONTACT_ID_RAW_KEYS);
  const id = Number(idRaw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function buildInvoiceByNumberMap(invoices: DbInvoice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.invoice_number) continue;
    map.set(normalizeInvoiceNumber(inv.invoice_number), inv.invoice_id);
    map.set(normalizeName(inv.invoice_number), inv.invoice_id);
  }
  return map;
}

function buildInvoicesByContact(invoices: DbInvoice[]): Map<number, DbInvoice[]> {
  const map = new Map<number, DbInvoice[]>();
  for (const inv of invoices) {
    if (inv.contact_id == null) continue;
    const list = map.get(inv.contact_id) ?? [];
    list.push(inv);
    map.set(inv.contact_id, list);
  }
  return map;
}

function buildInvoicesByNormalizedName(invoices: DbInvoice[]): Map<string, DbInvoice[]> {
  const map = new Map<string, DbInvoice[]>();
  for (const inv of invoices) {
    const name = normalizeName(inv.student_name ?? '');
    if (!name) continue;
    const list = map.get(name) ?? [];
    list.push(inv);
    map.set(name, list);
  }
  return map;
}

function buildInvoicesByEmail(invoices: DbInvoice[]): Map<string, DbInvoice[]> {
  const map = new Map<string, DbInvoice[]>();
  for (const inv of invoices) {
    const email = normalizeEmail(inv.email ?? '');
    if (!email) continue;
    const list = map.get(email) ?? [];
    list.push(inv);
    map.set(email, list);
  }
  return map;
}

function paymentRemaining(p: DbPayment, paymentAllocated: Map<string, number>): number {
  return roundMoney(Math.max(0, Math.abs(parseAmount(p.payment_amount)) - (paymentAllocated.get(p.payment_id) ?? 0)));
}

function invoiceRemainingNeed(inv: DbInvoice, invoiceAllocated: Map<number, number>): number {
  const paid = parseAmount(inv.paid_amount);
  const balance = parseAmount(inv.balance);
  const amount = parseAmount(inv.invoice_amount);
  const target = paid > 0 ? paid : roundMoney(Math.min(balance > 0 ? balance : amount, amount));
  return roundMoney(Math.max(0, target - (invoiceAllocated.get(inv.invoice_id) ?? 0)));
}

function pushAllocation(
  allocations: InternalAllocation[],
  paymentAllocated: Map<string, number>,
  invoiceAllocated: Map<number, number>,
  row: InternalAllocation
): void {
  if (row.amount <= 0) return;
  allocations.push(row);
  paymentAllocated.set(row.paymentId, roundMoney((paymentAllocated.get(row.paymentId) ?? 0) + row.amount));
  invoiceAllocated.set(row.invoiceId, roundMoney((invoiceAllocated.get(row.invoiceId) ?? 0) + row.amount));
}

function tryAllocate(
  allocations: InternalAllocation[],
  paymentAllocated: Map<string, number>,
  invoiceAllocated: Map<number, number>,
  payment: DbPayment,
  invoice: DbInvoice,
  matchMethod: string
): boolean {
  const payRem = paymentRemaining(payment, paymentAllocated);
  const invRem = invoiceRemainingNeed(invoice, invoiceAllocated);
  const alloc = roundMoney(Math.min(payRem, invRem));
  if (alloc <= 0) return false;
  const date = paymentEffectiveDate(payment);
  if (!date) return false;
  pushAllocation(allocations, paymentAllocated, invoiceAllocated, {
    invoiceId: invoice.invoice_id,
    paymentId: payment.payment_id,
    amount: alloc,
    date,
    method: payment.payment_method,
    matchMethod,
  });
  return true;
}

type StudentMatchMethod = 'contact_id' | 'student_name' | 'email' | null;

/** Resolve invoices for a payment. Contact only when invoices carry contact_id; otherwise name/email. */
function resolveStudentInvoices(
  p: DbPayment,
  invoicesByContact: Map<number, DbInvoice[]>,
  invoicesByName: Map<string, DbInvoice[]>,
  invoicesByEmail: Map<string, DbInvoice[]>
): { invoices: DbInvoice[]; matchMethod: StudentMatchMethod } {
  const contactId = resolvePaymentContactIdRaw(p);
  if (contactId != null) {
    const byContact = (invoicesByContact.get(contactId) ?? []).filter(isAllocatableInvoice);
    if (byContact.length > 0) return { invoices: byContact, matchMethod: 'contact_id' };
  }

  const name = normalizeName(resolvePaymentStudentName(p));
  if (name) {
    const byName = (invoicesByName.get(name) ?? []).filter(isAllocatableInvoice);
    if (byName.length > 0) return { invoices: byName, matchMethod: 'student_name' };
  }

  const email = normalizeEmail(resolvePaymentEmail(p));
  if (email) {
    const byEmail = (invoicesByEmail.get(email) ?? []).filter(isAllocatableInvoice);
    if (byEmail.length > 0) return { invoices: byEmail, matchMethod: 'email' };
  }

  return { invoices: [], matchMethod: null };
}

function resolveStudentKey(
  p: DbPayment,
  invoicesByContact: Map<number, DbInvoice[]>,
  invoicesByName: Map<string, DbInvoice[]>,
  invoicesByEmail: Map<string, DbInvoice[]>
): string {
  const { matchMethod } = resolveStudentInvoices(p, invoicesByContact, invoicesByName, invoicesByEmail);
  if (matchMethod === 'contact_id') {
    const contactId = resolvePaymentContactIdRaw(p);
    return `contact:${contactId}`;
  }
  if (matchMethod === 'student_name') {
    return `name:${normalizeName(resolvePaymentStudentName(p))}`;
  }
  if (matchMethod === 'email') {
    return `email:${normalizeEmail(resolvePaymentEmail(p))}`;
  }

  const contactId = resolvePaymentContactIdRaw(p);
  if (contactId != null) return `orphan-contact:${contactId}`;
  const name = normalizeName(resolvePaymentStudentName(p));
  if (name) return `orphan-name:${name}`;
  return `payment:${p.payment_id}`;
}

/**
 * Instalment-aware invoice pick: same month as payment, then latest due on/before payment, then FIFO.
 */
function pickInvoiceForPayment(
  payment: DbPayment,
  candidates: DbInvoice[],
  invoiceAllocated: Map<number, number>
): DbInvoice | null {
  const payDay = paymentDay(payment);
  const payAmount = Math.abs(parseAmount(payment.payment_amount));
  const payMonth = payDay.slice(0, 7);

  const eligible = candidates
    .filter(isAllocatableInvoice)
    .filter((inv) => invoiceRemainingNeed(inv, invoiceAllocated) > 0);
  if (eligible.length === 0) return null;

  const sameMonth = eligible.filter((inv) => invoiceMonth(inv) === payMonth);
  if (sameMonth.length === 1) return sameMonth[0];

  if (sameMonth.length > 1) {
    const amountMatches = sameMonth.filter(
      (inv) =>
        Math.abs(parseAmount(inv.paid_amount) - payAmount) < 0.02 ||
        Math.abs(parseAmount(inv.invoice_amount) - payAmount) < 0.02
    );
    if (amountMatches.length === 1) return amountMatches[0];
    sameMonth.sort((a, b) => invoiceSortKey(a).localeCompare(invoiceSortKey(b)));
    return sameMonth[0];
  }

  const onOrBefore = eligible.filter((inv) => {
    const invDay = invoiceDay(inv);
    return invDay && invDay <= payDay;
  });
  if (onOrBefore.length > 0) {
    onOrBefore.sort((a, b) => invoiceSortKey(b).localeCompare(invoiceSortKey(a)));
    return onOrBefore[0];
  }

  eligible.sort((a, b) => invoiceSortKey(a).localeCompare(invoiceSortKey(b)));
  return eligible[0];
}

export function allocatePaymentsForDateFilter(
  payments: DbPayment[],
  invoices: DbInvoice[],
  dateFrom: string,
  dateTo: string
): PaymentDateFilterResult {
  const invoiceById = new Map(invoices.map((i) => [i.invoice_id, i]));
  const invoiceByNumber = buildInvoiceByNumberMap(invoices);
  const invoicesByContact = buildInvoicesByContact(invoices);
  const invoicesByName = buildInvoicesByNormalizedName(invoices);
  const invoicesByEmail = buildInvoicesByEmail(invoices);

  const paymentsInRange = payments
    .filter((p) => isAxMoneyReceivedPayment(p) && !isExcludedPaymentMethod(p.payment_method))
    .filter((p) => isPaymentDayInRange(paymentDay(p), dateFrom, dateTo))
    .sort((a, b) => {
      const dayCmp = paymentDay(a).localeCompare(paymentDay(b));
      if (dayCmp !== 0) return dayCmp;
      return a.payment_id.localeCompare(b.payment_id);
    });

  const allocations: InternalAllocation[] = [];
  const paymentAllocated = new Map<string, number>();
  const invoiceAllocated = new Map<number, number>();

  let paymentsWithDirectInvoiceId = 0;
  let paymentsWithoutInvoiceId = 0;
  let paymentsResolvedByContactId = 0;
  let paymentsResolvedByStudentName = 0;
  const fifoPaymentIds = new Set<string>();

  const studentKeysInPayments = new Set<string>();
  const studentKeysMapped = new Set<string>();

  for (const p of paymentsInRange) {
    if (p.invoice_id != null && p.invoice_id > 0) paymentsWithDirectInvoiceId += 1;
    else paymentsWithoutInvoiceId += 1;
    studentKeysInPayments.add(resolveStudentKey(p, invoicesByContact, invoicesByName, invoicesByEmail));
  }

  // A. Direct invoice_id
  for (const p of paymentsInRange) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;
    if (p.invoice_id == null || p.invoice_id <= 0) continue;
    const inv = invoiceById.get(p.invoice_id);
    if (!inv || !isAllocatableInvoice(inv)) continue;
    if (tryAllocate(allocations, paymentAllocated, invoiceAllocated, p, inv, 'exact_invoice_id')) {
      studentKeysMapped.add(resolveStudentKey(p, invoicesByContact, invoicesByName, invoicesByEmail));
    }
  }

  // B. Invoice number / reference
  for (const p of paymentsInRange) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;
    const candidates = new Set<number>();

    if (p.invoice_number) {
      const id =
        invoiceByNumber.get(normalizeInvoiceNumber(p.invoice_number)) ??
        invoiceByNumber.get(normalizeName(p.invoice_number));
      if (id) candidates.add(id);
    }
    const ref = String(p.reference ?? '').trim();
    if (ref) {
      const id =
        invoiceByNumber.get(normalizeInvoiceNumber(ref)) ?? invoiceByNumber.get(normalizeName(ref));
      if (id) candidates.add(id);
    }

    for (const invoiceId of candidates) {
      const inv = invoiceById.get(invoiceId);
      if (!inv || !isAllocatableInvoice(inv)) continue;
      if (tryAllocate(allocations, paymentAllocated, invoiceAllocated, p, inv, 'invoice_number_or_reference')) {
        studentKeysMapped.add(resolveStudentKey(p, invoicesByContact, invoicesByName, invoicesByEmail));
        if (paymentRemaining(p, paymentAllocated) <= 0) break;
      }
    }
  }

  // C/D/E + instalment FIFO: contact, name, email, then chronological allocation
  for (const p of paymentsInRange) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;

    const { invoices: candidateInvoices, matchMethod } = resolveStudentInvoices(
      p,
      invoicesByContact,
      invoicesByName,
      invoicesByEmail
    );
    if (candidateInvoices.length === 0) continue;

    if (matchMethod === 'contact_id') paymentsResolvedByContactId += 1;
    else if (matchMethod === 'student_name') paymentsResolvedByStudentName += 1;

    const inv = pickInvoiceForPayment(p, candidateInvoices, invoiceAllocated);
    if (!inv) continue;

    if (tryAllocate(allocations, paymentAllocated, invoiceAllocated, p, inv, 'contact_fifo_allocation')) {
      fifoPaymentIds.add(p.payment_id);
      studentKeysMapped.add(resolveStudentKey(p, invoicesByContact, invoicesByName, invoicesByEmail));
    }

    // One payment may cover multiple instalments — continue FIFO from the matched invoice forward.
    let payRem = paymentRemaining(p, paymentAllocated);
    if (payRem <= 0) continue;

    const sorted = [...candidateInvoices].sort((a, b) => invoiceSortKey(a).localeCompare(invoiceSortKey(b)));
    const startIdx = Math.max(0, sorted.findIndex((i) => i.invoice_id === inv.invoice_id));
    for (let i = startIdx; i < sorted.length; i++) {
      payRem = paymentRemaining(p, paymentAllocated);
      if (payRem <= 0) break;
      const nextInv = sorted[i];
      const invRem = invoiceRemainingNeed(nextInv, invoiceAllocated);
      if (invRem <= 0) continue;
      const date = paymentEffectiveDate(p);
      if (!date) break;
      const alloc = roundMoney(Math.min(payRem, invRem));
      pushAllocation(allocations, paymentAllocated, invoiceAllocated, {
        invoiceId: nextInv.invoice_id,
        paymentId: p.payment_id,
        amount: alloc,
        date,
        method: p.payment_method,
        matchMethod: 'contact_fifo_allocation',
      });
      fifoPaymentIds.add(p.payment_id);
    }
  }

  const invoiceIdsInRange = new Set<number>();
  const invoicePaymentEntriesInRange = new Map<number, InvoicePaymentEntry[]>();

  for (const a of allocations) {
    invoiceIdsInRange.add(a.invoiceId);
    const list = invoicePaymentEntriesInRange.get(a.invoiceId) ?? [];
    list.push({ date: a.date, method: a.method });
    invoicePaymentEntriesInRange.set(a.invoiceId, list);
  }

  for (const [invoiceId, list] of invoicePaymentEntriesInRange.entries()) {
    list.sort((x, y) => x.date.localeCompare(y.date));
    invoicePaymentEntriesInRange.set(invoiceId, list);
  }

  const unmappedPaymentSamples: PaymentDateFilterDebug['unmappedPaymentSamples'] = [];
  for (const p of paymentsInRange) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;
    if (unmappedPaymentSamples.length >= 10) break;
    const cid = resolvePaymentContactIdRaw(p);
    unmappedPaymentSamples.push({
      studentName: resolvePaymentStudentName(p),
      paymentAmount: Math.abs(parseAmount(p.payment_amount)),
      paymentDate: paymentEffectiveDate(p),
      reference: p.reference,
      contactId: cid != null ? String(cid) : null,
      rawJsonKeys: p.raw_json ? Object.keys(p.raw_json).slice(0, 30) : [],
    });
  }

  return {
    invoiceIdsInRange,
    invoicePaymentEntriesInRange,
    debug: {
      paymentTransactionsInRange: paymentsInRange.length,
      paymentsWithDirectInvoiceId,
      paymentsWithoutInvoiceId,
      paymentsResolvedByContactId,
      paymentsResolvedByStudentName,
      paymentsAllocatedByFifo: fifoPaymentIds.size,
      invoiceRowsReturned: invoiceIdsInRange.size,
      distinctStudentsInPayments: studentKeysInPayments.size,
      distinctStudentsMappedToInvoices: studentKeysMapped.size,
      unmappedPaymentSamples,
    },
  };
}
