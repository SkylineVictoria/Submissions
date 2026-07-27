import React from 'react';
import { Input } from '../ui/Input';
import { DatePicker } from '../ui/DatePicker';
import { Checkbox } from '../ui/Checkbox';
import type { AssignInstallmentDraft, PaymentPeriod } from '../../types/paymentPlans';
import { PAYMENT_PERIOD_OPTIONS } from '../../types/paymentPlans';
import {
  formatCurrencyAud,
  parseAmountInput,
  sumInstallmentAmounts,
} from '../../lib/paymentPlanCalculations';

interface PaymentPlanAssignmentScheduleProps {
  rows: AssignInstallmentDraft[];
  currency: string;
  planTotal: number;
  assignedTotal: number;
  paymentPeriod?: PaymentPeriod;
  installmentCount?: number;
  onChangeRow: (index: number, patch: Partial<AssignInstallmentDraft>) => void;
}

export const PaymentPlanAssignmentSchedule: React.FC<PaymentPlanAssignmentScheduleProps> = ({
  rows,
  currency,
  planTotal,
  assignedTotal,
  paymentPeriod,
  installmentCount,
  onChangeRow,
}) => {
  const scheduleTotal = sumInstallmentAmounts(
    rows.map((r) => parseAmountInput(r.amount) ?? 0)
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4 text-center">
        Select a plan to preview the payment schedule.
      </p>
    );
  }

  const periodLabel =
    PAYMENT_PERIOD_OPTIONS.find((o) => o.value === paymentPeriod)?.label ?? paymentPeriod;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-gray-700">
        <span>
          Assigned fee: <strong>{formatCurrencyAud(assignedTotal, currency)}</strong>
        </span>
        {periodLabel ? (
          <span>
            Payment period: <strong>{periodLabel}</strong>
          </span>
        ) : null}
        <span>
          Instalments: <strong>{installmentCount ?? rows.length}</strong>
        </span>
        <span>
          Schedule total:{' '}
          <strong className={scheduleTotal !== assignedTotal ? 'text-amber-700' : ''}>
            {formatCurrencyAud(scheduleTotal, currency)}
          </strong>
          {scheduleTotal !== assignedTotal ? (
            <span className="text-amber-700 ml-1 text-xs">
              (must equal {formatCurrencyAud(assignedTotal, currency)})
            </span>
          ) : scheduleTotal !== planTotal ? (
            <span className="text-gray-500 ml-1 text-xs">
              (template {formatCurrencyAud(planTotal, currency)})
            </span>
          ) : null}
        </span>
      </div>

      <p className="text-xs text-gray-600">
        Adjust due dates and amounts before assigning. No instalment is marked Paid until payment is
        recorded later. Waiving a row does not change the instalment count.
      </p>

      <div className="overflow-x-auto -mx-1 max-h-[min(50vh,420px)] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-[var(--border)] text-left text-gray-600">
              <th className="px-2 py-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">Due date</th>
              <th className="px-2 py-2 font-semibold">Amount</th>
              <th className="px-2 py-2 font-semibold">Waive</th>
              <th className="px-2 py-2 font-semibold">Notes / waiver reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`assign-${row.installment_number}`} className="border-b border-gray-100">
                <td className="px-2 py-2 align-top">{row.installment_number}</td>
                <td className="px-2 py-2 min-w-[140px] align-top">
                  <DatePicker
                    value={row.due_date}
                    onChange={(v) => onChangeRow(index, { due_date: v })}
                  />
                </td>
                <td className="px-2 py-2 min-w-[110px] align-top">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.amount}
                    disabled={row.waived}
                    onChange={(e) => onChangeRow(index, { amount: e.target.value })}
                  />
                </td>
                <td className="px-2 py-2 min-w-[90px] align-top">
                  <Checkbox
                    label=""
                    checked={row.waived}
                    onChange={(checked) =>
                      onChangeRow(index, {
                        waived: checked,
                        record_payment: false,
                        paid_amount: '',
                        payment_date: '',
                      })
                    }
                    className="justify-center"
                  />
                </td>
                <td className="px-2 py-2 min-w-[160px] align-top">
                  <Input
                    value={row.notes}
                    onChange={(e) => onChangeRow(index, { notes: e.target.value })}
                    placeholder={row.waived ? 'Waiver reason (required)' : 'Optional note'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
