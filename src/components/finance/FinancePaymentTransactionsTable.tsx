import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AdminListPagination } from '../admin/AdminListPagination';
import { SortableTh } from '../admin/SortableTh';
import type { SortDirection } from '../admin/SortableTh';
import { formatAud, formatPaginationRange, formatPaymentDateTime } from '../../services/financeReports';
import type { FinancePaymentTransactionRow } from '../../types/financeReports';
import { toast } from '../../utils/toast';

type SortKey =
  | 'studentName'
  | 'invoiceNo'
  | 'paymentDate'
  | 'paymentMethod'
  | 'transactionType'
  | 'paymentAmount';

type Props = {
  rows: FinancePaymentTransactionRow[];
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const FinancePaymentTransactionsTable: React.FC<Props> = ({ rows }) => {
  const [tableSearch, setTableSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'paymentDate', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const filtered = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => {
        const hay = `${r.studentName} ${r.invoiceNo} ${r.contactId} ${r.paymentMethod ?? ''} ${r.transactionType ?? ''} ${r.reference ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
  }, [rows, tableSearch, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const rangeLabel = `${formatPaginationRange(safePage, pageSize, filtered.length)} payment transactions`;

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
    setPage(1);
  };

  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error('No transactions to export');
      return;
    }
    const headers = [
      'Student Name',
      'Invoice No',
      'Contact ID',
      'Transaction Date',
      'Payment Method',
      'Transaction Type',
      'Amount',
      'Unapplied',
      'User',
      'Reference',
    ];
    const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines = [
      headers.join(','),
      ...filtered.map((r) =>
        [
          r.studentName,
          r.invoiceNo,
          r.contactId,
          r.transactionDate ?? r.paymentDate ?? '',
          r.paymentMethod ?? '',
          r.transactionType ?? '',
          r.paymentAmount,
          r.unappliedAmount,
          r.userFullName ?? '',
          r.reference ?? '',
        ]
          .map((c) => escape(String(c)))
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `finance-payment-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} transaction${filtered.length !== 1 ? 's' : ''}`);
  };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-bold text-[var(--text)]">Payment transactions</h3>
          <p className="mt-1 text-xs text-gray-500">
            One row per aXcelerate Money Received transaction. Compare this count with the aXcelerate Transactions report.
            Invoice directory above may show fewer rows when multiple payments belong to the same invoice.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="mr-1.5 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="mb-4">
        <Input
          value={tableSearch}
          onChange={(e) => {
            setTableSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search transactions…"
          className="max-w-md"
        />
      </div>

      <AdminListPagination
        placement="top"
        totalItems={filtered.length}
        pageSize={pageSize}
        currentPage={safePage}
        totalPages={totalPages}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        onGoToPage={setPage}
        itemLabel="transactions"
        rangeLabel={rangeLabel}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <SortableTh label="Student" className="py-3 pr-3" active={sort.key === 'studentName'} direction={sort.dir} onToggle={() => toggleSort('studentName')} />
              <SortableTh label="Invoice No" className="py-3 pr-3" active={sort.key === 'invoiceNo'} direction={sort.dir} onToggle={() => toggleSort('invoiceNo')} />
              <SortableTh label="Transaction Date" className="py-3 pr-3" active={sort.key === 'paymentDate'} direction={sort.dir} onToggle={() => toggleSort('paymentDate')} />
              <SortableTh label="Method" className="py-3 pr-3" active={sort.key === 'paymentMethod'} direction={sort.dir} onToggle={() => toggleSort('paymentMethod')} />
              <SortableTh label="Type" className="py-3 pr-3" active={sort.key === 'transactionType'} direction={sort.dir} onToggle={() => toggleSort('transactionType')} />
              <SortableTh label="Amount" className="py-3 pr-3 text-right" active={sort.key === 'paymentAmount'} direction={sort.dir} onToggle={() => toggleSort('paymentAmount')} />
              <th className="py-3 pr-3 font-semibold">Reference</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-gray-500">
                  No payment transactions match your filters.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr key={row.paymentId} className="border-b border-gray-100 hover:bg-[var(--brand)]/5">
                  <td className="py-3 pr-3 font-medium text-gray-900">{row.studentName || '—'}</td>
                  <td className="py-3 pr-3 font-mono text-xs">{row.invoiceNo || '—'}</td>
                  <td className="py-3 pr-3 text-gray-700">
                    {formatPaymentDateTime(row.transactionDate ?? row.paymentDate, { unavailableLabel: '—' })}
                  </td>
                  <td className="py-3 pr-3 text-gray-700">{row.paymentMethod || '—'}</td>
                  <td className="py-3 pr-3 text-gray-700">{row.transactionType || '—'}</td>
                  <td className="py-3 pr-3 text-right tabular-nums text-emerald-700">{formatAud(row.paymentAmount)}</td>
                  <td className="py-3 pr-3 text-gray-600">{row.reference || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <AdminListPagination
        placement="bottom"
        totalItems={filtered.length}
        pageSize={pageSize}
        currentPage={safePage}
        totalPages={totalPages}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        onGoToPage={setPage}
        itemLabel="transactions"
        rangeLabel={rangeLabel}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />
    </Card>
  );
};
