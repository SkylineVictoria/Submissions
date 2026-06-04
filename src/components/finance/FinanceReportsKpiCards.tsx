import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Card } from '../ui/Card';
import { formatAud, ADJUSTMENT_HELPER_TEXT } from '../../services/financeReports';
import type { FinanceReportsSummary } from '../../types/financeReports';

type Props = {
  summary: FinanceReportsSummary;
};

const currencyItems: {
  key: keyof FinanceReportsSummary;
  label: string;
  accent?: string;
  helper?: string;
}[] = [
  { key: 'totalInvoiced', label: 'Total Invoiced' },
  { key: 'paidTotal', label: 'Paid Total', accent: 'text-emerald-700' },
  { key: 'outstandingTotal', label: 'Total Outstanding', accent: 'text-amber-700' },
  { key: 'voidTotal', label: 'Void Total', accent: 'text-gray-600' },
  { key: 'adjustmentTotal', label: 'Adjustment / Unreconciled', accent: 'text-orange-700', helper: ADJUSTMENT_HELPER_TEXT },
];

export const FinanceReportsKpiCards: React.FC<Props> = ({ summary }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {currencyItems.map((item) => (
      <Card key={item.key} className="p-4">
        <div className="flex items-start gap-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{item.label}</p>
          {item.helper ? (
            <span className="group relative inline-flex shrink-0">
              <HelpCircle className="h-3.5 w-3.5 text-gray-400" aria-hidden />
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 hidden w-64 -translate-x-1/2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 shadow-md group-hover:block group-focus-within:block"
              >
                {item.helper}
              </span>
            </span>
          ) : null}
        </div>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${item.accent ?? 'text-[var(--text)]'}`}>
          {formatAud(Number(summary[item.key]))}
        </p>
      </Card>
    ))}

    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Reconciliation Status</p>
      <div className="mt-2">
        {summary.isReconciled ? (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
            Reconciled
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-800">
            Difference Found
          </span>
        )}
      </div>
    </Card>
  </div>
);
