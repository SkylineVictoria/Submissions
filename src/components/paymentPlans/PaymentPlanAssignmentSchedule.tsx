import React from 'react';
import { Input } from '../ui/Input';
import { DatePicker } from '../ui/DatePicker';
import { Checkbox } from '../ui/Checkbox';
import type { AssignInstallmentDraft } from '../../types/paymentPlans';
import {
  formatCurrencyAud,
  parseAmountInput,
  sumInstallmentAmounts,
} from '../../lib/paymentPlanCalculations';

interface PaymentPlanAssignmentScheduleProps {
  rows: AssignInstallmentDraft[];
  currency: string;
  planTotal: number;
  onChangeRow: (index: number, patch: Partial<AssignInstallmentDraft>) => void;
}

export const PaymentPlanAssignmentSchedule: React.FC<PaymentPlanAssignmentScheduleProps> = ({
  rows,
  currency,
  planTotal,
  onChangeRow,
}) => {
  const scheduleTotal = sumInstallmentAmounts(
    rows.map((r) => (r.waived ? 0 : parseAmountInput(r.amount) ?? 0))
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4 text-center">
        Select a plan to preview the payment schedule.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
        <span>Adjust due dates, amounts (discounts), or waive installments before assigning.</span>
        <span>
          Schedule total:{' '}
          <strong className="text-[var(--text)]">
            {formatCurrencyAud(scheduleTotal, currency)}
          </strong>
          {scheduleTotal !== planTotal ? (
            <span className="text-amber-700 ml-1">(plan template {formatCurrencyAud(planTotal, currency)})</span>
          ) : null}
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 max-h-[min(50vh,420px)] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-white z-10">
            <tr className="border-b border-[var(--border)] text-left text-gray-600">
              <th className="px-2 py-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">Due date</th>
              <th className="px-2 py-2 font-semibold">Amount</th>
              <th className="px-2 py-2 font-semibold">Waive</th>
              <th className="px-2 py-2 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <React.Fragment key={`assign-${row.installment_number}`}>
                <tr className="border-b border-gray-100">
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
                          record_payment: checked ? false : row.installment_number === 1,
                        })
                      }
                      className="justify-center"
                    />
                  </td>
                  <td className="px-2 py-2 min-w-[140px] align-top">
                    <Input
                      value={row.notes}
                      onChange={(e) => onChangeRow(index, { notes: e.target.value })}
                      placeholder="Discount, waiver reason…"
                    />
                  </td>
                </tr>
                {row.installment_number === 1 ? (
                  <tr className="border-b border-gray-100 bg-[#fff7ed]/60">
                    <td colSpan={5} className="px-2 py-3">
                      <div className="space-y-3">
                        <Checkbox
                          label="Record first installment payment now"
                          checked={row.record_payment}
                          disabled={row.waived}
                          onChange={(checked) =>
                            onChangeRow(index, {
                              record_payment: checked,
                              paid_amount:
                                checked && !row.paid_amount
                                  ? row.amount
                                  : row.paid_amount,
                              payment_date: checked && !row.payment_date ? row.due_date : row.payment_date,
                            })
                          }
                        />
                        {row.record_payment && !row.waived ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pl-8">
                            <Input
                              label="Amount received"
                              type="number"
                              step="0.01"
                              min="0"
                              value={row.paid_amount}
                              onChange={(e) => onChangeRow(index, { paid_amount: e.target.value })}
                            />
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">
                                Payment date
                              </label>
                              <DatePicker
                                value={row.payment_date}
                                onChange={(v) => onChangeRow(index, { payment_date: v })}
                              />
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
