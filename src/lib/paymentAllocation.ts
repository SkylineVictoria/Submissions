/**
 * FIFO / oldest-outstanding-first payment allocation helpers (client preview).
 * Server RPC skyline_preview_fifo_payment_allocation is the source of truth at post time.
 */

import { roundCurrency } from './paymentPlanCalculations';

export type FifoInstallmentInput = {
  id: number;
  installment_number: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  waived_amount?: number;
  status: string;
};

export type FifoAllocationLine = {
  installment_id: number;
  installment_number: number;
  due_date: string;
  scheduled_amount: number;
  already_paid: number;
  outstanding_before: number;
  allocated_amount: number;
  outstanding_after: number;
};

export type FifoAllocationPreview =
  | { ok: true; lines: FifoAllocationLine[]; allocated_total: number; max_allowed: number }
  | { ok: false; error: string; max_allowed: number; lines: FifoAllocationLine[] };

export function installmentOutstanding(input: {
  amount: number;
  paid_amount: number;
  waived_amount?: number;
  status?: string;
}): number {
  if (input.status === 'waived') return 0;
  return roundCurrency(
    Math.max(
      0,
      roundCurrency(input.amount) -
        roundCurrency(input.paid_amount) -
        roundCurrency(input.waived_amount ?? 0)
    )
  );
}

/** Total remaining cash collectible across the assignment. */
export function totalOutstandingBalance(installments: FifoInstallmentInput[]): number {
  return roundCurrency(
    installments.reduce((sum, i) => sum + installmentOutstanding(i), 0)
  );
}

/**
 * Due-now display: previous older outstanding + current instalment outstanding.
 * Does NOT mutate scheduled amounts.
 */
export function computeDueNow(args: {
  installments: FifoInstallmentInput[];
  currentInstallmentId: number;
}): {
  previous_outstanding: number;
  current_installment_outstanding: number;
  total_due_now: number;
} {
  const ordered = [...args.installments].sort(
    (a, b) =>
      a.installment_number - b.installment_number ||
      a.due_date.localeCompare(b.due_date) ||
      a.id - b.id
  );
  const idx = ordered.findIndex((i) => i.id === args.currentInstallmentId);
  if (idx < 0) {
    return { previous_outstanding: 0, current_installment_outstanding: 0, total_due_now: 0 };
  }
  const current = ordered[idx];
  const currentOut = installmentOutstanding(current);
  const previous = ordered
    .slice(0, idx)
    .reduce((sum, i) => sum + installmentOutstanding(i), 0);
  return {
    previous_outstanding: roundCurrency(previous),
    current_installment_outstanding: currentOut,
    total_due_now: roundCurrency(previous + currentOut),
  };
}

/** Allocate payment FIFO across oldest outstanding instalments. */
export function previewFifoPaymentAllocation(
  installments: FifoInstallmentInput[],
  paymentAmount: number
): FifoAllocationPreview {
  const amount = roundCurrency(paymentAmount);
  const maxAllowed = totalOutstandingBalance(installments);
  if (!(amount > 0)) {
    return { ok: false, error: 'Payment amount must be greater than zero.', max_allowed: maxAllowed, lines: [] };
  }

  let remaining = amount;
  const lines: FifoAllocationLine[] = [];
  const ordered = [...installments].sort(
    (a, b) =>
      a.installment_number - b.installment_number ||
      a.due_date.localeCompare(b.due_date) ||
      a.id - b.id
  );

  for (const inst of ordered) {
    if (remaining <= 0) break;
    if (inst.status === 'waived') continue;
    const outstandingBefore = installmentOutstanding(inst);
    if (outstandingBefore <= 0) continue;
    const allocated = roundCurrency(Math.min(remaining, outstandingBefore));
    lines.push({
      installment_id: inst.id,
      installment_number: inst.installment_number,
      due_date: inst.due_date,
      scheduled_amount: roundCurrency(inst.amount),
      already_paid: roundCurrency(inst.paid_amount),
      outstanding_before: outstandingBefore,
      allocated_amount: allocated,
      outstanding_after: roundCurrency(outstandingBefore - allocated),
    });
    remaining = roundCurrency(remaining - allocated);
  }

  const allocatedTotal = roundCurrency(lines.reduce((s, l) => s + l.allocated_amount, 0));
  if (remaining > 0) {
    return {
      ok: false,
      error: `Payment exceeds the student's outstanding balance. Maximum payment allowed is $${maxAllowed.toFixed(2)}.`,
      max_allowed: maxAllowed,
      lines,
    };
  }

  return { ok: true, lines, allocated_total: allocatedTotal, max_allowed: maxAllowed };
}

/** Cash received = sum of active posted cash transactions (not instalment aggregates). */
export function sumCashReceivedFromTransactions(
  transactions: Array<{ amount: number; status: string; is_active?: boolean; posting_status?: string }>
): number {
  return roundCurrency(
    transactions
      .filter(
        (t) =>
          (t.is_active ?? true) &&
          (t.posting_status ?? 'posted') === 'posted' &&
          (t.status === 'paid' || t.status === 'partial') &&
          t.amount > 0
      )
      .reduce((s, t) => s + Number(t.amount || 0), 0)
  );
}
