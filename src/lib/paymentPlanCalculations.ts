/** Currency helpers for payment plan installment calculations (2-decimal precision). */

import type {
  AssignInstallmentDraft,
  AssignInstallmentInput,
  PaymentPlanInstallmentStatus,
} from '../types/paymentPlans';

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function daysBetweenIso(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

export function shiftIsoDateByDays(isoDate: string, days: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonthsIso(isoDate: string, monthsToAdd: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month + monthsToAdd, day));
  return d.toISOString().slice(0, 10);
}

export interface PreviewInstallment {
  installment_number: number;
  due_date: string;
  amount: number;
}

export function calculateEqualInstallments(
  totalAmount: number,
  installmentCount: number,
  startDate: string
): PreviewInstallment[] {
  const total = roundCurrency(totalAmount);
  const count = Math.max(1, Math.floor(installmentCount));
  const base = roundCurrency(total / count);
  const rows: PreviewInstallment[] = [];
  let sumPrior = 0;

  for (let i = 1; i <= count; i++) {
    const amount = i < count ? base : roundCurrency(total - sumPrior);
    if (amount <= 0) {
      throw new Error('Final installment must be greater than zero.');
    }
    rows.push({
      installment_number: i,
      due_date: addMonthsIso(startDate, i - 1),
      amount,
    });
    sumPrior = roundCurrency(sumPrior + amount);
  }
  return rows;
}

export function calculateUnevenInstallments(
  totalAmount: number,
  installmentCount: number,
  startDate: string,
  regularMonthlyAmount: number
): PreviewInstallment[] {
  const total = roundCurrency(totalAmount);
  const count = Math.max(2, Math.floor(installmentCount));
  const regular = roundCurrency(regularMonthlyAmount);
  if (regular <= 0) {
    throw new Error('Regular monthly amount must be greater than zero.');
  }

  const rows: PreviewInstallment[] = [];
  let sumPrior = 0;

  for (let i = 1; i <= count; i++) {
    const amount = i < count ? regular : roundCurrency(total - sumPrior);
    if (amount <= 0) {
      throw new Error('Final installment must be greater than zero. Reduce the regular monthly amount.');
    }
    rows.push({
      installment_number: i,
      due_date: addMonthsIso(startDate, i - 1),
      amount,
    });
    sumPrior = roundCurrency(sumPrior + amount);
  }
  return rows;
}

export function sumInstallmentAmounts(amounts: number[]): number {
  return roundCurrency(amounts.reduce((acc, n) => acc + (Number.isFinite(n) ? n : 0), 0));
}

export function installmentSumMatchesTotal(installmentTotal: number, planTotal: number): boolean {
  return roundCurrency(installmentTotal) === roundCurrency(planTotal);
}

export function formatCurrencyAud(amount: number, currency = 'AUD'): string {
  try {
    return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function parseAmountInput(value: string): number | null {
  const v = String(value ?? '').trim().replace(/,/g, '');
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return roundCurrency(n);
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function pickerToIsoDate(value: string): string {
  const v = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return v;
}

export function isoToPickerDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export interface AssignmentSchedulePlan {
  total_amount: number;
  installment_count: number;
  start_date: string;
  calculation_mode: 'equal' | 'uneven' | 'custom';
  regular_monthly_amount: number | null;
}

export interface TemplateScheduleRow {
  installment_number: number;
  due_date: string;
  amount: number;
}

/** Build per-student schedule from template rows or plan calculation rules. */
export function buildAssignmentScheduleFromPlan(
  plan: AssignmentSchedulePlan,
  assignmentStartDate: string,
  templateRows: TemplateScheduleRow[]
): PreviewInstallment[] {
  const assignmentIso = pickerToIsoDate(assignmentStartDate);
  const planStartIso = pickerToIsoDate(plan.start_date);

  if (templateRows.length > 0) {
    const offsetDays = daysBetweenIso(planStartIso, assignmentIso);
    return templateRows.map((row) => ({
      installment_number: row.installment_number,
      due_date: shiftIsoDateByDays(pickerToIsoDate(row.due_date), offsetDays),
      amount: roundCurrency(row.amount),
    }));
  }

  const count = Math.max(1, plan.installment_count);
  if (plan.calculation_mode === 'uneven' && plan.regular_monthly_amount != null) {
    return calculateUnevenInstallments(
      plan.total_amount,
      count,
      assignmentIso,
      plan.regular_monthly_amount
    );
  }

  return calculateEqualInstallments(plan.total_amount, count, assignmentIso);
}

export function previewToAssignDraft(row: PreviewInstallment, isFirst: boolean): AssignInstallmentDraft {
  return {
    installment_number: row.installment_number,
    due_date: isoToPickerDate(row.due_date),
    amount: String(row.amount),
    waived: false,
    notes: '',
    record_payment: isFirst,
    paid_amount: isFirst ? String(row.amount) : '',
    payment_date: isFirst ? isoToPickerDate(isoToday()) : '',
  };
}

export function assignDraftToInput(row: AssignInstallmentDraft): AssignInstallmentInput {
  const amount = row.waived ? 0 : (parseAmountInput(row.amount) ?? 0);
  let status: PaymentPlanInstallmentStatus = row.waived ? 'waived' : 'pending';
  let paid_amount = 0;
  let payment_date: string | null = null;

  if (row.record_payment && row.installment_number === 1 && !row.waived) {
    paid_amount = parseAmountInput(row.paid_amount) ?? 0;
    payment_date = row.payment_date ? pickerToIsoDate(row.payment_date) : isoToday();
    if (paid_amount >= amount && amount > 0) {
      status = 'paid';
    } else if (paid_amount > 0) {
      status = 'partial';
    }
  }

  return {
    installment_number: row.installment_number,
    due_date: pickerToIsoDate(row.due_date),
    amount,
    status,
    paid_amount: row.waived ? 0 : paid_amount,
    payment_date: row.waived ? null : payment_date,
    notes: row.notes.trim() || null,
  };
}

export function validateAssignInstallmentDrafts(rows: AssignInstallmentDraft[]): string | null {
  if (rows.length === 0) return 'Payment schedule is empty.';

  for (const row of rows) {
    if (!pickerToIsoDate(row.due_date).match(/^\d{4}-\d{2}-\d{2}$/)) {
      return `Installment #${row.installment_number} needs a valid due date.`;
    }
    if (!row.waived && (parseAmountInput(row.amount) ?? -1) < 0) {
      return `Installment #${row.installment_number} amount is invalid.`;
    }
    if (row.record_payment && row.installment_number === 1 && !row.waived) {
      const amount = parseAmountInput(row.amount) ?? 0;
      const paid = parseAmountInput(row.paid_amount) ?? 0;
      if (paid < 0) return 'First installment paid amount cannot be negative.';
      if (paid > amount) return 'First installment paid amount cannot exceed the installment amount.';
      if (paid > 0 && !row.payment_date) return 'Payment date is required when recording the first installment.';
    }
  }

  return null;
}
