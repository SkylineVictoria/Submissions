import { describe, expect, it } from 'vitest';
import {
  computeDueNow,
  previewFifoPaymentAllocation,
  sumCashReceivedFromTransactions,
  totalOutstandingBalance,
} from './paymentAllocation';

const base = [
  {
    id: 1,
    installment_number: 1,
    due_date: '2026-07-30',
    amount: 1000,
    paid_amount: 500,
    waived_amount: 0,
    status: 'partial',
  },
  {
    id: 2,
    installment_number: 2,
    due_date: '2026-08-30',
    amount: 1000,
    paid_amount: 0,
    waived_amount: 0,
    status: 'pending',
  },
  {
    id: 3,
    installment_number: 3,
    due_date: '2026-09-30',
    amount: 1000,
    paid_amount: 0,
    waived_amount: 0,
    status: 'pending',
  },
];

describe('paymentAllocation FIFO', () => {
  it('TEST 1: $500 on #1 → partial 500/500', () => {
    const rows = [
      { ...base[0], paid_amount: 0, status: 'pending' },
      base[1],
      base[2],
    ];
    const preview = previewFifoPaymentAllocation(rows, 500);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].installment_number).toBe(1);
    expect(preview.lines[0].allocated_amount).toBe(500);
    expect(preview.lines[0].outstanding_after).toBe(500);
  });

  it('TEST 2: then $1000 → $500 to #1 and $500 to #2', () => {
    const preview = previewFifoPaymentAllocation(base, 1000);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.lines.map((l) => [l.installment_number, l.allocated_amount])).toEqual([
      [1, 500],
      [2, 500],
    ]);
  });

  it('TEST 3: then $500 settles #2 only when #1 already paid', () => {
    const after = [
      { ...base[0], paid_amount: 1000, status: 'paid' },
      { ...base[1], paid_amount: 500, status: 'partial' },
      base[2],
    ];
    const preview = previewFifoPaymentAllocation(after, 500);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0].installment_number).toBe(2);
    expect(preview.lines[0].allocated_amount).toBe(500);
    expect(preview.lines[0].outstanding_after).toBe(0);
  });

  it('TEST 4: $1500 clears #1 and #2', () => {
    const preview = previewFifoPaymentAllocation(base, 1500);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.lines.map((l) => [l.installment_number, l.allocated_amount])).toEqual([
      [1, 500],
      [2, 1000],
    ]);
  });

  it('TEST 5: overpayment rejected', () => {
    const preview = previewFifoPaymentAllocation(base, 3000);
    expect(preview.ok).toBe(false);
    if (preview.ok) return;
    expect(preview.max_allowed).toBe(2500);
    expect(preview.error).toMatch(/Maximum payment allowed is \$2500\.00/);
  });

  it('TEST 6: cash received from transactions not instalments', () => {
    const cash = sumCashReceivedFromTransactions([
      { amount: 500, status: 'partial', is_active: true, posting_status: 'posted' },
      { amount: 1000, status: 'paid', is_active: true, posting_status: 'posted' },
      { amount: 0, status: 'waived', is_active: true, posting_status: 'posted' },
      { amount: 700, status: 'partial', is_active: false, posting_status: 'corrected' },
    ]);
    expect(cash).toBe(1500);
  });

  it('TEST 7: waiver does not increase cash received', () => {
    expect(
      sumCashReceivedFromTransactions([{ amount: 0, status: 'waived', posting_status: 'posted' }])
    ).toBe(0);
  });

  it('due now shows previous + current without mutating schedule', () => {
    const due = computeDueNow({ installments: base, currentInstallmentId: 2 });
    expect(due.previous_outstanding).toBe(500);
    expect(due.current_installment_outstanding).toBe(1000);
    expect(due.total_due_now).toBe(1500);
    expect(base[1].amount).toBe(1000);
  });

  it('total outstanding balance', () => {
    expect(totalOutstandingBalance(base)).toBe(2500);
  });

  it('payment $700 → 500 to #1 and 200 to #2', () => {
    const preview = previewFifoPaymentAllocation(base, 700);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.lines.map((l) => [l.installment_number, l.allocated_amount])).toEqual([
      [1, 500],
      [2, 200],
    ]);
  });
});
