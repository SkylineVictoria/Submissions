import React from 'react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';
import type { PaymentPlanInstallmentStatus } from '../../types/paymentPlans';
import { INSTALLMENT_STATUS_OPTIONS } from '../../types/paymentPlans';
import { formatCurrencyAud } from '../../lib/paymentPlanCalculations';

export interface EditableTemplateInstallmentRow {
  id?: number;
  installment_number: number;
  due_date: string;
  amount: string;
}

export interface EditableStudentInstallmentRow {
  id?: number;
  installment_number: number;
  due_date: string;
  amount: string;
  status: PaymentPlanInstallmentStatus;
  paid_amount: string;
  payment_date: string;
  notes: string;
}

interface TemplateInstallmentsTableProps {
  mode: 'template';
  rows: EditableTemplateInstallmentRow[];
  currency: string;
  isDraft: boolean;
  onChangeRow: (index: number, patch: Partial<EditableTemplateInstallmentRow>) => void;
}

interface StudentInstallmentsTableProps {
  mode: 'student';
  rows: EditableStudentInstallmentRow[];
  currency: string;
  isDraft: boolean;
  onChangeRow: (index: number, patch: Partial<EditableStudentInstallmentRow>) => void;
}

type PaymentPlanInstallmentsTableProps = TemplateInstallmentsTableProps | StudentInstallmentsTableProps;

export const PaymentPlanInstallmentsTable: React.FC<PaymentPlanInstallmentsTableProps> = (props) => {
  const { rows, currency, isDraft, onChangeRow } = props;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4 text-center">
        No installments yet. Generate installments or add custom rows.
      </p>
    );
  }

  if (props.mode === 'template') {
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-gray-600">
              <th className="px-2 py-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">Due date</th>
              <th className="px-2 py-2 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? `tpl-${row.installment_number}`} className="border-b border-gray-100">
                <td className="px-2 py-2">{row.installment_number}</td>
                <td className="px-2 py-2 min-w-[140px]">
                  {isDraft ? (
                    <DatePicker value={row.due_date} onChange={(v) => onChangeRow(index, { due_date: v })} />
                  ) : (
                    <span>{row.due_date}</span>
                  )}
                </td>
                <td className="px-2 py-2 min-w-[110px]">
                  {isDraft ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.amount}
                      onChange={(e) => onChangeRow(index, { amount: e.target.value })}
                    />
                  ) : (
                    <span>{formatCurrencyAud(Number(row.amount), currency)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-gray-600">
            <th className="px-2 py-2 font-semibold">#</th>
            <th className="px-2 py-2 font-semibold">Due date</th>
            <th className="px-2 py-2 font-semibold">Amount</th>
            <th className="px-2 py-2 font-semibold">Status</th>
            <th className="px-2 py-2 font-semibold">Paid</th>
            <th className="px-2 py-2 font-semibold">Payment date</th>
            <th className="px-2 py-2 font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {(rows as EditableStudentInstallmentRow[]).map((row, index) => (
            <tr key={row.id ?? `stu-${row.installment_number}`} className="border-b border-gray-100">
              <td className="px-2 py-2">{row.installment_number}</td>
              <td className="px-2 py-2 min-w-[140px]">
                {isDraft ? (
                  <DatePicker value={row.due_date} onChange={(v) => onChangeRow(index, { due_date: v })} />
                ) : (
                  <span>{row.due_date}</span>
                )}
              </td>
              <td className="px-2 py-2 min-w-[110px]">
                {isDraft ? (
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={row.amount}
                    onChange={(e) => onChangeRow(index, { amount: e.target.value })}
                  />
                ) : (
                  <span>{formatCurrencyAud(Number(row.amount), currency)}</span>
                )}
              </td>
              <td className="px-2 py-2 min-w-[120px]">
                <Select
                  value={row.status}
                  onChange={(v) => onChangeRow(index, { status: v as PaymentPlanInstallmentStatus })}
                  options={INSTALLMENT_STATUS_OPTIONS}
                  compact
                />
              </td>
              <td className="px-2 py-2 min-w-[100px]">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.paid_amount}
                  onChange={(e) => onChangeRow(index, { paid_amount: e.target.value })}
                />
              </td>
              <td className="px-2 py-2 min-w-[140px]">
                <DatePicker
                  value={row.payment_date}
                  onChange={(v) => onChangeRow(index, { payment_date: v })}
                />
              </td>
              <td className="px-2 py-2 min-w-[140px]">
                <Input
                  value={row.notes}
                  onChange={(e) => onChangeRow(index, { notes: e.target.value })}
                  placeholder="Optional"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
