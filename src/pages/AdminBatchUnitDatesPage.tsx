import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarRange, User } from 'lucide-react';
import {
  getBatchById,
  fetchBatchAssessmentOptions,
  listStudentsInBatch,
  getInstanceForStudentAndForm,
  createFormInstance,
  updateFormInstanceDates,
  extendInstanceAccessTokensToDate,
} from '../lib/formEngine';
import type { Batch, Student } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DatePicker } from '../components/ui/DatePicker';
import { Select } from '../components/ui/Select';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

const getTodayIso = () => new Date().toISOString().slice(0, 10);
const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());

const STUDENT_PAGE_SIZE = 25;

export const AdminBatchUnitDatesPage: React.FC = () => {
  const { batchId: batchIdParam } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const batchId = Number(batchIdParam);

  const [batch, setBatch] = useState<Batch | null>(null);
  const [batchStudents, setBatchStudents] = useState<Student[]>([]);
  const [loadingBatch, setLoadingBatch] = useState(true);

  const [fromDate, setFromDate] = useState(() => getTodayIso());
  const [toDate, setToDate] = useState(() => getTodayIso());
  /** Narrow the student list to one unit; '' = all units matching the date filter. */
  const [unitFilterId, setUnitFilterId] = useState('');
  /** When To is empty: if true, only no-end-date + start = From; if false (default), "active on" From. */
  const [openNullEndExact, setOpenNullEndExact] = useState(false);

  const [unitLoading, setUnitLoading] = useState(false);
  const [unitEligibilityReady, setUnitEligibilityReady] = useState(false);
  /** One page of student rows from the RPC (labels); full id list is `eligibleStudentIds`. */
  const [eligibleStudentOptions, setEligibleStudentOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [eligibleUnitOptions, setEligibleUnitOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [eligibleStudentUnits, setEligibleStudentUnits] = useState<Record<string, number[]>>({});
  const [studentsTotalCount, setStudentsTotalCount] = useState(0);
  const [eligibleStudentIds, setEligibleStudentIds] = useState<number[]>([]);
  const lastAssessmentFilterKeyRef = useRef<string>('');

  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<number[]>([]);
  const [massStart, setMassStart] = useState('');
  const [massEnd, setMassEnd] = useState('');
  const [saving, setSaving] = useState(false);
  /** 1-based page index for the student table (25 per page). */
  const [studentPage, setStudentPage] = useState(1);

  const courseId =
    batch?.course_id != null && Number.isFinite(Number(batch.course_id)) ? Number(batch.course_id) : 0;

  const startOnlyMode = Boolean(isIsoDate(fromDate) && !String(toDate || '').trim());

  const unitIdToName = useMemo(() => {
    const m = new Map<number, string>();
    for (const u of eligibleUnitOptions) m.set(Number(u.id), u.name);
    return m;
  }, [eligibleUnitOptions]);

  /** Units shown in "Units to update" — same as filter dropdown when a specific unit is selected. */
  const unitsForMassEditGrid = useMemo(() => {
    if (!unitFilterId.trim()) return eligibleUnitOptions;
    const fid = Number(unitFilterId);
    if (!Number.isFinite(fid)) return eligibleUnitOptions;
    return eligibleUnitOptions.filter((u) => Number(u.id) === fid);
  }, [eligibleUnitOptions, unitFilterId]);

  const studentTotalPages = Math.max(1, Math.ceil(studentsTotalCount / STUDENT_PAGE_SIZE));

  useEffect(() => {
    setStudentPage(1);
  }, [fromDate, toDate, unitFilterId, openNullEndExact]);

  useEffect(() => {
    setStudentPage((p) => Math.min(Math.max(1, p), studentTotalPages));
  }, [studentTotalPages]);

  useEffect(() => {
    setUnitFilterId('');
  }, [fromDate, toDate]);

  useEffect(() => {
    if (!unitFilterId) return;
    const ok = eligibleUnitOptions.some((u) => String(u.id) === unitFilterId);
    if (!ok) setUnitFilterId('');
  }, [eligibleUnitOptions, unitFilterId]);

  const loadBatch = useCallback(async () => {
    if (!Number.isFinite(batchId) || batchId <= 0) {
      setBatch(null);
      setLoadingBatch(false);
      return;
    }
    setLoadingBatch(true);
    const b = await getBatchById(batchId);
    setBatch(b);
    if (b) {
      const students = await listStudentsInBatch(batchId);
      setBatchStudents(students);
    } else {
      setBatchStudents([]);
    }
    setLoadingBatch(false);
  }, [batchId]);

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!batch || !courseId || courseId <= 0) {
        setUnitEligibilityReady(false);
        setEligibleStudentOptions([]);
        setEligibleUnitOptions([]);
        setEligibleStudentUnits({});
        setStudentsTotalCount(0);
        setEligibleStudentIds([]);
        lastAssessmentFilterKeyRef.current = '';
        return;
      }
      const from = String(fromDate || '').trim();
      const to = String(toDate || '').trim();

      if (!isIsoDate(from)) {
        setUnitEligibilityReady(true);
        setEligibleStudentOptions([]);
        setEligibleUnitOptions([]);
        setEligibleStudentUnits({});
        setStudentsTotalCount(0);
        setEligibleStudentIds([]);
        lastAssessmentFilterKeyRef.current = '';
        return;
      }

      const useStartOnly = !to.trim();
      if (!useStartOnly) {
        if (!isIsoDate(to) || to < from) {
          setUnitEligibilityReady(true);
          setEligibleStudentOptions([]);
          setEligibleUnitOptions([]);
          setEligibleStudentUnits({});
          setStudentsTotalCount(0);
          setEligibleStudentIds([]);
          lastAssessmentFilterKeyRef.current = '';
          return;
        }
      }

      const filterKey = `${batch.id}|${courseId}|${from}|${to}|${useStartOnly ? 1 : 0}|${openNullEndExact ? 1 : 0}|${unitFilterId.trim()}`;
      const pageOnlyFetch =
        lastAssessmentFilterKeyRef.current === filterKey && lastAssessmentFilterKeyRef.current !== '';

      if (!pageOnlyFetch) {
        setUnitEligibilityReady(false);
        setUnitLoading(true);
      }
      try {
        const fid = unitFilterId.trim() ? Number(unitFilterId) : NaN;
        const formId = Number.isFinite(fid) && fid > 0 ? fid : null;
        // When filters (not page) changed, always request page 1 — studentPage state may still be stale this tick.
        const effectivePage = pageOnlyFetch ? studentPage : 1;
        const payload = await fetchBatchAssessmentOptions(
          batch.id,
          courseId,
          from,
          useStartOnly ? from : to,
          useStartOnly,
          openNullEndExact,
          { page: effectivePage, pageSize: STUDENT_PAGE_SIZE, formId }
        );
        if (cancelled) return;
        lastAssessmentFilterKeyRef.current = filterKey;
        if (!payload) {
          setEligibleStudentOptions([]);
          setEligibleUnitOptions([]);
          setEligibleStudentUnits({});
          setStudentsTotalCount(0);
          setEligibleStudentIds([]);
          setUnitEligibilityReady(true);
          return;
        }
        setEligibleStudentOptions(payload.students);
        setEligibleUnitOptions(payload.units);
        setEligibleStudentUnits(payload.student_units);
        setStudentsTotalCount(payload.studentsTotal);
        setEligibleStudentIds(payload.eligibleStudentIds);
        setUnitEligibilityReady(true);
      } finally {
        if (!cancelled) setUnitLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [batch, courseId, fromDate, toDate, openNullEndExact, unitFilterId, studentPage]);

  useEffect(() => {
    if (!unitEligibilityReady) return;
    if (unitFilterId.trim()) {
      const fid = Number(unitFilterId);
      const valid = eligibleUnitOptions.some((u) => Number(u.id) === fid);
      if (!valid) {
        setSelectedStudentIds([...eligibleStudentIds]);
        setSelectedUnitIds(eligibleUnitOptions.map((u) => Number(u.id)));
        return;
      }
      setSelectedStudentIds([...eligibleStudentIds]);
      setSelectedUnitIds([fid]);
      return;
    }
    setSelectedStudentIds([...eligibleStudentIds]);
    setSelectedUnitIds(eligibleUnitOptions.map((u) => Number(u.id)));
  }, [unitEligibilityReady, eligibleStudentIds, eligibleUnitOptions, unitFilterId]);

  const unitNamesForStudent = useCallback(
    (studentId: number): string => {
      const ids = eligibleStudentUnits[String(studentId)] || [];
      const names = ids.map((fid) => unitIdToName.get(Number(fid))).filter(Boolean);
      return names.length ? names.join(', ') : '—';
    },
    [eligibleStudentUnits, unitIdToName]
  );

  const unitCellLabel = useCallback(
    (studentId: number): string => {
      if (unitFilterId.trim()) {
        const fid = Number(unitFilterId);
        return unitIdToName.get(fid) || '—';
      }
      return unitNamesForStudent(studentId);
    },
    [unitFilterId, unitIdToName, unitNamesForStudent]
  );

  const toggleStudent = (id: number) => {
    setSelectedStudentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleUnit = (id: number) => {
    setSelectedUnitIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  /** Select every student on the current page (up to 25), merged with any already selected on other pages. */
  const selectAllStudentsOnPage = () => {
    const pageIds = eligibleStudentOptions.map((s) => Number(s.id));
    setSelectedStudentIds((prev) => Array.from(new Set([...prev, ...pageIds])));
  };

  const selectAllMatchingStudents = () => {
    setSelectedStudentIds([...eligibleStudentIds]);
  };

  const clearStudents = () => setSelectedStudentIds([]);

  const selectAllUnits = () => {
    if (unitFilterId.trim()) {
      const fid = Number(unitFilterId);
      if (Number.isFinite(fid)) setSelectedUnitIds([fid]);
      return;
    }
    setSelectedUnitIds(eligibleUnitOptions.map((u) => Number(u.id)));
  };

  const clearUnits = () => setSelectedUnitIds([]);

  const saveMassDates = useCallback(async () => {
    if (!batch || courseId <= 0) return;
    const sids = Array.from(new Set(selectedStudentIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)));
    const fids = Array.from(new Set(selectedUnitIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)));
    if (sids.length === 0) {
      toast.error('Select at least one student');
      return;
    }
    if (fids.length === 0) {
      toast.error('Select at least one unit');
      return;
    }
    const start = massStart?.trim() || null;
    const end = massEnd?.trim() || null;
    setSaving(true);
    try {
      let n = 0;
      for (const sid of sids) {
        const allowedForStudent = new Set(eligibleStudentUnits[String(sid)] || []);
        for (const fid of fids) {
          if (!allowedForStudent.has(fid)) continue;
          const existing = await getInstanceForStudentAndForm(fid, sid);
          if (existing?.id) {
            await updateFormInstanceDates(existing.id, { start_date: start, end_date: end });
            if (end) await extendInstanceAccessTokensToDate(existing.id, 'student', end);
          } else {
            const inst = await createFormInstance(fid, 'student', sid, { start_date: start, end_date: end });
            if (inst?.id && end) await extendInstanceAccessTokensToDate(inst.id, 'student', end);
          }
          n++;
        }
      }
      if (n === 0) {
        toast.info('No matching student–unit pairs for the current filter and selection.');
        return;
      }
      toast.success(`Updated ${n} assessment${n !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }, [batch, courseId, selectedStudentIds, selectedUnitIds, massStart, massEnd, eligibleStudentUnits]);

  if (!Number.isFinite(batchId) || batchId <= 0) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-4 py-6">
        <p className="text-sm text-gray-600">Invalid batch.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/admin/batches')}>
          Back to batches
        </Button>
      </div>
    );
  }

  if (loadingBatch) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center py-24">
        <Loader variant="dots" size="lg" message="Loading batch…" />
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-4 py-6">
        <p className="text-sm text-gray-600">Batch not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/admin/batches')}>
          Back to batches
        </Button>
      </div>
    );
  }

  if (!courseId) {
    return (
      <div className="min-h-screen bg-[var(--bg)] px-4 py-6">
        <Link to="/admin/batches" className="inline-flex items-center gap-1 text-sm text-[#ea580c] hover:underline mb-4">
          <ChevronLeft className="w-4 h-4" />
          Batches
        </Link>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This batch has no course assigned. Assign a course in batch settings first.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
        <div className="mb-6">
          <Link
            to="/admin/batches"
            className="inline-flex items-center gap-1 text-sm text-[#ea580c] hover:underline mb-3"
          >
            <ChevronLeft className="w-4 h-4" />
            Batches
          </Link>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-[var(--text)] flex items-center gap-2">
                <CalendarRange className="w-6 h-6 text-[#ea580c]" />
                Student unit dates
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                <span className="font-medium text-gray-800">{batch.name}</span>
                {batch.course_name ? (
                  <span className="text-gray-500"> · {batch.course_name}</span>
                ) : null}
              </p>
              <p className="text-xs text-gray-500 mt-2 max-w-2xl">
                Filter by assessment dates and optionally by unit, then review students below. Each row lists unit names
                that match the filter. Use the checkboxes to choose who receives the mass date update.
              </p>
            </div>
          </div>
        </div>

        <Card className="p-4 md:p-6 space-y-6">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Filters</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              <DatePicker label="From date" value={fromDate} onChange={(v) => setFromDate(v || '')} placement="below" />
              <DatePicker
                label="To date (optional)"
                value={toDate}
                onChange={(v) => setToDate(v || '')}
                placement="below"
              />
              <Select
                label="Unit"
                value={unitFilterId}
                onChange={setUnitFilterId}
                options={[
                  { value: '', label: 'All units' },
                  ...eligibleUnitOptions.map((u) => ({ value: String(u.id), label: u.name })),
                ]}
                disabled={!unitEligibilityReady || eligibleUnitOptions.length === 0}
                attachDropdown="trigger"
                searchable
                searchPlaceholder="Search by code or unit name…"
              />
            </div>
            {startOnlyMode ? (
              openNullEndExact ? (
                <p className="mt-2 text-xs text-gray-500">
                  <strong>Narrow mode:</strong> only assessments with <strong>no end date</strong> and{' '}
                  <strong>start exactly {fromDate}</strong>.
                </p>
              ) : (
                <p className="mt-2 text-xs text-gray-500">
                  With <strong>To</strong> empty, lists assessments <strong>active on {fromDate}</strong>:{' '}
                  <strong>start ≤ From ≤ end</strong>, or no end date yet (same idea as Assessment directory &quot;Active
                  on&quot;). Use both From and To for a full date window instead.
                </p>
              )
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                Matches when the assessment <strong>starts on {fromDate}</strong> (same day as Start in the directory){' '}
                and <strong>ends on or before {toDate}</strong> (end still on or after From). Use the same From
                as the unit&apos;s Start date in Assessment directory to see only that unit.
              </p>
            )}
            {startOnlyMode ? (
              <label className="mt-3 flex items-start gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-[#ea580c] focus:ring-[#ea580c] mt-0.5 shrink-0"
                  checked={openNullEndExact}
                  onChange={(e) => setOpenNullEndExact(e.target.checked)}
                />
                <span>
                  Restrict to <strong>open-ended only</strong> (no end date) with start <strong>exactly</strong> on From
                </span>
              </label>
            ) : null}
            <p className="mt-2 text-xs text-gray-500">
              The unit list uses the same rules as the student list. If it is empty, set <strong>From</strong> to the
              assessment start date you see in the directory, or use <strong>To</strong> empty for &quot;active on&quot;
              From instead.
            </p>
          </div>

          {unitLoading ? (
            <div className="py-8">
              <Loader variant="dots" size="md" message="Loading…" />
            </div>
          ) : (
            <>
              {unitEligibilityReady && studentsTotalCount === 0 ? (
                <div className="text-sm text-gray-500 rounded-lg border border-gray-200 bg-gray-50 px-4 py-6">
                  No students match the current filters (date range{unitFilterId.trim() ? ' and unit' : ''}).
                </div>
              ) : (
                <>
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div>
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Students</div>
                        {studentsTotalCount > STUDENT_PAGE_SIZE ? (
                          <p className="mt-0.5 text-xs text-gray-500">
                            {STUDENT_PAGE_SIZE} per page — use pagination below to review the rest.
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <button
                          type="button"
                          className="text-xs font-medium text-[#ea580c] hover:underline"
                          onClick={selectAllStudentsOnPage}
                        >
                          Select page
                        </button>
                        {studentsTotalCount > STUDENT_PAGE_SIZE ? (
                          <>
                            <span className="text-gray-300">|</span>
                            <button
                              type="button"
                              className="text-xs font-medium text-[#ea580c] hover:underline"
                              onClick={selectAllMatchingStudents}
                            >
                              Select all matching ({studentsTotalCount})
                            </button>
                          </>
                        ) : null}
                        <span className="text-gray-300">|</span>
                        <button
                          type="button"
                          className="text-xs font-medium text-gray-600 hover:underline"
                          onClick={clearStudents}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-white">
                      <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
                          <tr>
                            <th className="w-10 px-3 py-2.5">
                              <span className="sr-only">Include</span>
                            </th>
                            <th className="px-3 py-2.5 font-semibold">Student</th>
                            <th className="px-3 py-2.5 font-semibold min-w-[200px]">Units (matching filter)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {eligibleStudentOptions.map((s) => {
                            const sid = Number(s.id);
                            const checked = selectedStudentIds.includes(sid);
                            return (
                              <tr
                                key={sid}
                                className={`border-b border-gray-100 last:border-0 transition-colors ${
                                  checked ? 'bg-[#fff7ed]/50' : 'hover:bg-[var(--brand)]/10 focus-within:bg-[var(--brand)]/10'
                                }`}
                              >
                                <td className="px-3 py-2.5 align-top">
                                  <input
                                    type="checkbox"
                                    className="rounded border-gray-300 text-[#ea580c] focus:ring-[#ea580c]"
                                    checked={checked}
                                    onChange={() => toggleStudent(sid)}
                                    aria-label={`Include ${s.label}`}
                                  />
                                </td>
                                <td className="px-3 py-2.5 align-top">
                                  <div className="flex items-start gap-2">
                                    <User className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                                    <span className="font-medium text-gray-900">{s.label}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5 align-top text-gray-700 text-xs sm:text-sm leading-relaxed">
                                  {unitCellLabel(sid)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {studentsTotalCount > 0 ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 border-t border-gray-100 bg-gray-50/80 text-xs text-gray-600">
                        <span>
                          Showing{' '}
                          <span className="font-medium text-gray-800">
                            {(studentPage - 1) * STUDENT_PAGE_SIZE + 1}–
                            {Math.min(studentPage * STUDENT_PAGE_SIZE, studentsTotalCount)}
                          </span>{' '}
                          of <span className="font-medium text-gray-800">{studentsTotalCount}</span>
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 font-medium text-gray-700 hover:bg-gray-200/80 disabled:opacity-40 disabled:pointer-events-none"
                            disabled={studentPage <= 1}
                            onClick={() => setStudentPage((p) => Math.max(1, p - 1))}
                            aria-label="Previous page"
                          >
                            <ChevronLeft className="w-4 h-4" />
                            Prev
                          </button>
                          <span className="tabular-nums px-2 text-gray-500">
                            Page {studentPage} / {studentTotalPages}
                          </span>
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 rounded-md px-2 py-1 font-medium text-gray-700 hover:bg-gray-200/80 disabled:opacity-40 disabled:pointer-events-none"
                            disabled={studentPage >= studentTotalPages}
                            onClick={() => setStudentPage((p) => Math.min(studentTotalPages, p + 1))}
                            aria-label="Next page"
                          >
                            Next
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div>
                        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Units to update</div>
                        {unitFilterId.trim() ? (
                          <p className="mt-0.5 text-xs text-gray-500">Only the unit selected in Filters is listed here.</p>
                        ) : null}
                      </div>
                      {!unitFilterId.trim() ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="text-xs font-medium text-[#ea580c] hover:underline"
                            onClick={selectAllUnits}
                          >
                            Select all
                          </button>
                          <span className="text-gray-300">|</span>
                          <button
                            type="button"
                            className="text-xs font-medium text-gray-600 hover:underline"
                            onClick={clearUnits}
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}
                    </div>
                    <div className="rounded-lg border border-[var(--border)] bg-white p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {unitsForMassEditGrid.map((u) => {
                        const uid = Number(u.id);
                        const c = selectedUnitIds.includes(uid);
                        return (
                          <label
                            key={uid}
                            className={`flex items-start gap-2 rounded-md border px-2 py-2 cursor-pointer text-sm transition-colors ${
                              c ? 'border-[#ea580c]/40 bg-[#fff7ed]/60' : 'border-gray-200 hover:bg-[var(--brand)]/10'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-[#ea580c] focus:ring-[#ea580c] mt-0.5 shrink-0"
                              checked={c}
                              onChange={() => toggleUnit(uid)}
                            />
                            <span className="text-gray-800 leading-snug">{u.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--border)] bg-gray-50/50 p-4 space-y-4">
                    <div className="text-sm font-semibold text-gray-800">Mass edit dates</div>
                    <p className="text-xs text-gray-500">
                      Applies the same start and end dates to every checked student × checked unit combination.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <DatePicker
                        label="Start date"
                        value={massStart}
                        onChange={(v) => setMassStart(v || '')}
                        compact
                        placement="below"
                      />
                      <DatePicker label="End date" value={massEnd} onChange={(v) => setMassEnd(v || '')} compact placement="below" />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={saving || selectedStudentIds.length === 0 || selectedUnitIds.length === 0}
                        onClick={() => void saveMassDates()}
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </Card>

        <div className="mt-4 text-xs text-gray-500">
          {batchStudents.length} active student{batchStudents.length !== 1 ? 's' : ''} in this batch
          {unitEligibilityReady && studentsTotalCount > 0 ? (
            <span>
              {' '}
              · {studentsTotalCount} student{studentsTotalCount !== 1 ? 's' : ''} match the current filters
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
