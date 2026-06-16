import { describe, it, expect } from 'vitest';
import {
  calculateEqualInstallments,
  calculateUnevenInstallments,
  installmentSumMatchesTotal,
  roundCurrency,
  sumInstallmentAmounts,
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
