import React, { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AdminListPagination } from '../admin/AdminListPagination';
import { SortableTh } from '../admin/SortableTh';
import type { SortDirection } from '../admin/SortableTh';
import { formatAud, formatFinanceDate, formatPaginationRange, formatPaymentDateTime } from '../../services/financeReports';
import type { FinanceLedgerRow } from '../../types/financeReports';
import { toast } from '../../utils/toast';

type SortKey =
  | 'studentName'
  | 'email'
  | 'ledgerDate'
  | 'entryDateTime'
  | 'entryType'
  | 'reference'
  | 'relatedInvoiceNo'
  | 'paymentMethod'
  | 'debit'
  | 'credit'
  | 'balance';

type Props = {
  rows: FinanceLedgerRow[];
};

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export const FinanceLedgerTable: React.FC<Props> = ({ rows }) => {
  const [tableSearch, setTableSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'ledgerDate', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => {
        const hay = `${r.studentName} ${r.email} ${r.reference} ${r.relatedInvoiceNo} ${r.entryType}`.toLowerCase();
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
  const rangeLabel = formatPaginationRange(safePage, pageSize, filtered.length);

  const exportCsv = () => {
    const header = [
      'Student Name',
      'Email',
      'Ledger Date',
      'Entry Date',
      'Type',
      'Reference',
      'Related Invoice',
      'Payment Method',
      'Debit',
      'Credit',
      'Balance',
    ];
    const lines = filtered.map((r) =>
      [
        r.studentName,
        r.email,
        r.ledgerDate,
        r.entryDateTime ?? '',
        r.entryType,
        r.reference,
        r.relatedInvoiceNo,
        r.paymentMethod,
        r.debit,
        r.credit,
        r.balance,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `student-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Ledger CSV exported');
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text)]">Student Ledger Directory</h2>
          <p className="text-xs text-gray-500">{filtered.length} ledger entries</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={tableSearch}
            onChange={(e) => {
              setTableSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search table…"
            className="min-w-[12rem]"
          />
          <Button type="button" variant="outline" size="sm" className="inline-flex items-center gap-2" onClick={exportCsv}>
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
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
        itemLabel="ledger entries"
        rangeLabel={rangeLabel}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        onPageSizeChange={(n) => {
          setPageSize(n);
          setPage(1);
        }}
      />

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <SortableTh label="Student Name" sortKey="studentName" sort={sort} onSort={setSort} />
              <SortableTh label="Email" sortKey="email" sort={sort} onSort={setSort} />
              <SortableTh label="Ledger Date" sortKey="ledgerDate" sort={sort} onSort={setSort} />
              <SortableTh label="Entry Date" sortKey="entryDateTime" sort={sort} onSort={setSort} />
              <SortableTh label="Type" sortKey="entryType" sort={sort} onSort={setSort} />
              <SortableTh label="Reference" sortKey="reference" sort={sort} onSort={setSort} />
              <SortableTh label="Related Invoice" sortKey="relatedInvoiceNo" sort={sort} onSort={setSort} />
              <SortableTh label="Payment Method" sortKey="paymentMethod" sort={sort} onSort={setSort} />
              <SortableTh label="Debit" sortKey="debit" sort={sort} onSort={setSort} align="right" />
              <SortableTh label="Credit" sortKey="credit" sort={sort} onSort={setSort} align="right" />
              <SortableTh label="Balance" sortKey="balance" sort={sort} onSort={setSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-gray-500">
                  No ledger entries match the current filters.
                </td>
              </tr>
            ) : (
              pageRows.map((row, idx) => (
                <tr key={`${row.reference}-${row.ledgerDate}-${idx}`} className="hover:bg-gray-50/80">
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-[var(--text)]">{row.studentName || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">{row.email || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{formatFinanceDate(row.ledgerDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3">{formatPaymentDateTime(row.entryDateTime)}</td>
                  <td className="px-4 py-3">{row.entryType || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{row.reference || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{row.relatedInvoiceNo || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3">{row.paymentMethod || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAud(row.debit)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">{formatAud(row.credit)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAud(row.balance)}</td>
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
        itemLabel="ledger entries"
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
