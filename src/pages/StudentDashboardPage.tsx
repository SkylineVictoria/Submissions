import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { LayoutDashboard, RefreshCw, Search, Mail, Phone, CheckCircle } from 'lucide-react';
import { listStudentAssessmentsPaged, issueInstanceAccessLink, fetchAssessmentSummaries } from '../lib/formEngine';
import type { Student, SubmittedInstanceRow } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { computeRowUi, melDateString, getStudentAttemptDoneText, getTrainerAttemptFailedText, getMissedAttemptWindowText, type AttemptResult } from '../utils/assessmentRowUi';
import { FormDocumentsPanel } from '../components/documents/FormDocumentsPanel';
import { STUDENT_DASHBOARD_AUTH_STORAGE_KEY } from '../lib/formEngine';
import { cn } from '../components/utils/cn';
import {
  rowMatchesTrainerHighlightCourse,
  TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS,
  useTrainerHighlightCourseId,
} from '../utils/trainerCourseHighlight';

const formatDDMMYYYY = (value: string | null): string => {
  const v = (value ?? '').trim();
  if (!v) return '—';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v;
};

function StatusChecks({ row }: { row: SubmittedInstanceRow }) {
  const studentDone = !!row.submitted_at || (row.submission_count ?? 0) > 0 || row.status === 'locked';
  const trainerDone = row.status === 'locked' || row.role_context === 'office';
  const adminDone = row.status === 'locked';
  const Item = ({ label, ok }: { label: string; ok: boolean }) => (
    <div className="inline-flex items-center gap-1.5 text-xs">
      <CheckCircle className={ok ? 'w-4 h-4 text-emerald-600' : 'w-4 h-4 text-gray-300'} />
      <span className={ok ? 'text-emerald-700 font-medium' : 'text-gray-500'}>{label}</span>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <Item label="Submitted" ok={studentDone} />
      <Item label="Trainer" ok={trainerDone} />
      <Item label="Completed" ok={adminDone} />
    </div>
  );
}

type DotTone = 'green' | 'red' | 'yellow' | 'gray';
const dotToneClass: Record<DotTone, string> = {
  green: 'bg-emerald-500 border-emerald-600',
  red: 'bg-red-500 border-red-600',
  yellow: 'bg-amber-400 border-amber-500',
  gray: 'bg-gray-200 border-gray-300',
};

function computeAttemptTones(input: {
  submissionCount: number;
  results: AttemptResult[];
}): { student: DotTone[]; trainer: DotTone[] } {
  const submitted = Math.min(3, Math.max(0, Number(input.submissionCount) || 0));
  const r = [...input.results, null, null, null].slice(0, 3);

  // Next attempt (yellow for student) if any NYC has occurred, otherwise the next unsubmitted attempt.
  let nextAttemptIdx: number | null = null;
  const firstNYC = r.findIndex((x) => x === 'not_yet_competent');
  if (firstNYC >= 0) nextAttemptIdx = firstNYC + 1 < 3 ? firstNYC + 1 : null;
  else nextAttemptIdx = submitted < 3 ? submitted : null;

  const student: DotTone[] = [0, 1, 2].map((i) => {
    if (r[i] === 'competent') return 'green';
    if (r[i] === 'not_yet_competent') return 'red';
    if (i < submitted) return 'green'; // student has submitted this attempt, awaiting result
    if (nextAttemptIdx === i) return 'yellow'; // next attempt to do
    return 'gray';
  });

  const trainer: DotTone[] = [0, 1, 2].map((i) => {
    if (r[i] === 'competent') return 'green';
    if (r[i] === 'not_yet_competent') return 'red';
    if (i < submitted) return 'yellow'; // submitted but not yet marked
    return 'gray';
  });

  return { student, trainer };
}

function AttemptDots({ tones, titlePrefix }: { tones: DotTone[]; titlePrefix: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`h-2.5 w-2.5 rounded-full border ${dotToneClass[tones[i] ?? 'gray']}`}
          title={`${titlePrefix} attempt ${i + 1}`}
        />
      ))}
    </div>
  );
}

function getOutcomeLabel(summary: { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult } | null): {
  label: string;
  className: string;
} {
  const r1 = summary?.final_attempt_1_result ?? null;
  const r2 = summary?.final_attempt_2_result ?? null;
  const r3 = summary?.final_attempt_3_result ?? null;
  const anyCompetent = r1 === 'competent' || r2 === 'competent' || r3 === 'competent';
  if (anyCompetent) return { label: 'Completed', className: 'text-emerald-700' };
  const anyNYC = r1 === 'not_yet_competent' || r2 === 'not_yet_competent' || r3 === 'not_yet_competent';
  if (anyNYC) return { label: 'Not competent', className: 'text-red-700' };
  return { label: 'In progress', className: 'text-gray-700' };
}

const withinWindowMelbourne = (row: Pick<SubmittedInstanceRow, 'start_date' | 'end_date'>): { ok: boolean; reason?: string } => {
  const today = melDateString(new Date());
  const start = String(row.start_date ?? '').trim();
  const end = String(row.end_date ?? '').trim();
  if (start && today < start) return { ok: false, reason: `Available from ${formatDDMMYYYY(start)}` };
  if (end && today > end) return { ok: false, reason: `Expired on ${formatDDMMYYYY(end)} (23:59 AEDT)` };
  return { ok: true };
};

const STORAGE_KEY = STUDENT_DASHBOARD_AUTH_STORAGE_KEY;

export const StudentDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  // Student dashboard is single-page (no pagination).
  const PAGE_SIZE = 500;
  const [studentId, setStudentId] = useState<number | null>(null);
  const [studentEmail, setStudentEmail] = useState<string>('');
  const [student, setStudent] = useState<Student | null>(null);
  const [studentCourses, setStudentCourses] = useState<Array<{ id: number; name: string; qualification_code: string | null; enrolled_at?: string }>>([]);
  const [studentLoading, setStudentLoading] = useState(false);

  const [rows, setRows] = useState<SubmittedInstanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [attemptSummaryByInstanceId, setAttemptSummaryByInstanceId] = useState<
    Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
  >({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const trainerHighlightCourseId = useTrainerHighlightCourseId();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const j = JSON.parse(raw) as { studentId?: number; email?: string; at?: number };
      const sid = Number(j?.studentId);
      if (Number.isFinite(sid) && sid > 0) {
        setStudentId(sid);
        setStudentEmail(String(j?.email ?? ''));
      }
    } catch {
      // ignore
    }
  }, []);

  const loadRows = useCallback(
    async (search: string, opts?: { silent?: boolean }) => {
      if (!studentId) return;
      if (!opts?.silent) setLoading(true);
      const res = await listStudentAssessmentsPaged(studentId, 1, PAGE_SIZE, search.trim() || undefined);
      setRows(res.data);
      setLoading(false);
    },
    [studentId]
  );

  useEffect(() => {
    if (rows.length === 0) {
      setAttemptSummaryByInstanceId({});
      return;
    }
    const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    let cancelled = false;
    void (async () => {
      const m = await fetchAssessmentSummaries(ids);
      if (cancelled) return;
      setAttemptSummaryByInstanceId(m as Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const loadStudentProfile = useCallback(async () => {
    if (!studentId) return;
    setStudentLoading(true);
    try {
      const { data: sRow, error: sErr } = await supabase
        .from('skyline_students')
        .select('*, skyline_batches(name)')
        .eq('id', studentId)
        .single();
      if (sErr) throw sErr;
      const batch = (sRow as Record<string, unknown>).skyline_batches as { name?: string } | null;
      const st: Student = {
        id: Number((sRow as Record<string, unknown>).id),
        student_id: (sRow as Record<string, unknown>).student_id ? String((sRow as Record<string, unknown>).student_id) : null,
        name: String((sRow as Record<string, unknown>).name ?? ''),
        first_name: (sRow as Record<string, unknown>).first_name ? String((sRow as Record<string, unknown>).first_name) : null,
        last_name: (sRow as Record<string, unknown>).last_name ? String((sRow as Record<string, unknown>).last_name) : null,
        email: String((sRow as Record<string, unknown>).email ?? ''),
        phone: (sRow as Record<string, unknown>).phone ? String((sRow as Record<string, unknown>).phone) : null,
        batch_id: (sRow as Record<string, unknown>).batch_id != null ? Number((sRow as Record<string, unknown>).batch_id) : null,
        batch_name: batch?.name ?? null,
        date_of_birth: (sRow as Record<string, unknown>).date_of_birth ? String((sRow as Record<string, unknown>).date_of_birth) : null,
        address_line_1: null,
        address_line_2: null,
        city: null,
        state: null,
        postal_code: null,
        country: null,
        guardian_name: null,
        guardian_phone: null,
        notes: null,
        status: (sRow as Record<string, unknown>).status ? String((sRow as Record<string, unknown>).status) : null,
        created_at: String((sRow as Record<string, unknown>).created_at ?? ''),
      };
      setStudent(st);

      const { data: scRows } = await supabase
        .from('skyline_student_courses')
        .select('created_at, course_id, skyline_courses(id, name, qualification_code)')
        .eq('student_id', studentId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      const courseList = (
        (scRows as
          | Array<{
              created_at?: string;
              skyline_courses: { id: number; name: string; qualification_code: string | null } | null;
            }>
          | null) || []
      )
        .map((r) => {
          const c = r.skyline_courses;
          if (!c) return null;
          return {
            id: c.id,
            name: c.name,
            qualification_code: c.qualification_code,
            enrolled_at: String(r.created_at ?? ''),
          };
        })
        .filter((c): c is { id: number; name: string; qualification_code: string | null; enrolled_at: string } => !!c);
      setStudentCourses(courseList);
    } catch (e) {
      console.error('StudentDashboardPage load profile error', e);
      setStudent(null);
      setStudentCourses([]);
    } finally {
      setStudentLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    if (!studentId) return;
    const t = setTimeout(() => void loadRows(searchTerm), 250);
    return () => clearTimeout(t);
  }, [studentId, searchTerm, loadRows]);

  useEffect(() => {
    if (!studentId) {
      setStudent(null);
      setStudentCourses([]);
      return;
    }
    void loadStudentProfile();
  }, [studentId, loadStudentProfile]);

  useEffect(() => {
  }, [searchTerm, studentId]);

  const handleRefresh = async () => {
    if (!studentId) return;
    setRefreshing(true);
    await loadRows(searchTerm, { silent: true });
    setRefreshing(false);
    toast.success('Refreshed');
  };

  const handleOpen = async (row: SubmittedInstanceRow) => {
    const win = withinWindowMelbourne(row);
    if (!win.ok) {
      toast.error(win.reason || 'This assessment is not available right now.');
      return;
    }
    const url = await issueInstanceAccessLink(row.id, 'student');
    if (!url) {
      toast.error('Could not open. This assessment may be outside the allowed window.');
      return;
    }
    window.open(url, '_blank');
  };

  const logout = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setStudentId(null);
    setStudentEmail('');
    setStudent(null);
    setStudentCourses([]);
    setRows([]);
    setSearchTerm('');
  };

  const headerRight = useMemo(() => {
    if (!studentId) return null;
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 inline ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        <Button variant="outline" size="sm" onClick={logout}>
          Logout
        </Button>
      </div>
    );
  }, [studentId, refreshing, handleRefresh]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6 space-y-4">
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
                <LayoutDashboard className="w-7 h-7 text-[var(--brand)]" />
                Student dashboard
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                {studentId ? (
                  <>
                    Signed in as <span className="font-medium text-gray-800 break-all">{studentEmail || 'student'}</span>. Open is only allowed between start date and end date (until 23:59 AEDT).
                  </>
                ) : (
                  <>Sign in with OTP to see your assessments.</>
                )}
              </p>
            </div>
            {headerRight}
          </div>
        </Card>

        {!studentId ? (
          <Card className="max-w-xl">
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                You’re not signed in. Please sign in from the main login page to view your dashboard.
              </p>
              <div className="flex gap-2">
                <Button type="button" onClick={() => navigate('/login')} className="min-w-[10rem]">
                  Go to login
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="w-full lg:w-[340px] lg:shrink-0">
              <Card>
                {studentLoading ? (
                  <div className="py-10">
                    <Loader variant="dots" size="lg" message="Loading profile..." />
                  </div>
                ) : !student ? (
                  <div className="space-y-2">
                    <div className="text-sm text-gray-700 font-medium break-all">{studentEmail}</div>
                    <div className="text-xs text-gray-500">Profile not available.</div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <div className="text-xs text-gray-500">Student</div>
                      <div className="font-semibold text-[var(--text)] break-words">
                        {[student.first_name, student.last_name].filter(Boolean).join(' ').trim() || student.email}
                      </div>
                      {student.student_id ? <div className="text-xs text-gray-500 mt-1">Student ID: {student.student_id}</div> : null}
                    </div>

                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <div className="flex items-center gap-2 text-gray-700">
                        <Mail className="w-4 h-4 text-gray-400" />
                        <span className="break-all">{student.email}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gray-700">
                        <Phone className="w-4 h-4 text-gray-400" />
                        <span>{student.phone || '—'}</span>
                      </div>
                    </div>

                    <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-gray-500">Courses</span>
                        <div className="text-right text-gray-800">
                          {studentCourses.length === 0 ? (
                            '—'
                          ) : (
                            <div className="space-y-2">
                              {studentCourses.map((c) => (
                                <div key={c.id} className="break-words">
                                  {c.qualification_code ? `${c.qualification_code} — ` : ''}
                                  {c.name}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-gray-500">Batch</span>
                        <span className="text-gray-800 text-right break-words">{student.batch_name ?? '—'}</span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-gray-500">Status</span>
                        <span className="text-gray-800">{student.status ?? '—'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            <div className="min-w-0 flex-1">
              <Card>
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-[var(--text)]">My assessments</h2>
                    <p className="text-sm text-gray-600 mt-1">Open is enabled only during the allowed date window (end date is 23:59 AEDT).</p>
                  </div>
                  <div className="relative w-full md:w-[320px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <Input
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search unit or status…"
                      className="!pl-10 w-full"
                    />
                  </div>
                </div>

                {loading ? (
                  <div className="py-12">
                    <Loader variant="dots" size="lg" message="Loading assessments..." />
                  </div>
                ) : rows.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-500">No assessments found.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[940px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                      <thead className="bg-gray-50 text-gray-700">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)] w-[300px]">
                            Unit
                          </th>
                          <th className="hidden md:table-cell text-left px-3 py-2 font-semibold border-b border-[var(--border)] w-[100px] whitespace-nowrap">
                            Start
                          </th>
                          <th className="hidden md:table-cell text-left px-3 py-2 font-semibold border-b border-[var(--border)] w-[100px] whitespace-nowrap">
                            End
                          </th>
                          <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)] min-w-[240px]">
                            Progress
                          </th>
                          <th className="text-right px-3 py-2 font-semibold border-b border-[var(--border)] whitespace-nowrap">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => {
                          const sum = attemptSummaryByInstanceId[row.id] ?? null;
                          const attemptResults: AttemptResult[] = [
                            sum?.final_attempt_1_result ?? null,
                            sum?.final_attempt_2_result ?? null,
                            sum?.final_attempt_3_result ?? null,
                          ];
                          const attemptDoneText = getStudentAttemptDoneText({
                            submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
                            submittedAt: row.submitted_at ?? null,
                            attemptResults,
                          });
                          const trainerAttemptFailedText = getTrainerAttemptFailedText(attemptResults);
                          const missedAttemptText = getMissedAttemptWindowText({
                            noAttemptRollovers: (row as unknown as { no_attempt_rollovers?: number | null }).no_attempt_rollovers ?? null,
                            didNotAttempt: (row as unknown as { did_not_attempt?: boolean | null }).did_not_attempt ?? null,
                          });
                          const ui = computeRowUi({ row: { ...row, did_not_attempt: (row as unknown as { did_not_attempt?: boolean | null }).did_not_attempt ?? null }, attemptResults });
                          const disabled = ui.disabled;
                          const win = withinWindowMelbourne(row);
                          const trainerHighlightExtra = rowMatchesTrainerHighlightCourse(row, trainerHighlightCourseId)
                            ? TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS
                            : '';
                          return (
                            <React.Fragment key={row.id}>
                            <tr
                              className={cn(ui.rowClassName, 'cursor-pointer', trainerHighlightExtra)}
                              onClick={() => setExpandedId((prev) => (prev === row.id ? null : row.id))}
                              title="Click to expand"
                            >
                              <td className="px-3 py-2 border-b border-[var(--border)] align-top">
                                <div className="font-medium text-[var(--text)] break-words whitespace-normal">{row.form_name}</div>
                                <div className="text-xs text-gray-500">Version {row.form_version ?? '1.0.0'}</div>
                                <div className="md:hidden mt-1 text-xs text-gray-600 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                                  <span>
                                    <span className="text-gray-500">Start</span> {formatDDMMYYYY(row.start_date)}
                                  </span>
                                  <span>
                                    <span className="text-gray-500">End</span> {formatDDMMYYYY(row.end_date)}
                                  </span>
                                </div>
                              </td>
                              <td
                                className="hidden md:table-cell px-3 py-2 border-b border-[var(--border)] text-gray-700 whitespace-nowrap tabular-nums align-top"
                              >
                                {formatDDMMYYYY(row.start_date)}
                              </td>
                              <td
                                className="hidden md:table-cell px-3 py-2 border-b border-[var(--border)] text-gray-700 whitespace-nowrap tabular-nums align-top"
                              >
                                {formatDDMMYYYY(row.end_date)}
                              </td>
                              <td
                                className="px-3 py-2 border-b border-[var(--border)] min-w-[240px]"
                              >
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center justify-between gap-3">
                                    <StatusChecks row={row} />
                                  </div>
                                  {(() => {
                                    const tones = computeAttemptTones({
                                      submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
                                      results: attemptResults,
                                    });
                                    return (
                                      <div className="flex items-center gap-6">
                                        <AttemptDots tones={tones.student} titlePrefix="Student" />
                                        <AttemptDots tones={tones.trainer} titlePrefix="Trainer" />
                                      </div>
                                    );
                                  })()}
                                  <div
                                    className={`text-xs font-medium ${
                                      ui.kind === 'past_not_competent' ? ui.outcomeClassName : ui.kind === 'past_competent' ? ui.outcomeClassName : getOutcomeLabel(sum).className
                                    }`}
                                  >
                                    {ui.kind === 'past_not_competent' ? ui.outcomeLabel : ui.kind === 'past_competent' ? ui.outcomeLabel : getOutcomeLabel(sum).label}
                                  </div>
                                  {attemptDoneText ? (
                                    <div className="text-[11px] text-gray-600">{attemptDoneText}</div>
                                  ) : null}
                                  {ui.kind === 'in_progress' && missedAttemptText ? (
                                    <div className="text-[11px] font-medium text-amber-700">{missedAttemptText}</div>
                                  ) : null}
                                  {trainerAttemptFailedText ? (
                                    <div className="text-[11px] font-medium text-red-700">{trainerAttemptFailedText}</div>
                                  ) : null}
                                </div>
                                {disabled && (ui.kind === 'future' || ui.kind === 'expired') ? (
                                  <div className="text-xs text-amber-700 mt-1">{ui.reason}</div>
                                ) : !win.ok ? (
                                  <div className="text-xs text-amber-700 mt-1">{win.reason}</div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 border-b border-[var(--border)] text-right align-top">
                                <div className="text-xs text-gray-500">—</div>
                              </td>
                            </tr>
                            {expandedId === row.id ? (
                              <tr className={cn(ui.rowClassName, trainerHighlightExtra)}>
                                <td className="px-3 py-3 border-b border-[var(--border)]" colSpan={5} onClick={(e) => e.stopPropagation()}>
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                    <FormDocumentsPanel
                                      formId={Number(row.form_id)}
                                      formName={String(row.form_name ?? 'Assessment')}
                                      canUpload={false}
                                      showTrainerSection={false}
                                    />
                                    <button
                                      type="button"
                                      className="rounded-lg border border-[var(--border)] bg-white p-4 text-left hover:bg-[var(--brand)]/10 focus-visible:bg-[var(--brand)]/10 transition-colors"
                                      onClick={() => void handleOpen(row)}
                                      disabled={disabled}
                                      title="Open assessment"
                                    >
                                      <div className="text-sm font-semibold text-[var(--text)]">Assessment</div>
                                      <div className="mt-1 text-xs text-gray-600 break-words">{row.form_name}</div>
                                      <div className="mt-3 inline-flex items-center rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700">
                                        Open
                                      </div>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

