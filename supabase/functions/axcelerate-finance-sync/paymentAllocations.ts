// Payment-to-invoice allocation backfill for Finance Reports payment dates.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type AllocationBackfillStats = {
  allocationsCreated: number;
  highConfidenceAllocations: number;
  mediumConfidenceAllocations: number;
  lowConfidenceAllocations: number;
  unmatchedPayments: number;
  unallocatedPaidInvoices: number;
  paidInvoicesTotal: number;
  paidInvoicesWithPaymentDate: number;
  paidInvoicesMissingPaymentDate: number;
  invoicesUpdated: number;
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
  reference: string | null;
  raw_json: Record<string, unknown> | null;
};

type AllocationInsert = {
  invoice_id: number;
  payment_id: string;
  transaction_id: string | null;
  contact_id: number | null;
  allocated_amount: number;
  allocation_date: string | null;
  payment_method: string | null;
  match_method: string;
  match_confidence: string;
  raw_reason: string | null;
};

const AMOUNT_TOLERANCE = 0.02;
const UPSERT_BATCH = 400;

function parseAmount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeKey(value: string): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeInvoiceNumber(value: string): string {
  return normalizeKey(value).replace(/^0+/, '');
}

function paymentEffectiveDate(p: DbPayment): string | null {
  const raw = p.transaction_date ?? p.payment_date;
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v) return null;
  const parsed = Date.parse(v);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return v;
}

function isMoneyReceivedPayment(p: DbPayment): boolean {
  const amount = Math.abs(parseAmount(p.payment_amount));
  const type = String(p.transaction_type ?? '').toLowerCase();
  if (!type) return amount > 0;
  return type.includes('money received') || type.includes('payment') || type.includes('receipt');
}

function isExcludedPaymentMethod(method: string | null): boolean {
  const m = String(method ?? '').toLowerCase();
  return m.includes('bad debt') || m.includes('credit note');
}

function isAllocatableInvoice(inv: DbInvoice): boolean {
  if (inv.is_void || inv.is_cancelled) return false;
  return parseAmount(inv.paid_amount) > 0;
}

function isPaidOrPartialInvoice(inv: DbInvoice): boolean {
  if (inv.is_void || inv.is_cancelled) return false;
  const paid = parseAmount(inv.paid_amount);
  const balance = parseAmount(inv.balance);
  const invoiceAmount = parseAmount(inv.invoice_amount);
  return paid > 0 || balance < invoiceAmount;
}

function invoiceSortKey(inv: DbInvoice): string {
  const due = inv.due_date ? String(inv.due_date).slice(0, 10) : '9999-99-99';
  const invoiceDate = inv.invoice_date ? String(inv.invoice_date).slice(0, 10) : '9999-99-99';
  return `${due}|${invoiceDate}|${String(inv.invoice_id).padStart(12, '0')}`;
}

function paymentSortKey(p: DbPayment): string {
  const dt = paymentEffectiveDate(p) ?? '9999-99-99T99:99:99Z';
  return `${dt}|${p.payment_id}`;
}

function buildInvoiceByNumberMap(invoices: DbInvoice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.invoice_number) continue;
    map.set(normalizeInvoiceNumber(inv.invoice_number), inv.invoice_id);
    map.set(normalizeKey(inv.invoice_number), inv.invoice_id);
  }
  return map;
}

function buildInvoiceById(invoices: DbInvoice[]): Map<number, DbInvoice> {
  return new Map(invoices.map((inv) => [inv.invoice_id, inv]));
}

function pushAllocation(
  allocations: AllocationInsert[],
  paymentAllocated: Map<string, number>,
  invoiceAllocated: Map<number, number>,
  row: AllocationInsert
): void {
  if (row.allocated_amount <= 0) return;
  allocations.push(row);
  paymentAllocated.set(row.payment_id, roundMoney((paymentAllocated.get(row.payment_id) ?? 0) + row.allocated_amount));
  invoiceAllocated.set(row.invoice_id, roundMoney((invoiceAllocated.get(row.invoice_id) ?? 0) + row.allocated_amount));
}

function paymentRemaining(p: DbPayment, paymentAllocated: Map<string, number>): number {
  return roundMoney(Math.max(0, Math.abs(parseAmount(p.payment_amount)) - (paymentAllocated.get(p.payment_id) ?? 0)));
}

function invoiceRemainingNeed(inv: DbInvoice, invoiceAllocated: Map<number, number>): number {
  const target = parseAmount(inv.paid_amount);
  const allocated = invoiceAllocated.get(inv.invoice_id) ?? 0;
  return roundMoney(Math.max(0, target - allocated));
}

function allocateAmount(
  allocations: AllocationInsert[],
  paymentAllocated: Map<string, number>,
  invoiceAllocated: Map<number, number>,
  payment: DbPayment,
  invoice: DbInvoice,
  amount: number,
  matchMethod: string,
  matchConfidence: string,
  rawReason: string
): void {
  const payRem = paymentRemaining(payment, paymentAllocated);
  const invRem = invoiceRemainingNeed(invoice, invoiceAllocated);
  const alloc = roundMoney(Math.min(amount, payRem, invRem));
  if (alloc <= 0) return;

  pushAllocation(allocations, paymentAllocated, invoiceAllocated, {
    invoice_id: invoice.invoice_id,
    payment_id: payment.payment_id,
    transaction_id: payment.transaction_id,
    contact_id: payment.contact_id ?? invoice.contact_id,
    allocated_amount: alloc,
    allocation_date: paymentEffectiveDate(payment),
    payment_method: payment.payment_method,
    match_method: matchMethod,
    match_confidence: matchConfidence,
    raw_reason: rawReason,
  });
}

export async function backfillInvoicePaymentAllocations(
  supabase: SupabaseClient
): Promise<{ success: boolean; stats: AllocationBackfillStats; errors: string[] }> {
  const errors: string[] = [];

  const [{ data: invoiceData, error: invoiceError }, { data: paymentData, error: paymentError }] =
    await Promise.all([
      supabase
        .from('ax_invoices')
        .select(
          'invoice_id, invoice_number, contact_id, student_name, email, invoice_date, due_date, invoice_amount, paid_amount, balance, is_void, is_cancelled'
        ),
      supabase
        .from('ax_invoice_payments')
        .select(
          'payment_id, transaction_id, invoice_id, invoice_number, contact_id, student_name, payment_date, transaction_date, payment_method, transaction_type, payment_amount, reference, raw_json'
        ),
    ]);

  if (invoiceError) {
    return {
      success: false,
      stats: emptyStats(),
      errors: [`Failed to load invoices: ${invoiceError.message}`],
    };
  }
  if (paymentError) {
    return {
      success: false,
      stats: emptyStats(),
      errors: [`Failed to load payments: ${paymentError.message}`],
    };
  }

  const invoices = (invoiceData ?? []) as DbInvoice[];
  const payments = ((paymentData ?? []) as DbPayment[]).filter(
    (p) => isMoneyReceivedPayment(p) && !isExcludedPaymentMethod(p.payment_method)
  );

  const invoiceById = buildInvoiceById(invoices);
  const invoiceByNumber = buildInvoiceByNumberMap(invoices);
  const allocations: AllocationInsert[] = [];
  const paymentAllocated = new Map<string, number>();
  const invoiceAllocated = new Map<number, number>();
  const paymentMatched = new Set<string>();

  // A. Exact invoice_id match
  for (const p of payments) {
    if (p.invoice_id == null || p.invoice_id <= 0) continue;
    const inv = invoiceById.get(p.invoice_id);
    if (!inv || !isAllocatableInvoice(inv)) continue;
    allocateAmount(
      allocations,
      paymentAllocated,
      invoiceAllocated,
      p,
      inv,
      paymentRemaining(p, paymentAllocated),
      'exact_invoice_id',
      'high',
      `payment.invoice_id=${p.invoice_id}`
    );
    if (paymentRemaining(p, paymentAllocated) <= 0) paymentMatched.add(p.payment_id);
  }

  // B. Invoice number / reference match
  for (const p of payments) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;
    const candidates = new Set<number>();

    if (p.invoice_number) {
      const id =
        invoiceByNumber.get(normalizeInvoiceNumber(p.invoice_number)) ??
        invoiceByNumber.get(normalizeKey(p.invoice_number));
      if (id) candidates.add(id);
    }
    const ref = String(p.reference ?? '').trim();
    if (ref) {
      const id =
        invoiceByNumber.get(normalizeInvoiceNumber(ref)) ?? invoiceByNumber.get(normalizeKey(ref));
      if (id) candidates.add(id);
    }

    for (const invoiceId of candidates) {
      const inv = invoiceById.get(invoiceId);
      if (!inv || !isAllocatableInvoice(inv)) continue;
      allocateAmount(
        allocations,
        paymentAllocated,
        invoiceAllocated,
        p,
        inv,
        paymentRemaining(p, paymentAllocated),
        'invoice_number_or_reference',
        'high',
        `invoice_number=${p.invoice_number ?? ''};reference=${ref}`
      );
      if (paymentRemaining(p, paymentAllocated) <= 0) {
        paymentMatched.add(p.payment_id);
        break;
      }
    }
  }

  // C. Contact + exact amount + single candidate
  for (const p of payments) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;
    if (p.contact_id == null) continue;

    const amount = Math.abs(parseAmount(p.payment_amount));
    const candidates = invoices.filter((inv) => {
      if (!isPaidOrPartialInvoice(inv)) return false;
      if (inv.contact_id !== p.contact_id) return false;
      const paid = parseAmount(inv.paid_amount);
      const invoiceAmount = parseAmount(inv.invoice_amount);
      return (
        Math.abs(paid - amount) < AMOUNT_TOLERANCE || Math.abs(invoiceAmount - amount) < AMOUNT_TOLERANCE
      );
    });

    if (candidates.length !== 1) continue;
    const inv = candidates[0];
    allocateAmount(
      allocations,
      paymentAllocated,
      invoiceAllocated,
      p,
      inv,
      paymentRemaining(p, paymentAllocated),
      'contact_exact_amount_single',
      'high',
      `contact_id=${p.contact_id};amount=${amount}`
    );
    if (paymentRemaining(p, paymentAllocated) <= 0) paymentMatched.add(p.payment_id);
  }

  // D. Contact FIFO allocation
  const paymentsByContact = new Map<number, DbPayment[]>();
  for (const p of payments) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;
    if (p.contact_id == null) continue;
    const list = paymentsByContact.get(p.contact_id) ?? [];
    list.push(p);
    paymentsByContact.set(p.contact_id, list);
  }

  const invoicesByContact = new Map<number, DbInvoice[]>();
  for (const inv of invoices) {
    if (!isAllocatableInvoice(inv)) continue;
    if (invoiceRemainingNeed(inv, invoiceAllocated) <= 0) continue;
    if (inv.contact_id == null) continue;
    const list = invoicesByContact.get(inv.contact_id) ?? [];
    list.push(inv);
    invoicesByContact.set(inv.contact_id, list);
  }

  for (const [contactId, contactPayments] of paymentsByContact.entries()) {
    const contactInvoices = (invoicesByContact.get(contactId) ?? []).sort((a, b) =>
      invoiceSortKey(a).localeCompare(invoiceSortKey(b))
    );
    if (contactInvoices.length === 0) continue;

    const sortedPayments = [...contactPayments].sort((a, b) => paymentSortKey(a).localeCompare(paymentSortKey(b)));

    for (const p of sortedPayments) {
      let payRem = paymentRemaining(p, paymentAllocated);
      if (payRem <= 0) continue;

      for (const inv of contactInvoices) {
        const invRem = invoiceRemainingNeed(inv, invoiceAllocated);
        if (invRem <= 0) continue;
        const alloc = roundMoney(Math.min(payRem, invRem));
        if (alloc <= 0) continue;

        pushAllocation(allocations, paymentAllocated, invoiceAllocated, {
          invoice_id: inv.invoice_id,
          payment_id: p.payment_id,
          transaction_id: p.transaction_id,
          contact_id: contactId,
          allocated_amount: alloc,
          allocation_date: paymentEffectiveDate(p),
          payment_method: p.payment_method,
          match_method: 'contact_fifo_allocation',
          match_confidence: 'medium',
          raw_reason: `FIFO contact_id=${contactId}`,
        });

        payRem = paymentRemaining(p, paymentAllocated);
        if (payRem <= 0) break;
      }

      if (paymentRemaining(p, paymentAllocated) <= 0) paymentMatched.add(p.payment_id);
    }
  }

  // E. Name/email fallback when contact_id missing
  for (const p of payments) {
    if (paymentRemaining(p, paymentAllocated) <= 0) continue;
    if (p.contact_id != null) continue;

    const payName = normalizeKey(p.student_name ?? '');
    const candidates: DbInvoice[] = [];

    if (payName) {
      for (const inv of invoices) {
        if (!isAllocatableInvoice(inv)) continue;
        if (normalizeKey(inv.student_name ?? '') === payName) candidates.push(inv);
      }
    }

    if (candidates.length !== 1) continue;
    const inv = candidates[0];
    allocateAmount(
      allocations,
      paymentAllocated,
      invoiceAllocated,
      p,
      inv,
      paymentRemaining(p, paymentAllocated),
      'name_fallback_unique',
      'low',
      `student_name=${p.student_name ?? ''}`
    );
    if (paymentRemaining(p, paymentAllocated) <= 0) paymentMatched.add(p.payment_id);
  }

  const { error: deleteError } = await supabase
    .from('ax_invoice_payment_allocations')
    .delete()
    .neq('id', 0);

  if (deleteError) {
    errors.push(`Failed to clear allocations: ${deleteError.message}`);
  } else {
    for (let i = 0; i < allocations.length; i += UPSERT_BATCH) {
      const batch = allocations.slice(i, i + UPSERT_BATCH);
      const { error: upsertError } = await supabase.from('ax_invoice_payment_allocations').upsert(batch, {
        onConflict: 'invoice_id,payment_id',
      });
      if (upsertError) {
        errors.push(`Allocation upsert batch ${i}: ${upsertError.message}`);
        break;
      }
    }
  }

  const invoiceSummary = new Map<
    number,
    { first: string; last: string; count: number; method: string | null }
  >();

  for (const a of allocations) {
    if (!a.allocation_date) continue;
    const existing = invoiceSummary.get(a.invoice_id);
    if (!existing) {
      invoiceSummary.set(a.invoice_id, {
        first: a.allocation_date,
        last: a.allocation_date,
        count: 1,
        method: a.payment_method,
      });
      continue;
    }
    existing.count += 1;
    if (a.allocation_date < existing.first) existing.first = a.allocation_date;
    if (a.allocation_date > existing.last) {
      existing.last = a.allocation_date;
      existing.method = a.payment_method;
    }
  }

  let invoicesUpdated = 0;
  for (const [invoiceId, summary] of invoiceSummary.entries()) {
    const { error: updateError } = await supabase
      .from('ax_invoices')
      .update({
        first_payment_date: summary.first,
        last_payment_date: summary.last,
        payment_count: summary.count,
        payment_method: summary.method,
      })
      .eq('invoice_id', invoiceId);
    if (!updateError) invoicesUpdated += 1;
    else errors.push(`Invoice ${invoiceId} update: ${updateError.message}`);
  }

  const paidInvoices = invoices.filter((inv) => isAllocatableInvoice(inv));

  const invoicesWithAllocation = new Set(allocations.map((a) => a.invoice_id));
  const directPaymentInvoiceIds = new Set<number>();
  for (const p of payments) {
    if (p.invoice_id && invoiceById.has(p.invoice_id) && paymentEffectiveDate(p)) {
      directPaymentInvoiceIds.add(p.invoice_id);
    }
  }

  let paidInvoicesWithPaymentDate = 0;
  let paidInvoicesMissingPaymentDate = 0;
  for (const inv of paidInvoices) {
    const hasDate =
      invoicesWithAllocation.has(inv.invoice_id) || directPaymentInvoiceIds.has(inv.invoice_id);
    if (hasDate) paidInvoicesWithPaymentDate += 1;
    else paidInvoicesMissingPaymentDate += 1;
  }

  let highConfidenceAllocations = 0;
  let mediumConfidenceAllocations = 0;
  let lowConfidenceAllocations = 0;
  for (const a of allocations) {
    if (a.match_confidence === 'high') highConfidenceAllocations += 1;
    else if (a.match_confidence === 'medium') mediumConfidenceAllocations += 1;
    else lowConfidenceAllocations += 1;
  }

  const unmatchedPayments = payments.filter((p) => paymentRemaining(p, paymentAllocated) > 0).length;
  const unallocatedPaidInvoices = paidInvoices.filter(
    (inv) => invoiceRemainingNeed(inv, invoiceAllocated) > 0
  ).length;

  return {
    success: errors.length === 0,
    stats: {
      allocationsCreated: allocations.length,
      highConfidenceAllocations,
      mediumConfidenceAllocations,
      lowConfidenceAllocations,
      unmatchedPayments,
      unallocatedPaidInvoices,
      paidInvoicesTotal: paidInvoices.length,
      paidInvoicesWithPaymentDate,
      paidInvoicesMissingPaymentDate,
      invoicesUpdated,
    },
    errors,
  };
}

function emptyStats(): AllocationBackfillStats {
  return {
    allocationsCreated: 0,
    highConfidenceAllocations: 0,
    mediumConfidenceAllocations: 0,
    lowConfidenceAllocations: 0,
    unmatchedPayments: 0,
    unallocatedPaidInvoices: 0,
    paidInvoicesTotal: 0,
    paidInvoicesWithPaymentDate: 0,
    paidInvoicesMissingPaymentDate: 0,
    invoicesUpdated: 0,
  };
}
