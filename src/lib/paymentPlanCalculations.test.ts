import { describe, it, expect } from 'vitest';
import {
  addMonthsIso,
  addPeriodIso,
  applyAmountReorderKeepingSlots,
  buildAssignmentScheduleFromPlan,
  calculateEqualInstallments,
  calculateUnevenInstallments,
  installmentSumMatchesTotal,
  outstandingAmount,
  roundCurrency,
  sumInstallmentAmounts,
  assignDraftToInput,
  previewToAssignDraft,
  validateAssignInstallmentDrafts,
  validatePaymentStatusChange,
  assignmentScheduleHasManualEdits,
} from './paymentPlanCalculations';

describe('calculateEqualInstallments', () => {
  it('divides 1000 across 3 installments with final adjustment', () => {
    const rows = calculateEqualInstallments(1000, 3, '2026-01-15');
    expect(rows).toHaveLength(3);
    expect(rows[0].amount).toBe(333.33);
    expect(rows[1].amount).toBe(333.33);
    expect(rows[2].amount).toBe(333.34);
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(1000);
    expect(installmentSumMatchesTotal(sumInstallmentAmounts(rows.map((r) => r.amount)), 1000)).toBe(
      true
    );
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
    expect(() => calculateUnevenInstallments(1000, 3, '2026-01-01', 600)).toThrow(
      /greater than zero/i
    );
  });
});

describe('installmentSumMatchesTotal', () => {
  it('requires exact 2-decimal match', () => {
    expect(installmentSumMatchesTotal(999.99, 1000)).toBe(false);
    expect(installmentSumMatchesTotal(1000, 1000)).toBe(true);
    expect(
      installmentSumMatchesTotal(roundCurrency(333.33 + 333.33 + 333.34), 1000)
    ).toBe(true);
  });
});

describe('TEST 8 — monthly calendar schedule (no 30-day drift)', () => {
  it('uses calendar months from 01/08/2026', () => {
    const rows = calculateEqualInstallments(8000, 8, '2026-08-01', 'monthly');
    expect(rows.map((r) => r.due_date)).toEqual([
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
      '2027-03-01',
    ]);
  });

  it('clamps month-end safely', () => {
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addPeriodIso('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
  });

  it('weekly and fortnightly add fixed days', () => {
    expect(addPeriodIso('2026-08-01', 'weekly', 1)).toBe('2026-08-08');
    expect(addPeriodIso('2026-08-01', 'fortnightly', 1)).toBe('2026-08-15');
  });
});

describe('buildAssignmentScheduleFromPlan', () => {
  it('regenerates calendar dates from assignment start (no day-offset drift)', () => {
    const rows = buildAssignmentScheduleFromPlan(
      {
        total_amount: 1200,
        installment_count: 3,
        start_date: '2026-01-01',
        calculation_mode: 'equal',
        regular_monthly_amount: null,
        payment_period: 'monthly',
      },
      '2026-08-01',
      [
        { installment_number: 1, due_date: '2026-01-01', amount: 400 },
        { installment_number: 2, due_date: '2026-02-01', amount: 400 },
        { installment_number: 3, due_date: '2026-03-01', amount: 400 },
      ],
      'monthly'
    );
    expect(rows.map((r) => r.due_date)).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
    expect(rows.map((r) => r.amount)).toEqual([400, 400, 400]);
  });

  it('TEST 9 — fee override regenerates amounts for assigned fee', () => {
    const rows = buildAssignmentScheduleFromPlan(
      {
        total_amount: 10000,
        installment_count: 4,
        start_date: '2026-01-01',
        calculation_mode: 'equal',
        regular_monthly_amount: null,
      },
      '2026-08-01',
      [
        { installment_number: 1, due_date: '2026-01-01', amount: 2500 },
        { installment_number: 2, due_date: '2026-02-01', amount: 2500 },
        { installment_number: 3, due_date: '2026-03-01', amount: 2500 },
        { installment_number: 4, due_date: '2026-04-01', amount: 2500 },
      ],
      'monthly',
      8000
    );
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(8000);
  });
});

describe('TEST 1 — plan assignment never auto-marks Paid', () => {
  it('preview draft starts pending with blank payment fields', () => {
    const draft = previewToAssignDraft({
      installment_number: 1,
      due_date: '2026-08-01',
      amount: 1000,
    });
    expect(draft.record_payment).toBe(false);
    expect(draft.paid_amount).toBe('');
    expect(draft.payment_date).toBe('');
    const input = assignDraftToInput(draft);
    expect(input.status).toBe('pending');
    expect(input.paid_amount).toBe(0);
    expect(input.payment_date).toBeNull();
  });
});

describe('payment status validation', () => {
  it('TEST 2 — full payment may be Paid', () => {
    expect(
      validatePaymentStatusChange({
        amountDue: 500,
        paidAmount: 500,
        status: 'paid',
        paymentDate: '2026-08-01',
      })
    ).toBeNull();
  });

  it('TEST 3 — invalid Paid when underpaid', () => {
    expect(
      validatePaymentStatusChange({
        amountDue: 1000,
        paidAmount: 500,
        status: 'paid',
        paymentDate: '2026-08-01',
      })
    ).toMatch(/does not match/i);
  });

  it('TEST 4 — partial outstanding', () => {
    expect(
      validatePaymentStatusChange({
        amountDue: 1000,
        paidAmount: 500,
        status: 'partial',
        paymentDate: '2026-08-01',
      })
    ).toBeNull();
    expect(outstandingAmount(1000, 500, 'partial')).toBe(500);
  });

  it('TEST 5 — overpayment rejected', () => {
    expect(
      validatePaymentStatusChange({
        amountDue: 500,
        paidAmount: 600,
        status: 'partial',
        paymentDate: '2026-08-01',
      })
    ).toMatch(/cannot exceed/i);
  });

  it('TEST 6 — waiver with reason', () => {
    expect(
      validatePaymentStatusChange({
        amountDue: 1000,
        paidAmount: 0,
        status: 'waived',
        paymentDate: null,
        waiverReason: 'Scholarship',
        waivedAmount: 1000,
      })
    ).toBeNull();
    expect(outstandingAmount(1000, 0, 'waived')).toBe(0);
  });

  it('TEST 7 — waiver without reason rejected', () => {
    expect(
      validatePaymentStatusChange({
        amountDue: 1000,
        paidAmount: 0,
        status: 'waived',
        paymentDate: null,
        waiverReason: '',
      })
    ).toMatch(/mandatory reason/i);
  });

  it('TEST 14 — Paid requires payment date', () => {
    expect(
      validatePaymentStatusChange({
        amountDue: 500,
        paidAmount: 500,
        status: 'paid',
        paymentDate: null,
      })
    ).toMatch(/payment date/i);
  });

  it('TEST 15 — partial then completion amounts', () => {
    expect(outstandingAmount(1000, 500, 'partial')).toBe(500);
    expect(
      validatePaymentStatusChange({
        amountDue: 1000,
        paidAmount: 1000,
        status: 'paid',
        paymentDate: '2026-09-01',
      })
    ).toBeNull();
    expect(outstandingAmount(1000, 1000, 'paid')).toBe(0);
  });
});

describe('fee override validation', () => {
  it('TEST 10 — override without reason rejected', () => {
    const draft = previewToAssignDraft({
      installment_number: 1,
      due_date: '2026-08-01',
      amount: 8000,
    });
    const err = validateAssignInstallmentDrafts([draft], 8000, 10000, '');
    expect(err).toMatch(/adjustment reason/i);
  });

  it('TEST 11 — instalment total mismatch rejected', () => {
    const drafts = [
      previewToAssignDraft({ installment_number: 1, due_date: '2026-08-01', amount: 4000 }),
      previewToAssignDraft({ installment_number: 2, due_date: '2026-09-01', amount: 3500 }),
    ];
    const err = validateAssignInstallmentDrafts(drafts, 8000, 8000, '');
    expect(err).toMatch(/must equal the assigned student fee/i);
  });

  it('allows override with reason when totals match', () => {
    const drafts = [
      previewToAssignDraft({ installment_number: 1, due_date: '2026-08-01', amount: 4000 }),
      previewToAssignDraft({ installment_number: 2, due_date: '2026-09-01', amount: 4000 }),
    ];
    expect(validateAssignInstallmentDrafts(drafts, 8000, 10000, 'Discount')).toBeNull();
  });
});

describe('instalment count assignment schedule', () => {
  const plan = {
    total_amount: 12000,
    installment_count: 12,
    start_date: '2026-01-01',
    calculation_mode: 'equal' as const,
    regular_monthly_amount: null,
    payment_period: 'monthly' as const,
  };

  it('1 — monthly / 12 / $12,000 → 12 × $1,000', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 12000, 12);
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.amount === 1000)).toBe(true);
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(12000);
  });

  it('2 — monthly / 10 / $10,000 → 10 × $1,000', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 10000, 10);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.amount === 1000)).toBe(true);
  });

  it('3 / 18 — monthly / 12 / $10,000 totals exactly $10,000', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 10000, 12);
    expect(rows).toHaveLength(12);
    expect(rows[0].amount).toBe(833.33);
    expect(rows[11].amount).toBe(833.37);
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(10000);
  });

  it('4 — weekly / 10 dates exactly 7 days apart', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-07-27', [], 'weekly', 10000, 10);
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.due_date)).toEqual([
      '2026-07-27',
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ]);
  });

  it('5 — fortnightly / 10 dates exactly 14 days apart', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-07-27', [], 'fortnightly', 10000, 10);
    expect(rows).toHaveLength(10);
    for (let i = 1; i < rows.length; i++) {
      expect(addPeriodIso(rows[0].due_date, 'fortnightly', i)).toBe(rows[i].due_date);
    }
  });

  it('6 — monthly count 4 calendar months from 27/07', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-07-27', [], 'monthly', 10000, 4);
    expect(rows.map((r) => r.due_date)).toEqual([
      '2026-07-27',
      '2026-08-27',
      '2026-09-27',
      '2026-10-27',
    ]);
  });

  it('7 — change count 12 → 10 regenerates to 10 rows', () => {
    const twelve = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 10000, 12);
    expect(twelve).toHaveLength(12);
    const ten = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 10000, 10);
    expect(ten).toHaveLength(10);
    expect(sumInstallmentAmounts(ten.map((r) => r.amount))).toBe(10000);
  });

  it('8 — change count 10 → 6', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 10000, 6);
    expect(rows).toHaveLength(6);
    expect(sumInstallmentAmounts(rows.map((r) => r.amount))).toBe(10000);
  });

  it('9 — change assigned fee regenerates amounts', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 9000, 10);
    expect(rows.every((r) => r.amount === 900)).toBe(true);
  });

  it('10 / 19 — regenerated drafts are never auto-Paid', () => {
    const rows = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 10000, 10);
    for (const row of rows) {
      const input = assignDraftToInput(previewToAssignDraft(row));
      expect(input.status).toBe('pending');
      expect(input.paid_amount).toBe(0);
    }
  });

  it('12 — schedule total mismatch blocked with clear message', () => {
    const drafts = [
      previewToAssignDraft({ installment_number: 1, due_date: '2026-08-01', amount: 5000 }),
      previewToAssignDraft({ installment_number: 2, due_date: '2026-09-01', amount: 4500 }),
    ];
    const err = validateAssignInstallmentDrafts(drafts, 10000, 10000, '', 2);
    expect(err).toMatch(/Current schedule total/i);
    expect(err).toMatch(/Required total/i);
  });

  it('13 / 14 / 15 — invalid counts rejected', () => {
    expect(() => calculateEqualInstallments(1000, 0, '2026-08-01')).toThrow(/at least/i);
    expect(() => calculateEqualInstallments(1000, -3, '2026-08-01')).toThrow(/at least/i);
    expect(() => calculateEqualInstallments(1000, 61, '2026-08-01')).toThrow(/cannot exceed/i);
  });

  it('detects manual edits vs generated baseline', () => {
    const generated = buildAssignmentScheduleFromPlan(plan, '2026-08-01', [], 'monthly', 10000, 2);
    const drafts = generated.map((r) => previewToAssignDraft(r));
    expect(assignmentScheduleHasManualEdits(drafts, generated)).toBe(false);
    drafts[0].amount = '6000';
    expect(assignmentScheduleHasManualEdits(drafts, generated)).toBe(true);
  });
});

describe('TEST 12 / 13 — drag reorder pending amounts', () => {
  it('moves amounts across fixed due-date slots', () => {
    const rows = [
      {
        id: 1,
        installment_number: 1,
        due_date: '01-08-2026',
        amount: '1000',
        status: 'pending' as const,
        notes: 'a',
      },
      {
        id: 2,
        installment_number: 2,
        due_date: '01-10-2026',
        amount: '500',
        status: 'pending' as const,
        notes: 'b',
      },
    ];
    const next = applyAmountReorderKeepingSlots(rows, 1, 0);
    expect(next[0].due_date).toBe('01-08-2026');
    expect(next[0].amount).toBe('500');
    expect(next[1].due_date).toBe('01-10-2026');
    expect(next[1].amount).toBe('1000');
    expect(next[0].id).toBe(1);
    expect(next[1].id).toBe(2);
  });

  it('blocks dragging settled rows', () => {
    const rows = [
      {
        id: 1,
        installment_number: 1,
        due_date: '01-08-2026',
        amount: '1000',
        status: 'paid' as const,
        notes: '',
      },
      {
        id: 2,
        installment_number: 2,
        due_date: '01-10-2026',
        amount: '500',
        status: 'pending' as const,
        notes: '',
      },
    ];
    expect(() => applyAmountReorderKeepingSlots(rows, 0, 1)).toThrow(/Pending/i);
  });
});
