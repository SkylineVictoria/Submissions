import React, { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { LayoutDashboard, RefreshCw, Users, UserRoundCheck, ClipboardCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { DatePicker } from '../components/ui/DatePicker';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { getAdminDashboardStats, type AdminDashboardStats } from '../lib/formEngine';

const ZONE = 'Australia/Melbourne';

type TimePreset = 'today' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'custom';
type StatusFilter = 'all' | 'awaiting_student' | 'awaiting_trainer' | 'awaiting_office' | 'completed';
type BreakdownView = 'students' | 'trainers';

function melbourneStartEndForPreset(preset: TimePreset, customFrom?: string, customTo?: string): { startAt: string | null; endAt: string | null } {
  const now = DateTime.now().setZone(ZONE);
  const toUtcIso = (dt: DateTime) => dt.toUTC().toISO();
  if (preset === 'custom') {
    if (!customFrom || !customTo) return { startAt: null, endAt: null };
    const start = DateTime.fromISO(customFrom, { zone: ZONE }).startOf('day');
    const end = DateTime.fromISO(customTo, { zone: ZONE }).endOf('day');
    if (!start.isValid || !end.isValid) return { startAt: null, endAt: null };
    return { startAt: toUtcIso(start), endAt: toUtcIso(end) };
  }
  if (preset === 'today') return { startAt: toUtcIso(now.startOf('day')), endAt: toUtcIso(now.endOf('day')) };
  if (preset === 'this_week') return { startAt: toUtcIso(now.startOf('week')), endAt: toUtcIso(now.endOf('day')) };
  if (preset === 'last_week') {
    const last = now.minus({ weeks: 1 });
    return { startAt: toUtcIso(last.startOf('week')), endAt: toUtcIso(last.endOf('week')) };
  }
  if (preset === 'this_month') return { startAt: toUtcIso(now.startOf('month')), endAt: toUtcIso(now.endOf('day')) };
  if (preset === 'last_month') {
    const last = now.minus({ months: 1 });
    return { startAt: toUtcIso(last.startOf('month')), endAt: toUtcIso(last.endOf('month')) };
  }
  return { startAt: null, endAt: null };
}

function Donut({
  value,
  total,
  label,
  color,
}: {
  value: number;
  total: number;
  label: string;
  color: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const gap = c - dash;
  return (
    <div className="flex items-center gap-3">
      <svg width="84" height="84" viewBox="0 0 84 84" className="shrink-0">
        <circle cx="42" cy="42" r={r} fill="none" stroke="#e5e7eb" strokeWidth="10" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform="rotate(-90 42 42)"
        />
        <text x="42" y="46" textAnchor="middle" className="fill-gray-900" style={{ fontSize: 14, fontWeight: 700 }}>
          {Math.round(pct)}%
        </text>
      </svg>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{label}</div>
        <div className="text-xs text-gray-600">
          <strong className="text-gray-900">{value}</strong> of <strong className="text-gray-900">{total}</strong>
        </div>
      </div>
    </div>
  );
}

export const AdminDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);

  const [timePreset, setTimePreset] = useState<TimePreset>('this_week');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [breakdownView, setBreakdownView] = useState<BreakdownView>('students');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  const range = useMemo(() => melbourneStartEndForPreset(timePreset, customFrom, customTo), [timePreset, customFrom, customTo]);

  const load = async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    const res = await getAdminDashboardStats({ startAt: range.startAt, endAt: range.endAt, status });
    if (!res.ok) {
      toast.error(res.error);
      setStats(null);
      setLoading(false);
      return;
    }
    setStats(res.stats);
    setLoading(false);
  };

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.startAt, range.endAt, status]);

  const totalInRange = useMemo(() => {
    if (!stats) return 0;
    const w = stats.workflow;
    return (w.awaiting_student ?? 0) + (w.awaiting_trainer ?? 0) + (w.awaiting_office ?? 0) + (w.completed ?? 0);
  }, [stats]);

  if (loading) return <Loader fullPage variant="dots" size="lg" message="Loading dashboard…" />;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <div className="mb-6 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
              <LayoutDashboard className="w-7 h-7 text-[var(--brand)]" />
              Admin dashboard
            </h1>
            <p className="text-sm text-gray-600 mt-1">Overview of assessments workflow, students, and trainers.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-56">
              <Select
                label="Time"
                value={timePreset}
                onChange={(v) => setTimePreset(v as TimePreset)}
                options={[
                  { value: 'today', label: 'Today' },
                  { value: 'this_week', label: 'This week' },
                  { value: 'last_week', label: 'Last week' },
                  { value: 'this_month', label: 'This month' },
                  { value: 'last_month', label: 'Last month' },
                  { value: 'custom', label: 'Custom range' },
                ]}
              />
            </div>
            <div className="w-full sm:w-56">
              <Select
                label="Status"
                value={status}
                onChange={(v) => setStatus(v as StatusFilter)}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'awaiting_student', label: 'Awaiting student' },
                  { value: 'awaiting_trainer', label: 'Awaiting trainer' },
                  { value: 'awaiting_office', label: 'Awaiting office' },
                  { value: 'completed', label: 'Completed' },
                ]}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setRefreshing(true);
                await load({ silent: true });
                setRefreshing(false);
                toast.success('Dashboard refreshed');
              }}
              disabled={refreshing}
              className="h-12"
              title="Refresh"
            >
              <span className="inline-flex items-center gap-2">
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </span>
            </Button>
          </div>
        </div>

        {timePreset === 'custom' ? (
          <Card className="mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DatePicker label="From (Melbourne)" value={customFrom} onChange={setCustomFrom} placement="below" />
              <DatePicker label="To (Melbourne)" value={customTo} onChange={setCustomTo} placement="below" />
            </div>
            <p className="text-xs text-gray-500 mt-3">
              Uses Melbourne dates (AEST/AEDT) and filters by assessment <strong>created time</strong>.
            </p>
          </Card>
        ) : null}

        {/* Totals */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <button
            type="button"
            className="text-left"
            onClick={() => navigate('/admin/assessments')}
            title="Go to assessments"
          >
            <Card className="bg-gradient-to-br from-[var(--brand)] to-[#ea580c] text-white overflow-hidden relative hover:opacity-[0.97]">
              <div className="absolute top-0 right-0 w-24 h-24 -mt-4 -mr-4 rounded-full bg-white/10" />
              <div className="relative">
                <p className="text-white/90 text-sm font-medium">Total assessments</p>
                <p className="text-4xl font-bold mt-1">{stats?.totals.assessments ?? 0}</p>
                <p className="text-white/80 text-xs mt-1">All time</p>
              </div>
            </Card>
          </button>

          <button type="button" className="text-left" onClick={() => navigate('/admin/students')} title="Go to students">
            <Card className="hover:bg-gray-50/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Students</p>
                  <p className="text-3xl font-bold text-[var(--text)] mt-1">{stats?.totals.students ?? 0}</p>
                  <p className="text-gray-500 text-xs mt-1">Active records</p>
                </div>
                <Users className="w-10 h-10 text-gray-300" />
              </div>
            </Card>
          </button>

          <button type="button" className="text-left" onClick={() => navigate('/admin/users')} title="Go to users (trainers)">
            <Card className="hover:bg-gray-50/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Trainers</p>
                  <p className="text-3xl font-bold text-[var(--text)] mt-1">{stats?.totals.trainers ?? 0}</p>
                  <p className="text-gray-500 text-xs mt-1">Users with trainer role</p>
                </div>
                <UserRoundCheck className="w-10 h-10 text-gray-300" />
              </div>
            </Card>
          </button>

          <button type="button" className="text-left" onClick={() => navigate('/admin/users')} title="Go to users (admins)">
            <Card className="hover:bg-gray-50/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-gray-600 text-sm font-medium">Admins</p>
                  <p className="text-3xl font-bold text-[var(--text)] mt-1">{stats?.totals.admins ?? 0}</p>
                  <p className="text-gray-500 text-xs mt-1">Users with admin or super admin role</p>
                </div>
                <ClipboardCheck className="w-10 h-10 text-gray-300" />
              </div>
            </Card>
          </button>
        </div>

        {/* Workflow donuts */}
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Workflow (filtered)</h2>
              <p className="text-xs text-gray-500 mt-1">Awaiting student = draft, awaiting trainer/office = role stage, completed = locked.</p>
            </div>
            <div className="text-xs text-gray-600">
              Total in range: <strong className="text-gray-900">{totalInRange}</strong>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card className="border border-gray-100" padding="sm">
              <Donut value={stats?.workflow.awaiting_student ?? 0} total={totalInRange} label="Awaiting student" color="#64748b" />
            </Card>
            <Card className="border border-gray-100" padding="sm">
              <Donut value={stats?.workflow.awaiting_trainer ?? 0} total={totalInRange} label="Awaiting trainer" color="#f59e0b" />
            </Card>
            <Card className="border border-gray-100" padding="sm">
              <Donut value={stats?.workflow.awaiting_office ?? 0} total={totalInRange} label="Awaiting office" color="#3b82f6" />
            </Card>
            <Card className="border border-gray-100" padding="sm">
              <Donut value={stats?.workflow.completed ?? 0} total={totalInRange} label="Completed" color="#10b981" />
            </Card>
          </div>
        </Card>

        {/* Breakdown */}
        <Card>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Pending breakdown</h2>
              <p className="text-xs text-gray-500 mt-1">Top 10 by count within the selected filters.</p>
            </div>
            <div className="w-full md:w-64">
              <Select
                label="Users"
                value={breakdownView}
                onChange={(v) => setBreakdownView(v as BreakdownView)}
                options={[
                  { value: 'students', label: 'Students' },
                  { value: 'trainers', label: 'Trainers' },
                ]}
              />
            </div>
          </div>

          {(() => {
            const studentRows = stats?.top_pending_by_student ?? [];
            const trainerRows = stats?.top_pending_by_trainer ?? [];
            const empty = breakdownView === 'students' ? studentRows.length === 0 : trainerRows.length === 0;
            return (
              <>
                <div className="space-y-3 lg:hidden">
                  {empty ? (
                    <div className="rounded-lg border border-dashed border-gray-200 py-10 text-center text-sm text-gray-500">No rows for this filter.</div>
                  ) : breakdownView === 'students' ? (
                    studentRows.map((r) => (
                      <div key={r.student_id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Pending</span>
                          <span className="text-2xl font-bold tabular-nums text-gray-900">{r.pending_count}</span>
                        </div>
                        <div className="mt-2 text-sm font-semibold text-gray-900 break-words">{r.student_name || '—'}</div>
                        <div className="mt-1 text-xs text-gray-600 break-all">{r.student_email || '—'}</div>
                      </div>
                    ))
                  ) : (
                    trainerRows.map((r) => (
                      <div key={r.trainer_id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Pending</span>
                          <span className="text-2xl font-bold tabular-nums text-gray-900">{r.pending_count}</span>
                        </div>
                        <div className="mt-2 text-sm font-semibold text-gray-900 break-words">{r.trainer_name || '—'}</div>
                        <div className="mt-1 text-xs text-gray-600 break-all">{r.trainer_email || '—'}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="hidden overflow-x-auto lg:block">
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <table className="w-full min-w-[520px] text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                          <th className="py-2.5 px-3 font-semibold text-gray-800 whitespace-nowrap w-[4.5rem]">Count</th>
                          <th className="py-2.5 px-3 font-semibold text-gray-800 min-w-[8rem]">Name</th>
                          <th className="py-2.5 px-3 font-semibold text-gray-800 min-w-[12rem]">Email</th>
                        </tr>
                      </thead>
                      <tbody>
                        {breakdownView === 'students'
                          ? studentRows.map((r) => (
                              <tr key={r.student_id} className="border-b border-gray-100 hover:bg-gray-50/70">
                                <td className="py-2.5 px-3 text-gray-900 font-semibold tabular-nums align-top">{r.pending_count}</td>
                                <td className="py-2.5 px-3 text-gray-900 break-words min-w-0 max-w-[14rem]" title={r.student_name}>
                                  {r.student_name || '—'}
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 break-all min-w-0">{r.student_email || '—'}</td>
                              </tr>
                            ))
                          : trainerRows.map((r) => (
                              <tr key={r.trainer_id} className="border-b border-gray-100 hover:bg-gray-50/70">
                                <td className="py-2.5 px-3 text-gray-900 font-semibold tabular-nums align-top">{r.pending_count}</td>
                                <td className="py-2.5 px-3 text-gray-900 break-words min-w-0 max-w-[14rem]" title={r.trainer_name}>
                                  {r.trainer_name || '—'}
                                </td>
                                <td className="py-2.5 px-3 text-gray-700 break-all min-w-0">{r.trainer_email || '—'}</td>
                              </tr>
                            ))}
                        {empty ? (
                          <tr>
                            <td className="py-10 px-3 text-center text-gray-500 text-sm" colSpan={3}>
                              No rows for this filter.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboardPage;

