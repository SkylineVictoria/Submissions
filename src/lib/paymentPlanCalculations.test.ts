import { describe, it, expect } from 'vitest';
import {
  buildAssignmentScheduleFromPlan,
  calculateEqualInstallments,
  calculateUnevenInstallments,
  installmentSumMatchesTotal,
  roundCurrency,
  sumInstallmentAmounts,
  assignDraftToInput,
  previewToAssignDraft,
  validateAssignInstallmentDrafts,
  shiftIsoDateByDays,
} from './paymentPlanCalculations';

describe('calculateEqualInstallments', () => {
  it('divides 1000 across 3 installments with final adjustment', () => {
    const rows = calculateEqualInstallments(1000, 3, '2026-01-15');
    expect(rows).toHaveLength(3);
    expect(rows[0].amount).toBe(333.33);
    expect(rows[1].amount).toBe(333.33);
    expect(rows[2].amount).toBe(333.34);
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(1000);
    expect(installmentSumMatchesTotal(sumInstallmentAmounts(rows.map((r) => r.amount)), 1000)).toBe(true);
  });
});

describe('calculateUnevenInstallments', () => {
  it('uses regular monthly for first n-1 and remainder on final', () => {
    const rows = calculateUnevenInstallments(11500, 12, '2026-03-01', 1000);
    expect(rows).toHaveLength(12);
    for (let i = 0; i < 11; i++) {
      expect(rows[i].amount).toBe(1000);
    }
    expect(rows[11].amount).toBe(500);
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(11500);
  });

  it('throws when final installment would be zero or negative', () => {
    expect(() => calculateUnevenInstallments(1000, 3, '2026-01-01', 600)).toThrow(/greater than zero/i);
  });
});

describe('installmentSumMatchesTotal', () => {
  it('requires exact 2-decimal match', () => {
    expect(installmentSumMatchesTotal(999.99, 1000)).toBe(false);
    expect(installmentSumMatchesTotal(1000, 1000)).toBe(true);
    expect(installmentSumMatchesTotal(roundCurrency(333.33 + 333.33 + 333.34), 1000)).toBe(true);
  });
});

describe('buildAssignmentScheduleFromPlan', () => {
  it('offsets template due dates from assignment start', () => {
    const rows = buildAssignmentScheduleFromPlan(
      {
        total_amount: 1200,
        installment_count: 3,
        start_date: '2026-01-01',
        calculation_mode: 'equal',
        regular_monthly_amount: null,
      },
      '2026-02-15',
      [
        { installment_number: 1, due_date: '2026-01-01', amount: 400 },
        { installment_number: 2, due_date: '2026-02-01', amount: 400 },
        { installment_number: 3, due_date: '2026-03-01', amount: 400 },
      ]
    );
    const offset = 45;
    expect(rows[0].due_date).toBe('2026-02-15');
    expect(rows[1].due_date).toBe(shiftIsoDateByDays('2026-02-01', offset));
    expect(rows[2].due_date).toBe(shiftIsoDateByDays('2026-03-01', offset));
  });

  it('generates equal installments when template is empty', () => {
    const rows = buildAssignmentScheduleFromPlan(
      {
        total_amount: 900,
        installment_count: 3,
        start_date: '2026-01-01',
        calculation_mode: 'equal',
        regular_monthly_amount: null,
      },
      '2026-06-01',
      []
    );
    expect(rows).toHaveLength(3);
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(900);
  });
});

describe('assignDraftToInput', () => {
  it('marks first installment paid when recording full payment', () => {
    const draft = previewToAssignDraft(
      { installment_number: 1, due_date: '2026-06-01', amount: 500 },
      true
    );
    const input = assignDraftToInput({
      ...draft,
      record_payment: true,
      paid_amount: '500',
      payment_date: '01-06-2026',
    });
    expect(input.status).toBe('paid');
    expect(input.paid_amount).toBe(500);
    expect(input.payment_date).toBe('2026-06-01');
  });

  it('waives installment with zero amount', () => {
    const draft = previewToAssignDraft(
      { installment_number: 2, due_date: '2026-07-01', amount: 300 },
      false
    );
    const input = assignDraftToInput({ ...draft, waived: true, notes: 'Scholarship' });
    expect(input.status).toBe('waived');
    expect(input.amount).toBe(0);
    expect(input.notes).toBe('Scholarship');
  });
});

describe('validateAssignInstallmentDrafts', () => {
  it('rejects paid amount above installment amount', () => {
    const draft = previewToAssignDraft(
      { installment_number: 1, due_date: '2026-06-01', amount: 200 },
      true
    );
    const err = validateAssignInstallmentDrafts([
      { ...draft, record_payment: true, paid_amount: '250', payment_date: '01-06-2026' },
    ]);
    expect(err).toMatch(/cannot exceed/i);
  });
});
