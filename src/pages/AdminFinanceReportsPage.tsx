import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, DollarSign } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { DatePicker } from '../components/ui/DatePicker';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { FinanceReportsSkeleton } from '../components/finance/FinanceReportsSkeleton';
import { FinanceReportsKpiCards } from '../components/finance/FinanceReportsKpiCards';
import { FinanceReportsCharts } from '../components/finance/FinanceReportsCharts';
import { FinanceReportsTable } from '../components/finance/FinanceReportsTable';
import {
  callAxcelerateFinanceReports,
  DEFAULT_FINANCE_FILTERS,
} from '../lib/financeReports';
import type {
  FinanceReportsCharts as ChartsData,
  FinanceReportsFilters,
  FinanceReportsSummary,
  FinanceReportRow,
  FinanceReportStatusFilter,
} from '../types/financeReports';

const STATUS_OPTIONS: { value: FinanceReportStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'partially_paid', label: 'Partially Paid' },
];

export const AdminFinanceReportsPage: React.FC = () => {
  const [filters, setFilters] = useState<FinanceReportsFilters>(DEFAULT_FINANCE_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FinanceReportsSummary | null>(null);
  const [rows, setRows] = useState<FinanceReportRow[]>([]);
  const [charts, setCharts] = useState<ChartsData | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await callAxcelerateFinanceReports(filters);
      if (!res.success) {
        setError(res.message);
        setSummary(null);
        setRows([]);
        setCharts(null);
        toast.error(res.message);
        return;
      }
      setSummary(res.summary);
      setRows(res.rows);
      setCharts(res.charts);
      if (opts?.silent) toast.success('Finance reports refreshed');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load finance reports';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, []);

  const courseOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.course?.trim()) set.add(r.course.trim());
    }
    return [{ value: '', label: 'All courses' }, ...[...set].sort().map((c) => ({ value: c, label: c }))];
  }, [rows]);

  const agentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.agent?.trim()) set.add(r.agent.trim());
    }
    return [{ value: '', label: 'All agents' }, ...[...set].sort().map((a) => ({ value: a, label: a }))];
  }, [rows]);

  const resetFilters = () => {
    setFilters(DEFAULT_FINANCE_FILTERS);
    void (async () => {
      setRefreshing(true);
      setError(null);
      const res = await callAxcelerateFinanceReports(DEFAULT_FINANCE_FILTERS);
      if (!res.success) {
        setError(res.message);
        toast.error(res.message);
      } else {
        setSummary(res.summary);
        setRows(res.rows);
        setCharts(res.charts);
        toast.success('Filters reset');
      }
      setRefreshing(false);
    })();
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 py-6 md:px-6 lg:px-8">
        {loading ? (
          <FinanceReportsSkeleton />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-7 w-7 text-[#ea580c]" />
                  <h1 className="text-2xl font-bold text-[var(--text)]">Finance Reports</h1>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-gray-600">
                  Track invoices, paid amount, pending balances, overdue fees, and export reports.
                </p>
              </div>
            </div>

            <Card>
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full min-w-0 sm:w-[11rem]">
                    <div className="mb-1 text-xs font-medium text-gray-600">Date from</div>
                    <DatePicker
                      value={filters.dateFrom}
                      onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v || '' }))}
                      compact
                      maxDate={filters.dateTo || undefined}
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-[11rem]">
                    <div className="mb-1 text-xs font-medium text-gray-600">Date to</div>
                    <DatePicker
                      value={filters.dateTo}
                      onChange={(v) => setFilters((f) => ({ ...f, dateTo: v || '' }))}
                      compact
                      minDate={filters.dateFrom || undefined}
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-[10rem] sm:flex-shrink-0">
                    <Select
                      label="Status"
                      value={filters.status}
                      onChange={(v) => setFilters((f) => ({ ...f, status: v as FinanceReportStatusFilter }))}
                      options={STATUS_OPTIONS}
                    />
                  </div>
                  <div className="w-full min-w-0 sm:max-w-[14rem] sm:flex-1">
                    <Input
                      label="Student search"
                      value={filters.studentSearch}
                      onChange={(e) => setFilters((f) => ({ ...f, studentSearch: e.target.value }))}
                      placeholder="Name, email, invoice no…"
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-[12rem]">
                    <Select
                      label="Course"
                      value={filters.course}
                      onChange={(v) => setFilters((f) => ({ ...f, course: v }))}
                      options={courseOptions}
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-[12rem]">
                    <Select
                      label="Agent"
                      value={filters.agent}
                      onChange={(v) => setFilters((f) => ({ ...f, agent: v }))}
                      options={agentOptions}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" onClick={resetFilters} disabled={refreshing}>
                    Reset filters
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void load({ silent: true })}
                    disabled={refreshing}
                    className="inline-flex items-center gap-2"
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                  <Button type="button" onClick={() => void load()} disabled={refreshing}>
                    Apply filters
                  </Button>
                </div>
              </div>
            </Card>

            {error ? (
              <Card className="border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-800">{error}</p>
                <p className="mt-1 text-xs text-red-700">
                  Check aXcelerate credentials on the Edge Function and try again.
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                  Retry
                </Button>
              </Card>
            ) : null}

            {summary && charts ? (
              <>
                <FinanceReportsKpiCards summary={summary} />
                <FinanceReportsCharts charts={charts} />
                <FinanceReportsTable rows={rows} />
              </>
            ) : !error ? (
              <div className="flex justify-center py-16">
                <Loader variant="dots" size="lg" message="Loading report data…" />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};
