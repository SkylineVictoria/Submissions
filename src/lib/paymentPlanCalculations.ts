/** Currency helpers for payment plan installment calculations (2-decimal precision). */

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
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
