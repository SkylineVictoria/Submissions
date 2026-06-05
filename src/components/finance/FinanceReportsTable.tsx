import React, { useMemo, useState } from 'react';
import { Download, Mail } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AdminListPagination } from '../admin/AdminListPagination';
import { SortableTh } from '../admin/SortableTh';
import type { SortDirection } from '../admin/SortableTh';
import { formatAud, formatFinanceDate, formatPaymentDateTime, exportFinanceRowsToCsv } from '../../services/financeReports';
import type { FinanceReportRow } from '../../types/financeReports';
import { toast } from '../../utils/toast';

type SortKey =
  | 'studentName'
  | 'email'
  | 'invoiceNo'
  | 'invoiceDate'
  | 'dueDate'
  | 'lastPaymentDate'
  | 'paymentMethod'
  | 'invoiceAmount'
  | 'paidAmount'
  | 'balance'
  | 'status';

type Props = {
  rows: FinanceReportRow[];
};

const PAGE_SIZE = 20;

const statusClass: Record<string, string> = {
  Paid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Pending: 'bg-amber-50 text-amber-800 border-amber-200',
  'Partially Paid': 'bg-amber-50 text-amber-800 border-amber-200',
  Void: 'bg-gray-100 text-gray-700 border-gray-200',
  Cancelled: 'bg-red-50 text-red-800 border-red-200',
};

export const FinanceReportsTable: React.FC<Props> = ({ rows }) => {
  const [tableSearch, setTableSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDirection }>({ key: 'invoiceDate', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const filtered = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) => {
        const hay = `${r.studentName} ${r.email} ${r.invoiceNo} ${r.status}`.toLowerCase();
        return hay.includes(q);
      });
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const key = sort.key;
      const av = a[key];
      const bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, tableSearch, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
    setPage(1);
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllPage = () => {
    const ids = pageRows.map((r) => r.invoiceId || r.invoiceNo);
    const allOnPage = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOnPage) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const exportCsv = () => {
    const toExport = selected.size > 0 ? filtered.filter((r) => selected.has(r.invoiceId || r.invoiceNo)) : filtered;
    if (toExport.length === 0) {
      toast.error('No rows to export');
      return;
    }
    exportFinanceRowsToCsv(toExport);
    toast.success(`Exported ${toExport.length} row${toExport.length !== 1 ? 's' : ''}`);
  };

  const sendReminder = () => {
    const count = selected.size || filtered.length;
    toast.info(`Send Reminder (${count} invoice${count !== 1 ? 's' : ''}) — coming soon. reminder_logs table not wired yet.`);
  };

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="text-lg font-bold text-[var(--text)]">Invoice directory</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={sendReminder} disabled={filtered.length === 0}>
            <Mail className="mr-1.5 h-4 w-4" />
            Send Reminder
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <Input
          value={tableSearch}
          onChange={(e) => {
            setTableSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search table…"
          className="max-w-md"
        />
      </div>

      <AdminListPagination
        placement="top"
        totalItems={filtered.length}
        pageSize={PAGE_SIZE}
        currentPage={page}
        totalPages={totalPages}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        onGoToPage={setPage}
        itemLabel="invoices"
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="py-3 pr-2 w-10">
                <input
                  type="checkbox"
                  checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.invoiceId || r.invoiceNo))}
                  onChange={toggleAllPage}
                  aria-label="Select all on page"
                />
              </th>
              <SortableTh label="Student Name" className="py-3 pr-3" active={sort.key === 'studentName'} direction={sort.dir} onToggle={() => toggleSort('studentName')} />
              <SortableTh label="Email" className="py-3 pr-3" active={sort.key === 'email'} direction={sort.dir} onToggle={() => toggleSort('email')} />
              <SortableTh label="Invoice No" className="py-3 pr-3" active={sort.key === 'invoiceNo'} direction={sort.dir} onToggle={() => toggleSort('invoiceNo')} />
              <SortableTh label="Invoice Date" className="py-3 pr-3" active={sort.key === 'invoiceDate'} direction={sort.dir} onToggle={() => toggleSort('invoiceDate')} />
              <SortableTh label="Due Date" className="py-3 pr-3" active={sort.key === 'dueDate'} direction={sort.dir} onToggle={() => toggleSort('dueDate')} />
              <SortableTh label="Payment Date" className="py-3 pr-3" active={sort.key === 'lastPaymentDate'} direction={sort.dir} onToggle={() => toggleSort('lastPaymentDate')} />
              <SortableTh label="Payment Method" className="py-3 pr-3" active={sort.key === 'paymentMethod'} direction={sort.dir} onToggle={() => toggleSort('paymentMethod')} />
              <SortableTh label="Invoice Amount" className="py-3 pr-3 text-right" active={sort.key === 'invoiceAmount'} direction={sort.dir} onToggle={() => toggleSort('invoiceAmount')} />
              <SortableTh label="Paid Amount" className="py-3 pr-3 text-right" active={sort.key === 'paidAmount'} direction={sort.dir} onToggle={() => toggleSort('paidAmount')} />
              <SortableTh label="Balance" className="py-3 pr-3 text-right" active={sort.key === 'balance'} direction={sort.dir} onToggle={() => toggleSort('balance')} />
              <SortableTh label="Status" className="py-3 pr-3" active={sort.key === 'status'} direction={sort.dir} onToggle={() => toggleSort('status')} />
              <th className="py-3 text-right font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="py-10 text-center text-gray-500">
                  No invoices match your filters.
                </td>
              </tr>
            ) : (
              pageRows.map((row) => {
                const id = row.invoiceId || row.invoiceNo;
                return (
                  <tr key={id} className="border-b border-gray-100 hover:bg-[var(--brand)]/5">
                    <td className="py-3 pr-2">
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggleRow(id)}
                        aria-label={`Select ${row.invoiceNo}`}
                      />
                    </td>
                    <td className="py-3 pr-3 font-medium text-gray-900">{row.studentName || '—'}</td>
                    <td className="py-3 pr-3 text-gray-600">{row.email || '—'}</td>
                    <td className="py-3 pr-3 font-mono text-xs">{row.invoiceNo || '—'}</td>
                    <td className="py-3 pr-3 text-gray-700">{formatFinanceDate(row.invoiceDate)}</td>
                    <td className="py-3 pr-3 text-gray-700">{formatFinanceDate(row.dueDate)}</td>
                    <td className="py-3 pr-3 text-gray-700">
                      {row.status === 'Paid' || row.paidAmount > 0
                        ? formatPaymentDateTime(row.lastPaymentDate)
                        : '—'}
                    </td>
                    <td className="py-3 pr-3 text-gray-700">{row.paymentMethod || '—'}</td>
                    <td className="py-3 pr-3 text-right tabular-nums">{formatAud(row.invoiceAmount)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums text-emerald-700">{formatAud(row.paidAmount)}</td>
                    <td className="py-3 pr-3 text-right tabular-nums font-medium">{formatAud(row.balance)}</td>
                    <td className="py-3 pr-3">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${statusClass[row.status] ?? ''}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => toast.info(`Reminder for ${row.invoiceNo} — coming soon`)}
                      >
                        Remind
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <AdminListPagination
        placement="bottom"
        totalItems={filtered.length}
        pageSize={PAGE_SIZE}
        currentPage={page}
        totalPages={totalPages}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
        onGoToPage={setPage}
        itemLabel="invoices"
      />
    </Card>
  );
};
