import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '../ui/Card';
import type { FinanceReportsDebug } from '../../types/financeReports';

type Props = {
  debug: FinanceReportsDebug | null;
  isSuperadmin: boolean;
};

export const FinanceReportsDebugPanel: React.FC<Props> = ({ debug, isSuperadmin }) => {
  const [open, setOpen] = useState(false);

  if (!isSuperadmin || !debug) return null;

  const diagnostics = debug.paymentDiagnostics;

  return (
    <Card className="border-dashed border-gray-300 bg-gray-50/80 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm font-medium text-gray-700"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Developer diagnostics
      </button>

      {open ? (
        <div className="mt-3 space-y-2 text-xs text-gray-700">
          <p>Paid invoices total: {debug.paidInvoicesTotal ?? '—'}</p>
          <p>Paid invoices with payment date: {debug.paidInvoicesWithPaymentDate ?? '—'}</p>
          <p>Paid invoices missing payment date: {debug.paidInvoicesMissingPaymentDate ?? '—'}</p>
          <p>Allocations created: {debug.allocationsCreated ?? 0}</p>
          <p>
            Allocation confidence — high: {debug.highConfidenceAllocations ?? 0}, medium:{' '}
            {debug.mediumConfidenceAllocations ?? 0}, low: {debug.lowConfidenceAllocations ?? 0}
          </p>
          <p>Distinct allocated invoices: {debug.distinctAllocatedInvoices ?? '—'}</p>
          <p>Total payment transactions synced: {debug.paymentCount ?? 0}</p>
          <p>Ledger entries synced: {debug.ledgerCount ?? debug.ledgerRowsTotal ?? '—'}</p>
          <p>Ledger rows filtered: {debug.ledgerRowsFiltered ?? '—'}</p>
          <p>Ledger invoice IDs in payment range: {debug.ledgerInvoiceIdsInRange ?? '—'}</p>
          <p>Report view: {debug.reportView ?? 'invoice_directory'}</p>
          <p>Matched payment transactions: {debug.matchedPaymentCount ?? '—'}</p>
          <p>Unmatched payment transactions: {debug.unmatchedPayments ?? debug.unmatchedPaymentCount ?? '—'}</p>
          <p>Unallocated paid invoices: {debug.unallocatedPaidInvoices ?? '—'}</p>
          {debug.paymentDateFilterDebug ? (
            <details className="mt-2" open>
              <summary className="cursor-pointer font-medium text-amber-800">Payment Date filter debug</summary>
              <div className="mt-2 space-y-1 rounded border border-amber-200 bg-white p-2">
                <p>Transactions in range: {debug.paymentDateFilterDebug.paymentTransactionsInRange}</p>
                <p>With direct invoice_id: {debug.paymentDateFilterDebug.paymentsWithDirectInvoiceId}</p>
                <p>Without invoice_id: {debug.paymentDateFilterDebug.paymentsWithoutInvoiceId}</p>
                <p>Resolved by contact_id: {debug.paymentDateFilterDebug.paymentsResolvedByContactId}</p>
                <p>Resolved by student name: {debug.paymentDateFilterDebug.paymentsResolvedByStudentName}</p>
                <p>Allocated by FIFO: {debug.paymentDateFilterDebug.paymentsAllocatedByFifo}</p>
                <p>Invoice rows returned: {debug.paymentDateFilterDebug.invoiceRowsReturned}</p>
                <p>Students in payments: {debug.paymentDateFilterDebug.distinctStudentsInPayments}</p>
                <p>Students mapped to invoices: {debug.paymentDateFilterDebug.distinctStudentsMappedToInvoices}</p>
                {(debug.paymentDateFilterDebug.unmappedPaymentSamples?.length ?? 0) > 0 ? (
                  <pre className="mt-1 max-h-40 overflow-auto text-[11px]">
                    {JSON.stringify(debug.paymentDateFilterDebug.unmappedPaymentSamples, null, 2)}
                  </pre>
                ) : null}
              </div>
            </details>
          ) : null}
          {(debug.missingInvoiceIdsFromLocalCache?.length ?? 0) > 0 ? (
            <p>
              Missing invoice IDs in local cache:{' '}
              {(debug.missingInvoiceIdsFromLocalCache ?? []).slice(0, 20).join(', ')}
            </p>
          ) : null}
          {diagnostics ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-medium">Payment filter diagnostics</summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-white p-2 text-[11px]">
                {JSON.stringify(diagnostics, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
};
