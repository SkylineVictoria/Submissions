import React from 'react';
import { Card } from '../ui/Card';
import { formatAud } from '../../lib/financeReports';
import type { FinanceReportsSummary } from '../../types/financeReports';

type Props = {
  summary: FinanceReportsSummary;
};

const items: {
  key: keyof FinanceReportsSummary;
  label: string;
  format: 'currency' | 'count';
  accent?: string;
}[] = [
  { key: 'totalInvoiced', label: 'Total Invoiced', format: 'currency' },
  { key: 'totalCollected', label: 'Total Collected', format: 'currency', accent: 'text-emerald-700' },
  { key: 'totalOutstanding', label: 'Total Outstanding', format: 'currency', accent: 'text-amber-700' },
  { key: 'pendingInvoices', label: 'Total Pending Invoices', format: 'count' },
  { key: 'paidInvoices', label: 'Paid Invoices', format: 'count', accent: 'text-emerald-700' },
  { key: 'partiallyPaidInvoices', label: 'Partially Paid Invoices', format: 'count', accent: 'text-sky-700' },
];

export const FinanceReportsKpiCards: React.FC<Props> = ({ summary }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {items.map((item) => {
      const raw = summary[item.key];
      const display = item.format === 'currency' ? formatAud(Number(raw)) : String(raw);
      return (
        <Card key={item.key} className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{item.label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${item.accent ?? 'text-[var(--text)]'}`}>{display}</p>
        </Card>
      );
    })}
  </div>
);
