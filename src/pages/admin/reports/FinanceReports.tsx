import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, DollarSign, CloudDownload } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { DatePicker } from '../../../components/ui/DatePicker';
import { Loader } from '../../../components/ui/Loader';
import { toast } from '../../../utils/toast';
import { FinanceReportsSkeleton } from '../../../components/finance/FinanceReportsSkeleton';
import { FinanceReportsKpiCards } from '../../../components/finance/FinanceReportsKpiCards';
import { FinanceReportsReconciliation } from '../../../components/finance/FinanceReportsReconciliation';
import { FinanceReportsCharts } from '../../../components/finance/FinanceReportsCharts';
import { FinanceReportsTable } from '../../../components/finance/FinanceReportsTable';
import {
  callAxcelerateFinanceReports,
  getDefaultFinanceFilters,
  syncAxcelerateFinance,
  toIsoDate,
  formatSyncTimestamp,
  markFinanceSyncInProgress,
  clearFinanceSyncInProgress,
  readFinanceSyncInProgress,
  isFinanceSyncMarkerStale,
  getFinanceSyncPollIntervalMs,
} from '../../../services/financeReports';
import type {
  FinanceReportsCharts as ChartsData,
  FinanceReportsDebug,
  FinanceReportsFilters,
  FinanceReportsSummary,
  FinanceReportRow,
  FinanceReportDateType,
  FinanceReportStatusFilter,
} from '../../../types/financeReports';

const STATUS_OPTIONS: { value: FinanceReportStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'void', label: 'Void' },
  { value: 'cancelled', label: 'Cancelled' },
];

const DATE_TYPE_OPTIONS: { value: FinanceReportDateType; label: string }[] = [
  { value: 'invoice_date', label: 'Invoice Date' },
  { value: 'due_date', label: 'Due Date' },
];

export const FinanceReportsPage: React.FC = () => {
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const syncRunRef = useRef(false);

  const [filters, setFilters] = useState<FinanceReportsFilters>(() => getDefaultFinanceFilters());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(() => {
    const marker = readFinanceSyncInProgress();
    return Boolean(marker && !isFinanceSyncMarkerStale(marker.startedAt));
  });
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<FinanceReportsSummary | null>(null);
  const [rows, setRows] = useState<FinanceReportRow[]>([]);
  const [charts, setCharts] = useState<ChartsData | null>(null);
  const [financeDebug, setFinanceDebug] = useState<FinanceReportsDebug | null>(null);
  const [noDataSynced, setNoDataSynced] = useState(false);

  const fetchReports = useCallback((activeFilters: FinanceReportsFilters) => {
    return callAxcelerateFinanceReports({
      dateFrom: toIsoDate(activeFilters.dateFrom),
      dateTo: toIsoDate(activeFilters.dateTo),
      dateType: activeFilters.dateType,
      status: activeFilters.status,
      studentSearch: activeFilters.studentSearch,
    });
  }, []);

  const applyReportResult = useCallback((res: Awaited<ReturnType<typeof fetchReports>>) => {
    if (!res.success) {
      setError(res.message);
      setSummary(null);
      setRows([]);
      setCharts(null);
      setFinanceDebug(null);
      setNoDataSynced(false);
      return false;
    }
    setSummary(res.summary);
    setRows(res.rows);
    setCharts(res.charts);
    setFinanceDebug(res.debug ?? null);
    setNoDataSynced((res.debug?.rawCount ?? 0) === 0);
    setError(null);
    return true;
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean; filtersOverride?: FinanceReportsFilters }) => {
      const activeFilters = opts?.filtersOverride ?? filters;
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await fetchReports(activeFilters);
        if (!applyReportResult(res)) {
          toast.error(res.success ? 'Failed to load reports' : res.message);
          return;
        }
        if (opts?.silent) toast.success('Finance reports refreshed');
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load finance reports';
        setError(msg);
        toast.error(msg);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters, fetchReports, applyReportResult]
  );

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!syncing) return;
    const marker = readFinanceSyncInProgress();
    if (!marker || isFinanceSyncMarkerStale(marker.startedAt)) {
      clearFinanceSyncInProgress();
      setSyncing(false);
      return;
    }

    const poll = async () => {
      if (syncRunRef.current) return;
      const res = await fetchReports(filters);
      if (!res.success || !res.debug?.lastSyncedAt) return;
      const syncedAt = new Date(res.debug.lastSyncedAt).getTime();
      if (syncedAt >= marker.startedAt) {
        applyReportResult(res);
        clearFinanceSyncInProgress();
        setSyncing(false);
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), getFinanceSyncPollIntervalMs());
    return () => window.clearInterval(id);
  }, [syncing, filters, fetchReports, applyReportResult]);

  const resetFilters = () => {
    const defaults = getDefaultFinanceFilters();
    setFilters(defaults);
    void (async () => {
      setRefreshing(true);
      const res = await fetchReports(defaults);
      if (!applyReportResult(res)) toast.error(res.success ? 'Failed to load reports' : res.message);
      else toast.success('Filters reset');
      setRefreshing(false);
    })();
  };

  const handleSyncNow = async () => {
    if (!isSuperadmin) return;
    markFinanceSyncInProgress();
    setSyncing(true);
    setError(null);
    syncRunRef.current = true;
    setSyncProgress(null);
    try {
      const syncRes = await syncAxcelerateFinance(undefined, (p) => setSyncProgress(p));
      if (!syncRes.success) {
        toast.error(syncRes.message);
        setError(syncRes.message);
        clearFinanceSyncInProgress();
        setSyncing(false);
        return;
      }
      const errCount = syncRes.errors?.length ?? 0;
      toast.success(
        `Synced ${syncRes.insertedOrUpdated} invoice${syncRes.insertedOrUpdated !== 1 ? 's' : ''} from ${syncRes.syncedContacts} contact${syncRes.syncedContacts !== 1 ? 's' : ''}.${errCount ? ` ${errCount} warning(s).` : ''}`
      );
      if (errCount > 0) console.warn('Finance sync warnings', syncRes.errors);
      await load({ silent: true });
      clearFinanceSyncInProgress();
      setSyncing(false);
      setSyncProgress(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sync failed';
      setError(msg);
      toast.error(msg);
      clearFinanceSyncInProgress();
      setSyncing(false);
      setSyncProgress(null);
    } finally {
      syncRunRef.current = false;
    }
  };

  const lastSyncedLabel = formatSyncTimestamp(financeDebug?.lastSyncedAt);
  const dateHelperText =
    filters.dateType === 'due_date'
      ? 'Filtering by due date. Leave dates blank to include all synced invoices.'
      : 'Filtering by invoice date. Leave dates blank to include all synced invoices.';

  const syncButtonLabel =
    syncing && syncProgress && syncProgress.total > 0
      ? `Syncing… (${syncProgress.processed}/${syncProgress.total})`
      : syncing
        ? 'Syncing…'
        : 'Sync Now';

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
                  Reports load from synced Supabase data.
                  {isSuperadmin
                    ? ' Use Sync Now for an immediate pull from aXcelerate; otherwise data refreshes automatically each morning.'
                    : ' Invoice data is refreshed automatically each morning (Australia/Melbourne).'}
                </p>
                <p className="mt-1 text-xs text-gray-500">Last sync: {lastSyncedLabel}</p>
              </div>
              {isSuperadmin ? (
                <Button
                  type="button"
                  onClick={() => void handleSyncNow()}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 shrink-0"
                  aria-busy={syncing}
                >
                  <CloudDownload className={`h-4 w-4 ${syncing ? 'animate-pulse' : ''}`} />
                  {syncButtonLabel}
                </Button>
              ) : null}
            </div>

            <Card>
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-full min-w-0 sm:w-[11rem]">
                    <Select
                      label="Date type"
                      value={filters.dateType}
                      onChange={(v) => setFilters((f) => ({ ...f, dateType: v as FinanceReportDateType }))}
                      options={DATE_TYPE_OPTIONS}
                    />
                  </div>
                  <div className="w-full min-w-0 sm:w-auto">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="w-full min-w-0 sm:w-[11rem]">
                        <div className="mb-1 text-xs font-medium text-gray-600">Date from</div>
                        <DatePicker
                          value={filters.dateFrom}
                          onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v || '' }))}
                          compact
                          maxDate={filters.dateTo || undefined}
                          placeholder="Optional"
                        />
                      </div>
                      <div className="w-full min-w-0 sm:w-[11rem]">
                        <div className="mb-1 text-xs font-medium text-gray-600">Date to</div>
                        <DatePicker
                          value={filters.dateTo}
                          onChange={(v) => setFilters((f) => ({ ...f, dateTo: v || '' }))}
                          compact
                          minDate={filters.dateFrom || undefined}
                          placeholder="Optional"
                        />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-gray-500">{dateHelperText}</p>
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
                  Check Edge Function secrets and try Sync Now if no data has been loaded yet.
                </p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                  Retry
                </Button>
              </Card>
            ) : null}

            {noDataSynced && !error ? (
              <Card className="border-amber-200 bg-amber-50 p-6 text-center">
                <p className="text-sm font-medium text-amber-900">
                  {isSuperadmin
                    ? 'No synced invoice data found. Click Sync Now to pull invoices from aXcelerate.'
                    : 'No synced invoice data yet. Data will appear after the next scheduled morning sync or when a superadmin runs Sync Now.'}
                </p>
                {isSuperadmin ? (
                  <Button type="button" className="mt-4" onClick={() => void handleSyncNow()} disabled={syncing} aria-busy={syncing}>
                    {syncButtonLabel}
                  </Button>
                ) : null}
              </Card>
            ) : null}

            {summary && charts && !noDataSynced ? (
              <>
                <FinanceReportsKpiCards summary={summary} />
                <FinanceReportsReconciliation summary={summary} />
                <FinanceReportsCharts charts={charts} />
                <FinanceReportsTable rows={rows} />
              </>
            ) : !error && !noDataSynced ? (
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
