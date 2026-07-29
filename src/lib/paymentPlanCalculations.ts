/** Currency helpers and payment-plan schedule / status rules (2-decimal precision). */

import type {
  AssignInstallmentDraft,
  AssignInstallmentInput,
  PaymentPeriod,
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

/** Calendar-month add with month-end clamping (31 Jan + 1 month → 28/29 Feb). */
export function addMonthsIso(isoDate: string, monthsToAdd: number): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const totalMonths = monthIndex + monthsToAdd;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay)).toISOString().slice(0, 10);
}

export function addPeriodIso(isoDate: string, period: PaymentPeriod, index: number): string {
  const i = Math.max(0, Math.floor(index));
  if (period === 'weekly') return shiftIsoDateByDays(isoDate, i * 7);
  if (period === 'fortnightly') return shiftIsoDateByDays(isoDate, i * 14);
  // monthly + custom fallback: calendar months from start
  return addMonthsIso(isoDate, i);
}

export interface PreviewInstallment {
  installment_number: number;
  due_date: string;
  amount: number;
}

/** Inclusive bounds for student-specific instalment count. */
export const MIN_INSTALLMENT_COUNT = 1;
export const MAX_INSTALLMENT_COUNT = 60;

export function validateInstallmentCount(count: number): string | null {
  if (!Number.isFinite(count) || !Number.isInteger(count)) {
    return 'Instalment count must be a whole number.';
  }
  if (count < MIN_INSTALLMENT_COUNT) {
    return `Instalment count must be at least ${MIN_INSTALLMENT_COUNT}.`;
  }
  if (count > MAX_INSTALLMENT_COUNT) {
    return `Instalment count cannot exceed ${MAX_INSTALLMENT_COUNT}.`;
  }
  return null;
}

export function installmentCountOptions(max = 24): { value: string; label: string }[] {
  const capped = Math.min(Math.max(max, MIN_INSTALLMENT_COUNT), MAX_INSTALLMENT_COUNT);
  return Array.from({ length: capped }, (_, i) => {
    const n = i + 1;
    return { value: String(n), label: String(n) };
  });
}

/**
 * Equal division using integer cents. Remainder cents go to the final instalment
 * so the schedule total always equals the assigned fee exactly.
 */
export function calculateEqualInstallments(
  totalAmount: number,
  installmentCount: number,
  startDate: string,
  period: PaymentPeriod = 'monthly'
): PreviewInstallment[] {
  const countErr = validateInstallmentCount(Math.floor(installmentCount));
  if (countErr) throw new Error(countErr);

  const total = roundCurrency(totalAmount);
  if (total <= 0) throw new Error('Total amount must be greater than zero.');

  const count = Math.floor(installmentCount);
  const totalCents = Math.round(total * 100);
  const baseCents = Math.floor(totalCents / count);
  const rows: PreviewInstallment[] = [];
  let allocatedCents = 0;

  for (let i = 1; i <= count; i++) {
    const cents = i < count ? baseCents : totalCents - allocatedCents;
    if (cents <= 0) {
      throw new Error('Final installment must be greater than zero.');
    }
    const amount = roundCurrency(cents / 100);
    rows.push({
      installment_number: i,
      due_date: addPeriodIso(startDate, period, i - 1),
      amount,
    });
    allocatedCents += cents;
  }
  return rows;
}

export function calculateUnevenInstallments(
  totalAmount: number,
  installmentCount: number,
  startDate: string,
  regularMonthlyAmount: number,
  period: PaymentPeriod = 'monthly'
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
      due_date: addPeriodIso(startDate, period, i - 1),
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
  payment_period?: PaymentPeriod;
}

export interface TemplateScheduleRow {
  installment_number: number;
  due_date: string;
  amount: number;
}

/**
 * Build per-student schedule for assignment.
 * Due dates: calendar-aware from assignment start + payment period.
 * Amounts: equal division of assigned fee across installmentCount (cent-safe).
 * Template rows only supply the default count when installmentCount is omitted.
 * Do NOT day-offset template dates (that causes monthly drift).
 */
export function buildAssignmentScheduleFromPlan(
  plan: AssignmentSchedulePlan,
  assignmentStartDate: string,
  templateRows: TemplateScheduleRow[],
  period: PaymentPeriod = plan.payment_period ?? 'monthly',
  assignedTotalAmount?: number,
  installmentCount?: number
): PreviewInstallment[] {
  const assignmentIso = pickerToIsoDate(assignmentStartDate);
  const total =
    assignedTotalAmount != null ? roundCurrency(assignedTotalAmount) : roundCurrency(plan.total_amount);

  const defaultCount =
    installmentCount != null
      ? Math.floor(installmentCount)
      : Math.max(
          1,
          Math.floor(
            plan.installment_count ||
              (templateRows.length > 0 ? templateRows.length : 1)
          )
        );

  const countErr = validateInstallmentCount(defaultCount);
  if (countErr) throw new Error(countErr);

  // Student assignment always equal-distributes the assigned fee across the
  // selected instalment count (independent of template row amounts).
  return calculateEqualInstallments(total, defaultCount, assignmentIso, period);
}

/** Assignment draft: never auto-record payment / Paid. */
export function previewToAssignDraft(row: PreviewInstallment): AssignInstallmentDraft {
  return {
    installment_number: row.installment_number,
    due_date: isoToPickerDate(row.due_date),
    amount: String(row.amount),
    waived: false,
    notes: '',
    record_payment: false,
    paid_amount: '',
    payment_date: '',
  };
}

export function assignDraftToInput(row: AssignInstallmentDraft): AssignInstallmentInput {
  const amount = parseAmountInput(row.amount) ?? 0;
  const status: PaymentPlanInstallmentStatus = row.waived ? 'waived' : 'pending';
  const waiver_reason = row.waived ? row.notes.trim() || null : null;

  return {
    installment_number: row.installment_number,
    due_date: pickerToIsoDate(row.due_date),
    amount,
    status,
    paid_amount: 0,
    payment_date: null,
    notes: row.notes.trim() || null,
    waived_amount: row.waived ? amount : 0,
    waiver_reason,
    payment_reference: null,
  };
}

export function validateAssignInstallmentDrafts(
  rows: AssignInstallmentDraft[],
  assignedTotal: number,
  templateTotal: number,
  adjustmentReason: string,
  expectedInstallmentCount?: number
): string | null {
  if (rows.length === 0) return 'Payment schedule is empty.';

  const assigned = roundCurrency(assignedTotal);
  if (assigned <= 0) return 'Assigned course fee must be greater than zero.';

  if (expectedInstallmentCount != null) {
    const countErr = validateInstallmentCount(expectedInstallmentCount);
    if (countErr) return countErr;
    if (rows.length !== expectedInstallmentCount) {
      return `Schedule must contain exactly ${expectedInstallmentCount} instalment(s).`;
    }
  }

  if (roundCurrency(assigned) !== roundCurrency(templateTotal) && !adjustmentReason.trim()) {
    return 'Adjustment reason is required when assigned fee differs from the template fee.';
  }

  for (const row of rows) {
    if (!pickerToIsoDate(row.due_date).match(/^\d{4}-\d{2}-\d{2}$/)) {
      return `Installment #${row.installment_number} needs a valid due date.`;
    }
    if (!row.waived && (parseAmountInput(row.amount) ?? -1) < 0) {
      return `Installment #${row.installment_number} amount is invalid.`;
    }
    if (row.waived && !row.notes.trim()) {
      return `Installment #${row.installment_number}: waiver requires a mandatory reason.`;
    }
  }

  const scheduleTotal = sumInstallmentAmounts(
    rows.map((r) => parseAmountInput(r.amount) ?? 0)
  );
  if (!installmentSumMatchesTotal(scheduleTotal, assigned)) {
    return `Instalment total must equal the assigned student fee. Current schedule total: ${formatCurrencyAud(scheduleTotal)}. Required total: ${formatCurrencyAud(assigned)}.`;
  }

  return null;
}

/** Detect whether assignment draft rows differ from a freshly generated schedule. */
export function assignmentScheduleHasManualEdits(
  rows: AssignInstallmentDraft[],
  generated: PreviewInstallment[]
): boolean {
  if (rows.length !== generated.length) return true;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const gen = generated[i];
    if (pickerToIsoDate(row.due_date) !== gen.due_date) return true;
    if ((parseAmountInput(row.amount) ?? 0) !== gen.amount) return true;
    if (row.waived || row.notes.trim()) return true;
  }
  return false;
}

export function outstandingAmount(
  amountDue: number,
  paidAmount: number,
  status?: PaymentPlanInstallmentStatus,
  waivedAmount = 0
): number {
  if (status === 'waived') return 0;
  return roundCurrency(
    Math.max(0, roundCurrency(amountDue) - roundCurrency(paidAmount) - roundCurrency(waivedAmount))
  );
}

export function isInformationalOverdue(
  status: PaymentPlanInstallmentStatus,
  dueDateIso: string,
  businessDateIso: string = isoToday()
): boolean {
  if (status !== 'pending' && status !== 'partial') return false;
  return pickerToIsoDate(dueDateIso) < pickerToIsoDate(businessDateIso);
}

export function validatePaymentStatusChange(input: {
  amountDue: number;
  paidAmount: number;
  status: PaymentPlanInstallmentStatus;
  paymentDate: string | null;
  waiverReason?: string | null;
  waivedAmount?: number;
}): string | null {
  const amount = roundCurrency(input.amountDue);
  const paid = roundCurrency(input.paidAmount);
  const waived = roundCurrency(input.waivedAmount ?? 0);

  if (paid < 0) return 'Paid amount cannot be negative.';
  if (paid > amount) return 'Paid amount cannot exceed the instalment amount.';

  if (input.status === 'paid') {
    if (paid !== amount || amount <= 0) {
      return 'Paid amount does not match the instalment amount. Mark this payment as Partial or record the full payment before selecting Paid.';
    }
    if (!input.paymentDate) return 'Payment date is required when status is Paid.';
  }

  if (input.status === 'partial') {
    if (paid <= 0 || paid >= amount) {
      return 'Partial status requires paid amount greater than 0 and less than the instalment amount.';
    }
  }

  if (input.status === 'pending' && paid !== 0) {
    return 'Pending status requires paid amount of 0.';
  }

  if (input.status === 'waived') {
    if (!String(input.waiverReason ?? '').trim()) {
      return 'Waiver requires a mandatory reason.';
    }
    if (paid !== 0) {
      return 'Waived instalments cannot record cash received. Use Partial for cash, or clear paid amount for a full waiver.';
    }
    if (waived < 0 || (waived > 0 && waived > amount)) {
      return 'Waived amount cannot exceed the instalment amount.';
    }
  }

  return null;
}

/** Derive a consistent status from amounts (does not auto-upgrade to Paid silently). */
export function deriveStatusFromAmounts(
  amountDue: number,
  paidAmount: number,
  preferred?: PaymentPlanInstallmentStatus
): PaymentPlanInstallmentStatus {
  const amount = roundCurrency(amountDue);
  const paid = roundCurrency(paidAmount);
  if (preferred === 'waived') return 'waived';
  if (paid <= 0) return preferred === 'overdue' ? 'overdue' : 'pending';
  if (paid < amount) return 'partial';
  if (paid === amount) return 'paid';
  return 'partial';
}

/**
 * Reorder pending installment amounts across fixed schedule slots.
 * Due dates / installment numbers stay with the slot; amounts move.
 */
export function reorderPendingAmountsByIds<T extends { id: number; status: PaymentPlanInstallmentStatus }>(
  rows: T[],
  orderedPendingIds: number[]
): T[] {
  const pending = rows.filter((r) => r.status === 'pending');
  const pendingIds = new Set(pending.map((r) => r.id));
  if (orderedPendingIds.length !== pending.length || orderedPendingIds.some((id) => !pendingIds.has(id))) {
    throw new Error('Only Pending instalments can be reordered.');
  }

  const payloadById = new Map(pending.map((r) => [r.id, r]));
  const slots = pending.slice().sort((a, b) => rows.indexOf(a) - rows.indexOf(b));
  const nextPayloads = orderedPendingIds.map((id) => payloadById.get(id)!);

  const result = rows.map((row) => ({ ...row }));
  let pi = 0;
  for (let i = 0; i < result.length; i++) {
    if (result[i].status !== 'pending') continue;
    const slotMeta = slots[pi];
    const payload = nextPayloads[pi];
    // Keep slot identity (id/due/number from slot), take movable fields from payload.
    result[i] = {
      ...payload,
      id: slotMeta.id,
      // slot fields restored by caller for due_date / installment_number
    } as T;
    pi += 1;
  }
  return result;
}

export function applyAmountReorderKeepingSlots<
  T extends {
    id?: number;
    installment_number: number;
    due_date: string;
    amount: string;
    status: PaymentPlanInstallmentStatus;
    notes: string;
  },
>(rows: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return rows;
  if (rows[fromIndex]?.status !== 'pending' || rows[toIndex]?.status !== 'pending') {
    throw new Error('Only Pending instalments can be reordered.');
  }

  // Only pending rows participate; settled stay fixed.
  const pendingIndexes = rows
    .map((r, i) => (r.status === 'pending' ? i : -1))
    .filter((i) => i >= 0);

  const fromPendingPos = pendingIndexes.indexOf(fromIndex);
  const toPendingPos = pendingIndexes.indexOf(toIndex);
  if (fromPendingPos < 0 || toPendingPos < 0) {
    throw new Error('Only Pending instalments can be reordered.');
  }

  const movable = pendingIndexes.map((i) => ({
    amount: rows[i].amount,
    notes: rows[i].notes,
  }));
  const [moved] = movable.splice(fromPendingPos, 1);
  movable.splice(toPendingPos, 0, moved);

  const next = rows.map((r) => ({ ...r }));
  pendingIndexes.forEach((rowIndex, j) => {
    next[rowIndex] = {
      ...next[rowIndex],
      amount: movable[j].amount,
      notes: movable[j].notes,
    };
  });
  return next;
}
