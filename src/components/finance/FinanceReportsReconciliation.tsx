import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Card } from '../ui/Card';
import { formatAud, ADJUSTMENT_HELPER_TEXT } from '../../services/financeReports';
import type { FinanceReportsSummary } from '../../types/financeReports';

type Props = {
  summary: FinanceReportsSummary;
};

type BreakdownRow = {
  label: string;
  value: number;
  emphasis?: boolean;
  helper?: string;
};

export const FinanceReportsReconciliation: React.FC<Props> = ({ summary }) => {
  const rows: BreakdownRow[] = [
    { label: 'Total Invoiced', value: summary.totalInvoiced, emphasis: true },
    { label: 'Paid Total', value: summary.paidTotal },
    { label: 'Outstanding Total', value: summary.outstandingTotal },
    { label: 'Void Total', value: summary.voidTotal },
    { label: 'Cancelled Total', value: summary.cancelledTotal },
    {
      label: 'Adjustment / Unreconciled',
      value: summary.adjustmentTotal,
      helper: ADJUSTMENT_HELPER_TEXT,
    },
    { label: 'Final Reconciled Total', value: summary.reconciliationTotal, emphasis: true },
  ];

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold text-[var(--text)]">Reconciliation Breakdown</h3>
        {summary.isReconciled ? (
          <span className="inline-flex w-fit items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
            Reconciled
          </span>
        ) : (
          <span className="inline-flex w-fit items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-800">
            Difference Found
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-sm">
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.label}
                className={
                  row.emphasis
                    ? 'border-t border-gray-200 font-semibold text-[var(--text)]'
                    : index === rows.length - 2
                      ? 'border-t border-dashed border-gray-200 text-gray-700'
                      : 'text-gray-700'
                }
              >
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-1.5">
                    <span>{row.label}</span>
                    {row.helper ? (
                      <span className="group relative inline-flex shrink-0">
                        <HelpCircle className="h-3.5 w-3.5 text-gray-400" aria-hidden />
                        <span
                          role="tooltip"
                          className="pointer-events-none absolute left-0 top-full z-10 mt-2 hidden w-64 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-normal text-gray-700 shadow-md group-hover:block group-focus-within:block"
                        >
                          {row.helper}
                        </span>
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="py-2.5 text-right tabular-nums">{formatAud(row.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Paid Total + Outstanding Total + Void Total + Cancelled Total + Adjustment / Unreconciled = Total Invoiced
      </p>
    </Card>
  );
};
