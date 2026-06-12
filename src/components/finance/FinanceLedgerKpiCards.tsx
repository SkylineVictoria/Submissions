import React from 'react';
import { Card } from '../ui/Card';
import { formatAud } from '../../services/financeReports';
import type { FinanceLedgerSummary } from '../../types/financeReports';

type Props = {
  summary: FinanceLedgerSummary;
};

const items: { key: keyof FinanceLedgerSummary; label: string; accent?: string }[] = [
  { key: 'totalDebit', label: 'Total Debit' },
  { key: 'totalCredit', label: 'Total Credit', accent: 'text-emerald-700' },
  { key: 'netMovement', label: 'Net Movement', accent: 'text-[var(--text)]' },
  { key: 'paymentReceivedTotal', label: 'Payment Received Total', accent: 'text-emerald-700' },
  { key: 'invoiceDebitTotal', label: 'Invoice Debit Total', accent: 'text-amber-700' },
];

export const FinanceLedgerKpiCards: React.FC<Props> = ({ summary }) => (
  <div className="space-y-3">
    {summary.summaryNote ? <p className="text-sm text-gray-600">{summary.summaryNote}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Card key={item.key} className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{item.label}</p>
          <p className={`mt-1 text-2xl font-bold tabular-nums ${item.accent ?? 'text-[var(--text)]'}`}>
            {formatAud(Number(summary[item.key]))}
          </p>
        </Card>
      ))}
      <Card className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Ledger Entries</p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-[var(--text)]">{summary.ledgerEntries}</p>
      </Card>
    </div>
  </div>
);
