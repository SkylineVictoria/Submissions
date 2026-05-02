import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SortDirection } from '../components/admin/SortableTh';
import { SortableTh } from '../components/admin/SortableTh';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle, Copy, Phone, Mail, ArrowLeft, RotateCcw, Download, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Loader } from '../components/ui/Loader';
import { Modal } from '../components/ui/Modal';
import { DatePicker } from '../components/ui/DatePicker';
import { Input } from '../components/ui/Input';
import { toast } from '../utils/toast';
import { useAuth } from '../contexts/AuthContext';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Select } from '../components/ui/Select';
import {
  computeRowUi,
  getStudentAttemptDoneText,
  getTrainerAttemptFailedText,
  getMissedAttemptWindowText,
  computeAttemptTones,
  hasCompetentAttempt,
  maskCompetentWhileAwaitingTrainer,
  type AttemptResult,
  type AttemptDotTone,
} from '../utils/assessmentRowUi';
import {
  allowStudentResubmission,
  extendInstanceAccessTokensToDate,
  getOrIssueInstanceAccessLink,
  listCoursesPaged,
  listSubmittedInstancesPaged,
  updateFormInstanceDates,
  fetchAssessmentSummaries,
  listActiveFormsByQualificationCode,
  upsertStudentAssessmentsForForms,
  getFormsForCourse,
  deleteStudentIfNoAssessments,
  deleteStudentSuperadmin,
} from '../lib/formEngine';
import type { Student, SubmittedInstanceRow } from '../lib/formEngine';
import { STUDENT_DASHBOARD_AUTH_STORAGE_KEY } from '../lib/formEngine';
import { FormDocumentsPanel } from '../components/documents/FormDocumentsPanel';
import { cn } from '../components/utils/cn';
import {
  rowMatchesTrainerHighlightCourse,
  TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS,
  useTrainerHighlightCourseId,
} from '../utils/trainerCourseHighlight';

const PDF_BASE = import.meta.env.VITE_PDF_API_URL ?? '';

const pad2 = (n: number) => String(n).padStart(2, '0');
const formatDDMMYYYY = (value: string | null): string => {
  const v = (value ?? '').trim();
  if (!v) return '-';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return v;
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

function StatusChecks({ row, attemptResults }: { row: SubmittedInstanceRow; attemptResults: AttemptResult[] }) {
  const studentDone = hasCompetentAttempt(attemptResults);
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
      <Item label="Student" ok={studentDone} />
      <Item label="Trainer" ok={trainerDone} />
      <Item label="Admin" ok={adminDone} />
    </div>
  );
}

const dotToneClass: Record<AttemptDotTone, string> = {
  green: 'bg-emerald-500 border-emerald-600',
  red: 'bg-red-500 border-red-600',
  yellow: 'bg-amber-400 border-amber-500',
  gray: 'bg-gray-200 border-gray-300',
};

function AttemptDots({ tones, titlePrefix }: { tones: AttemptDotTone[]; titlePrefix: string }) {
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

export const AdminStudentDetailsPage: React.FC = () => {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const viewerIsSuperadmin = user?.role === 'superadmin';
  const sid = Number(studentId);
  /** One request loads all assessments for this student (typical max ~34). */
  const ASSESSMENTS_FETCH_SIZE = 80;

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [courses, setCourses] = useState<
    Array<{ id: number; name: string; qualification_code: string | null; enrolled_at?: string }>
  >([]);
  const [assessments, setAssessments] = useState<SubmittedInstanceRow[]>([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(false);
  const [attemptSummaryByInstanceId, setAttemptSummaryByInstanceId] = useState<
    Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
  >({});
  const [managingId, setManagingId] = useState<number | null>(null);
  const [addAssessmentOpen, setAddAssessmentOpen] = useState(false);
  const [addCourseId, setAddCourseId] = useState<string>('');
  const [addStart, setAddStart] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [addEnd, setAddEnd] = useState<string>(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [adding, setAdding] = useState(false);
  const [addForms, setAddForms] = useState<Array<{ id: number; name: string; version: string | null }>>([]);
  const [addFormsLoading, setAddFormsLoading] = useState(false);
  const [addFormId, setAddFormId] = useState<string>('');
  const [editingDateCell, setEditingDateCell] = useState<{ id: number; field: 'start' | 'end' } | null>(null);
  const [savingDateId, setSavingDateId] = useState<number | null>(null);
  const [dateDrafts, setDateDrafts] = useState<Record<number, { start?: string | null; end?: string | null }>>({});
  const [massApplying, setMassApplying] = useState(false);
  const [deleteStudentOpen, setDeleteStudentOpen] = useState(false);
  const [deletingStudent, setDeletingStudent] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [unitSearch, setUnitSearch] = useState('');
  const [selectedFormFilter, setSelectedFormFilter] = useState('');
  const scrollToFormKeyRef = useRef<string | null>(null);
  const prevStudentRouteId = useRef<number | undefined>(undefined);
  const trainerHighlightCourseId = useTrainerHighlightCourseId();

  type AssessmentSortKey = 'unit' | 'start' | 'end' | 'completed';
  const [assessmentSort, setAssessmentSort] = useState<{ key: AssessmentSortKey; dir: SortDirection }>({
    key: 'start',
    dir: 'asc',
  });

  useEffect(() => {
    setAssessmentSort({ key: 'start', dir: 'asc' });
    scrollToFormKeyRef.current = null;
    if (prevStudentRouteId.current !== undefined && prevStudentRouteId.current !== sid) {
      setUnitSearch('');
      setSelectedFormFilter('');
      setSearchParams(new URLSearchParams(), { replace: true });
    }
    prevStudentRouteId.current = sid;
  }, [sid, setSearchParams]);

  useEffect(() => {
    setDateDrafts({});
  }, [sid]);

  const title = useMemo(() => {
    if (!student) return 'Student';
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ').trim();
    return name || student.email || 'Student';
  }, [student]);

  const loadAssessments = useCallback(async () => {
    if (!Number.isFinite(sid) || sid <= 0) return;
    setAssessmentsLoading(true);
    const res = await listSubmittedInstancesPaged(1, ASSESSMENTS_FETCH_SIZE, undefined, undefined, undefined, sid);
    setAssessments(res.data);
    setAssessmentsLoading(false);
  }, [sid]);

  useEffect(() => {
    if (assessments.length === 0) {
      setAttemptSummaryByInstanceId({});
      return;
    }
    const ids = assessments.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
    let cancelled = false;
    void (async () => {
      const m = await fetchAssessmentSummaries(ids);
      if (cancelled) return;
      setAttemptSummaryByInstanceId(m as Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>);
    })();
    return () => {
      cancelled = true;
    };
  }, [assessments]);

  const loadCoursesOptions = useCallback(async (page: number, search: string) => {
    const res = await listCoursesPaged(page, 20, search || undefined);
    return {
      options: res.data.map((c) => ({
        value: String(c.id),
        label: c.qualification_code?.trim() ? `${c.qualification_code} — ${c.name}` : c.name,
      })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const selectedCourseLabel = useMemo(() => {
    if (!addCourseId) return undefined;
    const c = courses.find((x) => String(x.id) === String(addCourseId));
    if (!c) return undefined;
    return c.qualification_code?.trim() ? `${c.qualification_code} — ${c.name}` : c.name;
  }, [addCourseId, courses]);

  useEffect(() => {
    if (!addAssessmentOpen) return;
    // If student has courses, default to first course; otherwise, allow "All forms"
    if (!addCourseId && courses.length > 0) setAddCourseId(String(courses[0].id));
  }, [addAssessmentOpen, addCourseId, courses]);

  useEffect(() => {
    if (!addAssessmentOpen) return;
    const run = async () => {
      setAddFormsLoading(true);
      try {
        if (courses.length === 0) {
          const all = await listActiveFormsByQualificationCode(null);
          setAddForms(all.map((f) => ({ id: Number(f.id), name: f.name, version: f.version ?? null })));
          return;
        }
        const cid = Number(addCourseId);
        if (!Number.isFinite(cid) || cid <= 0) {
          setAddForms([]);
          return;
        }
        // Use forms linked to this course only (not every form with the same qualification code).
        const filtered = await getFormsForCourse(cid, { asAdmin: true });
        setAddForms(filtered.map((f) => ({ id: Number(f.id), name: f.name, version: f.version ?? null })));
      } finally {
        setAddFormsLoading(false);
      }
    };
    void run();
  }, [addAssessmentOpen, addCourseId, courses]);

  useEffect(() => {
    if (!addAssessmentOpen) return;
    // Auto-select first form when opening/changing course.
    const first = addForms[0];
    setAddFormId(first ? String(first.id) : '');
  }, [addAssessmentOpen, addForms]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!Number.isFinite(sid) || sid <= 0) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data: sRow, error: sErr } = await supabase
          .from('skyline_students')
          .select('*, skyline_batches(name)')
          .eq('id', sid)
          .single();
        if (sErr) throw sErr;
        const batch = (sRow as Record<string, unknown>).skyline_batches as { name?: string } | null;
        const fallbackStudent: Student = {
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

        const st = fallbackStudent;

        const { data: scRows } = await supabase
          .from('skyline_student_courses')
          .select('created_at, course_id, skyline_courses(id, name, qualification_code)')
          .eq('student_id', sid)
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

        if (cancelled) return;
        setStudent(st);
        setCourses(courseList);
      } catch (e) {
        if (cancelled) return;
        console.error('AdminStudentDetailsPage load error', e);
        toast.error('Failed to load student details');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [sid]);

  useEffect(() => {
    if (loading) return;
    void loadAssessments();
  }, [loadAssessments, loading]);

  const toggleAssessmentSort = (key: AssessmentSortKey) => {
    setAssessmentSort((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      return { key: prev.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  const timeOrNull = (s: string | null | undefined): number | null => {
    if (!s?.trim()) return null;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  };

  const compareDateNullsLast = (a: string | null | undefined, b: string | null | undefined, asc: boolean): number => {
    const ta = timeOrNull(a);
    const tb = timeOrNull(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    const d = ta - tb;
    return asc ? d : -d;
  };

  const sortedAssessments = useMemo(() => {
    const asc = assessmentSort.dir === 'asc';
    const unitLabel = (row: SubmittedInstanceRow) => String(row.form_name ?? '').trim();
    const rows = [...assessments];
    rows.sort((a, b) => {
      let cmp = 0;
      switch (assessmentSort.key) {
        case 'unit':
          cmp = unitLabel(a).localeCompare(unitLabel(b), undefined, { sensitivity: 'base' });
          if (!asc) cmp = -cmp;
          break;
        case 'start':
          cmp = compareDateNullsLast(a.start_date, b.start_date, asc);
          break;
        case 'end':
          cmp = compareDateNullsLast(a.end_date, b.end_date, asc);
          break;
        case 'completed':
          cmp = compareDateNullsLast(a.submitted_at, b.submitted_at, asc);
          break;
        default:
          break;
      }
      if (cmp !== 0) return cmp;
      return a.id - b.id;
    });
    return rows;
  }, [assessments, assessmentSort]);

  const unitFilterOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const a of assessments) {
      if (!map.has(a.form_id)) {
        map.set(a.form_id, (a.form_name || `Form #${a.form_id}`).trim() || `Form #${a.form_id}`);
      }
    }
    return [...map.entries()]
      .sort((x, y) => x[1].localeCompare(y[1], undefined, { sensitivity: 'base' }))
      .map(([id, name]) => ({ value: String(id), label: name }));
  }, [assessments]);

  const formIdFromUrl = searchParams.get('formId')?.trim() ?? '';

  useEffect(() => {
    if (!formIdFromUrl || assessments.length === 0) return;
    const match = assessments.find((a) => String(a.form_id) === formIdFromUrl);
    if (!match) return;
    setSelectedFormFilter(formIdFromUrl);
    const name = String(match.form_name ?? '');
    const segs = name.split('_');
    const searchHint = segs.length >= 2 ? segs[1] : name;
    setUnitSearch((prev) => (prev.trim() ? prev : searchHint));
  }, [assessments, formIdFromUrl]);

  useEffect(() => {
    if (!formIdFromUrl) setSelectedFormFilter('');
  }, [formIdFromUrl]);

  const displayedAssessments = useMemo(() => {
    let rows = sortedAssessments;
    const q = unitSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => String(r.form_name ?? '').toLowerCase().includes(q));
    }
    if (selectedFormFilter) {
      rows = rows.filter((r) => String(r.form_id) === selectedFormFilter);
    }
    return rows;
  }, [sortedAssessments, unitSearch, selectedFormFilter]);

  useEffect(() => {
    const key = `${sid}:${formIdFromUrl}`;
    if (!formIdFromUrl || assessments.length === 0) return;
    if (scrollToFormKeyRef.current === key) return;
    const row = assessments.find((r) => String(r.form_id) === formIdFromUrl);
    if (!row) return;
    scrollToFormKeyRef.current = key;
    const t = window.setTimeout(() => {
      document.getElementById(`assessment-row-${row.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 150);
    return () => window.clearTimeout(t);
  }, [sid, formIdFromUrl, assessments]);

  const onChangeUnitFilter = useCallback(
    (value: string) => {
      setSelectedFormFilter(value);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set('formId', value);
          else next.delete('formId');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const unitFilterSelectOptions = useMemo(
    () => [{ value: '', label: 'All units' }, ...unitFilterOptions],
    [unitFilterOptions]
  );

  const filterAssessmentsActive = unitSearch.trim() !== '' || selectedFormFilter !== '';
  const assessmentCountLabel = filterAssessmentsActive
    ? `${displayedAssessments.length} shown of ${assessments.length} total`
    : `${assessments.length} total`;

  const getEffectiveStart = useCallback(
    (row: SubmittedInstanceRow) => {
      const d = dateDrafts[row.id];
      if (d && 'start' in d) return String(d.start ?? '').trim();
      return String(row.start_date ?? '').trim();
    },
    [dateDrafts]
  );

  const getEffectiveEnd = useCallback(
    (row: SubmittedInstanceRow) => {
      const d = dateDrafts[row.id];
      if (d && 'end' in d) return String(d.end ?? '').trim();
      return String(row.end_date ?? '').trim();
    },
    [dateDrafts]
  );

  const hasRowDateChanges = useCallback(
    (row: SubmittedInstanceRow) => {
      const es = getEffectiveStart(row);
      const ee = getEffectiveEnd(row);
      const rs = String(row.start_date ?? '').trim();
      const re = String(row.end_date ?? '').trim();
      return es !== rs || ee !== re;
    },
    [getEffectiveStart, getEffectiveEnd]
  );

  const applyRowDates = useCallback(
    async (row: SubmittedInstanceRow) => {
      const nextStart = getEffectiveStart(row) || null;
      const nextEnd = getEffectiveEnd(row) || null;
      if (nextStart && nextEnd && nextStart > nextEnd) {
        toast.error('Start date cannot be later than end date');
        return;
      }
      try {
        setSavingDateId(row.id);
        await updateFormInstanceDates(row.id, { start_date: nextStart, end_date: nextEnd });
        if (nextEnd) await extendInstanceAccessTokensToDate(row.id, 'student', nextEnd);
        setDateDrafts((prev) => {
          const next = { ...prev };
          delete next[row.id];
          return next;
        });
        setEditingDateCell(null);
        await loadAssessments();
        toast.success('Dates updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update dates');
      } finally {
        setSavingDateId(null);
      }
    },
    [getEffectiveEnd, getEffectiveStart, loadAssessments]
  );

  const massApplyDates = useCallback(async () => {
    const targets = sortedAssessments.filter(hasRowDateChanges);
    if (targets.length === 0) return;
    setMassApplying(true);
    let ok = 0;
    try {
      for (const row of targets) {
        const nextStart = getEffectiveStart(row) || null;
        const nextEnd = getEffectiveEnd(row) || null;
        if (nextStart && nextEnd && nextStart > nextEnd) {
          toast.error(`Skipped ${row.form_name ?? 'unit'}: start cannot be after end`);
          continue;
        }
        await updateFormInstanceDates(row.id, { start_date: nextStart, end_date: nextEnd });
        if (nextEnd) await extendInstanceAccessTokensToDate(row.id, 'student', nextEnd);
        setDateDrafts((prev) => {
          const n = { ...prev };
          delete n[row.id];
          return n;
        });
        ok++;
      }
      setEditingDateCell(null);
      await loadAssessments();
      toast.success(`Updated ${ok} assessment${ok !== 1 ? 's' : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mass apply failed');
    } finally {
      setMassApplying(false);
    }
  }, [getEffectiveEnd, getEffectiveStart, hasRowDateChanges, loadAssessments, sortedAssessments]);

  const handleCopyLink = async (row: SubmittedInstanceRow) => {
    const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student';
    const url = await getOrIssueInstanceAccessLink(row.id, role);
    if (!url) {
      toast.error('Failed to create secure link');
      return;
    }
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  };

  const handleOpen = async (row: SubmittedInstanceRow) => {
    const role = row.role_context === 'trainer' ? 'trainer' : row.role_context === 'office' ? 'office' : 'student';
    const url = await getOrIssueInstanceAccessLink(row.id, role);
    if (!url) {
      toast.error('Failed to open secure link');
      return;
    }
    window.open(url, '_blank');
  };

  const hasAssessmentsLoaded = !assessmentsLoading;
  const hasSubmittedAssessment = assessments.some(
    (a) =>
      (a.submitted_at != null && String(a.submitted_at).trim() !== '') || (Number(a.submission_count ?? 0) > 0)
  );
  const canDeleteStudent =
    !!student && (viewerIsSuperadmin || (hasAssessmentsLoaded && !hasSubmittedAssessment));

  const loginAsStudent = async () => {
    if (!viewerIsSuperadmin || !student || !Number.isFinite(sid) || sid <= 0) return;
    // Store student dashboard session. Keep staff session intact (opens in new tab).
    sessionStorage.setItem(
      STUDENT_DASHBOARD_AUTH_STORAGE_KEY,
      JSON.stringify({ studentId: sid, email: student.email, at: Date.now(), by: user?.id ?? null })
    );
    window.open('/student/dashboard', '_blank');
  };

  const confirmDeleteStudent = async () => {
    if (!student || !Number.isFinite(sid) || sid <= 0) return;
    if (!viewerIsSuperadmin && hasSubmittedAssessment) {
      toast.error('Cannot delete. This student has submitted assessments.');
      setDeleteStudentOpen(false);
      return;
    }
    setDeletingStudent(true);
    try {
      const res = viewerIsSuperadmin ? await deleteStudentSuperadmin(sid) : await deleteStudentIfNoAssessments(sid);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Student deleted');
      navigate('/admin/students');
    } finally {
      setDeletingStudent(false);
      setDeleteStudentOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/admin/students')}>
                <ArrowLeft className="w-4 h-4 mr-1 inline" />
                Back
              </Button>
              <h2 className="text-lg font-bold text-[var(--text)] truncate">{title}</h2>
            </div>
            {student?.student_id ? <div className="text-xs text-gray-500 mt-1">Student ID: {student.student_id}</div> : null}
          </div>
        </div>

        {loading ? (
          <Card>
            <div className="py-10">
              <Loader variant="dots" size="lg" message="Loading student..." />
            </div>
          </Card>
        ) : !student ? (
          <Card>
            <p className="text-gray-600">Student not found.</p>
          </Card>
        ) : (
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="w-full lg:w-[340px] lg:shrink-0">
              <Card>
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-gray-500">Student</div>
                    <div className="font-semibold text-[var(--text)] break-words">
                      {[student.first_name, student.last_name].filter(Boolean).join(' ') || student.email}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-sm">
                    <div className="flex items-center gap-2 text-gray-700">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <span className="break-words">{student.email}</span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-700">
                      <Phone className="w-4 h-4 text-gray-400" />
                      <span>{student.phone || '—'}</span>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-gray-500">Course</span>
                      <div className="text-right text-gray-800">
                        {courses.length === 0 ? (
                          '—'
                        ) : (
                          <div className="space-y-2">
                            {courses.map((c) => (
                              <div key={c.id} className="break-words">
                                <div>
                                  {c.qualification_code ? `${c.qualification_code} — ` : ''}
                                  {c.name}
                                </div>
                                {c.enrolled_at ? (
                                  <div className="text-xs text-gray-500">Enrolled {formatDDMMYYYY(c.enrolled_at)}</div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-gray-500">Created</span>
                      <span className="text-gray-800 text-right">{formatDDMMYYYY(student.created_at)}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-gray-500">Batch</span>
                      <span className="text-gray-800 text-right break-words">{student.batch_name ?? '—'}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-gray-500">Status</span>
                      <span className="text-gray-800">{student.status ?? '—'}</span>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-gray-500">Role</span>
                      <span className="text-gray-800">Student</span>
                    </div>
                  </div>

                  {canDeleteStudent ? (
                    <div className="border-t border-gray-100 pt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-red-700 border-red-200 hover:bg-red-50"
                        onClick={() => setDeleteStudentOpen(true)}
                        disabled={deletingStudent}
                        title={
                          viewerIsSuperadmin
                            ? 'Delete student (removes all assessments)'
                            : 'Delete student (only when no submitted assessments)'
                        }
                      >
                        <Trash2 className="w-4 h-4 mr-2 inline" />
                        Delete student
                      </Button>
                      {viewerIsSuperadmin ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full mt-2 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                          onClick={() => void loginAsStudent()}
                          title="Switch to student dashboard for this student"
                        >
                          Login as student
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>

            <div className="min-w-0 flex-1">
              <Card>
                <div className="flex flex-col gap-3 mb-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="font-bold text-[var(--text)]">Assessment records</h3>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-[#ea580c]/40 text-[#c2410c] hover:bg-[#fff7ed]"
                        onClick={() => void massApplyDates()}
                        disabled={massApplying || assessments.length === 0 || !assessments.some(hasRowDateChanges)}
                      >
                        {massApplying ? 'Applying…' : 'Mass apply'}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setAddAssessmentOpen(true)}>
                        + Add Assessment
                      </Button>
                      <div className="text-xs text-gray-500">{assessmentCountLabel}</div>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <Input
                        label="Search unit"
                        value={unitSearch}
                        onChange={(e) => setUnitSearch(e.target.value)}
                        placeholder="Name or code (e.g. CPCCCA3006)"
                        className="w-full"
                      />
                    </div>
                    <div className="w-full sm:w-[min(100%,320px)] sm:flex-shrink-0">
                      <Select
                        label="Unit"
                        value={selectedFormFilter}
                        onChange={onChangeUnitFilter}
                        options={unitFilterSelectOptions}
                        searchable
                        searchPlaceholder="Filter by unit…"
                        className="w-full"
                      />
                    </div>
                  </div>
                </div>

                {assessmentsLoading ? (
                  <div className="py-10">
                    <Loader variant="dots" size="lg" message="Loading assessments..." />
                  </div>
                ) : assessments.length === 0 ? (
                  <p className="text-gray-600">No assessments for this student.</p>
                ) : displayedAssessments.length === 0 ? (
                  <p className="text-gray-600">No assessments match the current search or unit filter.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[940px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                      <thead className="bg-gray-50 text-gray-700">
                        <tr>
                          <SortableTh
                            label="Unit"
                            className="text-left px-3 py-2 border-b border-[var(--border)] w-[300px]"
                            active={assessmentSort.key === 'unit'}
                            direction={assessmentSort.dir}
                            onToggle={() => toggleAssessmentSort('unit')}
                          />
                          <SortableTh
                            label="Start"
                            className="hidden md:table-cell text-left px-3 py-2 border-b border-[var(--border)] w-[100px] whitespace-nowrap"
                            active={assessmentSort.key === 'start'}
                            direction={assessmentSort.dir}
                            onToggle={() => toggleAssessmentSort('start')}
                          />
                          <SortableTh
                            label="End"
                            className="hidden md:table-cell text-left px-3 py-2 border-b border-[var(--border)] w-[100px] whitespace-nowrap"
                            active={assessmentSort.key === 'end'}
                            direction={assessmentSort.dir}
                            onToggle={() => toggleAssessmentSort('end')}
                          />
                          <SortableTh
                            label="Progress"
                            className="text-left px-3 py-2 border-b border-[var(--border)] min-w-[220px]"
                            active={assessmentSort.key === 'completed'}
                            direction={assessmentSort.dir}
                            onToggle={() => toggleAssessmentSort('completed')}
                          />
                          <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)] min-w-[220px]">Comments</th>
                          <th className="text-right px-3 py-2 font-semibold border-b border-[var(--border)]">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {displayedAssessments.map((row) => {
                          const sum = attemptSummaryByInstanceId[row.id] ?? null;
                          const rawAttemptResults: AttemptResult[] = [
                            sum?.final_attempt_1_result ?? null,
                            sum?.final_attempt_2_result ?? null,
                            sum?.final_attempt_3_result ?? null,
                          ];
                          const results = maskCompetentWhileAwaitingTrainer(row, rawAttemptResults);
                          const displaySum = sum
                            ? {
                                ...sum,
                                final_attempt_1_result: results[0] ?? null,
                                final_attempt_2_result: results[1] ?? null,
                                final_attempt_3_result: results[2] ?? null,
                              }
                            : null;
                          const attemptDoneText = getStudentAttemptDoneText({
                            submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
                            submittedAt: row.submitted_at ?? null,
                            attemptResults: rawAttemptResults,
                          });
                          const trainerAttemptFailedText = getTrainerAttemptFailedText(rawAttemptResults);
                          const missedAttemptText = getMissedAttemptWindowText({
                            noAttemptRollovers: (row as unknown as { no_attempt_rollovers?: number | null }).no_attempt_rollovers ?? null,
                            didNotAttempt: (row as unknown as { did_not_attempt?: boolean | null }).did_not_attempt ?? null,
                          });
                          const ui = computeRowUi({ row: { ...row, did_not_attempt: (row as unknown as { did_not_attempt?: boolean | null }).did_not_attempt ?? null }, attemptResults: results });
                          const trainerHighlightExtra = rowMatchesTrainerHighlightCourse(row, trainerHighlightCourseId)
                            ? TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS
                            : '';
                          const dashboardUnitHighlight =
                            Boolean(formIdFromUrl && String(row.form_id) === formIdFromUrl) &&
                            'bg-[#fff7ed] ring-1 ring-[#ea580c]/25';
                          return (
                          <React.Fragment key={row.id}>
                          <tr
                            id={`assessment-row-${row.id}`}
                            className={cn(
                              ui.rowClassName,
                              'cursor-pointer',
                              trainerHighlightExtra,
                              dashboardUnitHighlight
                            )}
                            onClick={() => setExpandedId((p) => (p === row.id ? null : row.id))}
                            title="Click to expand"
                          >
                            <td className="px-3 py-2 border-b border-[var(--border)] align-top">
                              {(() => {
                                return (
                                  <div className="min-w-0">
                                    <div className="font-medium text-[var(--text)] break-words whitespace-normal">
                                      {row.form_name || '—'}
                                    </div>
                                    <div className="text-xs text-gray-500 break-words">
                                      {row.form_version ? `(v${row.form_version})` : ''}
                                    </div>
                                    <div className="md:hidden mt-1 text-xs text-gray-600 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                                      <span>
                                        <span className="text-gray-500">Start</span> {formatDDMMYYYY(getEffectiveStart(row) || row.start_date)}
                                      </span>
                                      <span>
                                        <span className="text-gray-500">End</span> {formatDDMMYYYY(getEffectiveEnd(row) || row.end_date)}
                                      </span>
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td
                              className="hidden md:table-cell px-3 py-2 border-b border-[var(--border)] text-gray-700 align-top"
                            >
                              {editingDateCell?.id === row.id && editingDateCell.field === 'start' ? (
                                <DatePicker
                                  value={getEffectiveStart(row)}
                                  onChange={(v) =>
                                    setDateDrafts((prev) => ({
                                      ...prev,
                                      [row.id]: { ...prev[row.id], start: v || null },
                                    }))
                                  }
                                  compact
                                  placement="below"
                                  className="max-w-[160px]"
                                  disabled={savingDateId === row.id || massApplying}
                                  maxDate={getEffectiveEnd(row) || undefined}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="text-gray-700 hover:underline"
                                  onClick={() => setEditingDateCell({ id: row.id, field: 'start' })}
                                  disabled={savingDateId === row.id || massApplying}
                                >
                                  {formatDDMMYYYY(getEffectiveStart(row) || row.start_date)}
                                </button>
                              )}
                            </td>
                            <td
                              className="hidden md:table-cell px-3 py-2 border-b border-[var(--border)] text-gray-700 align-top"
                            >
                              {editingDateCell?.id === row.id && editingDateCell.field === 'end' ? (
                                <DatePicker
                                  value={getEffectiveEnd(row)}
                                  onChange={(v) =>
                                    setDateDrafts((prev) => ({
                                      ...prev,
                                      [row.id]: { ...prev[row.id], end: v || null },
                                    }))
                                  }
                                  compact
                                  placement="below"
                                  className="max-w-[160px]"
                                  disabled={savingDateId === row.id || massApplying}
                                  minDate={getEffectiveStart(row) || undefined}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="text-gray-700 hover:underline"
                                  onClick={() => setEditingDateCell({ id: row.id, field: 'end' })}
                                  disabled={savingDateId === row.id || massApplying}
                                >
                                  {formatDDMMYYYY(getEffectiveEnd(row) || row.end_date)}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-2 border-b border-[var(--border)] min-w-[220px]">
                              <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-3">
                                  <StatusChecks row={row} attemptResults={results} />
                                </div>
                                {(() => {
                                  const tones = computeAttemptTones({
                                    submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
                                    results,
                                  });
                                  return (
                                    <div className="flex items-center gap-6">
                                      <AttemptDots tones={tones.student} titlePrefix="Student" />
                                      <AttemptDots tones={tones.trainer} titlePrefix="Trainer" />
                                    </div>
                                  );
                                })()}
                              </div>
                            </td>
                            <td className="px-3 py-2 border-b border-[var(--border)] align-top min-w-[220px]">
                              {(() => {
                                const outcomeClass =
                                  ui.kind === 'past_not_competent'
                                    ? ui.outcomeClassName
                                    : ui.kind === 'past_competent'
                                      ? ui.outcomeClassName
                                      : getOutcomeLabel(displaySum).className;
                                const outcomeLabel =
                                  ui.kind === 'past_not_competent'
                                    ? ui.outcomeLabel
                                    : ui.kind === 'past_competent'
                                      ? ui.outcomeLabel
                                      : getOutcomeLabel(displaySum).label;
                                const comments: Array<{ text: string; className: string }> = [];
                                const missedAll = missedAttemptText === "Didn't attempt any";
                                if (missedAll) {
                                  comments.push({ text: "Didn't attempt any", className: 'text-[11px] font-medium text-red-700' });
                                } else {
                                  comments.push({ text: outcomeLabel, className: `text-xs font-medium ${outcomeClass}` });
                                  if (trainerAttemptFailedText) {
                                    comments.push({ text: trainerAttemptFailedText, className: 'text-[11px] font-medium text-red-700' });
                                  }
                                  if (attemptDoneText) comments.push({ text: attemptDoneText, className: 'text-[11px] text-gray-600' });
                                  if (ui.kind === 'in_progress' && missedAttemptText) {
                                    comments.push({ text: missedAttemptText, className: 'text-[11px] font-medium text-amber-700' });
                                  }
                                }
                                if (ui.kind === 'future' || ui.kind === 'expired') {
                                  comments.push({ text: ui.reason, className: 'text-xs text-amber-700' });
                                }
                                return (
                                  <div className="flex flex-col gap-1">
                                    {comments
                                      .filter((c) => c.text.trim().length > 0)
                                      .map((c, idx) => (
                                        <div key={`${row.id}-comment-${idx}`} className={c.className}>
                                          {c.text}
                                        </div>
                                      ))}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-2 border-b border-[var(--border)] text-right">
                              <div className="flex items-center justify-end gap-2">
                                {(() => {
                                  const actionBtn =
                                    'group inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/40 hover:text-[var(--brand)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:text-gray-600 text-xs font-medium';
                                  const actionIcon = 'w-3 h-3 shrink-0';
                                  const actionText = 'max-w-0 overflow-hidden group-hover:max-w-[8rem] transition-all duration-200 whitespace-nowrap';
                                  const pdfBase = PDF_BASE.replace(/\/$/, '');
                                  const downloadPdfHref = pdfBase ? `${pdfBase}/pdf/${row.id}?role=office&download=1` : '';
                                  const canResubmit =
                                    row.status !== 'locked' &&
                                    (Number((row as unknown as { submission_count?: number }).submission_count ?? 0) > 0 || !!row.submitted_at);
                                  return (
                                    <>
                                      <button
                                        type="button"
                                        className="inline-flex items-center justify-center rounded-md border border-[#ea580c]/40 bg-white px-2 py-1 text-[10px] font-semibold text-[#c2410c] hover:bg-[#fff7ed] disabled:cursor-not-allowed disabled:opacity-40"
                                        onClick={() => void applyRowDates(row)}
                                        disabled={!hasRowDateChanges(row) || savingDateId === row.id || massApplying}
                                        title="Apply date changes"
                                      >
                                        Apply
                                      </button>
                                      <a
                                        href={downloadPdfHref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={actionBtn}
                                        aria-disabled={!downloadPdfHref}
                                        onClick={(e) => {
                                          if (!downloadPdfHref) e.preventDefault();
                                        }}
                                        title={!downloadPdfHref ? 'Set VITE_PDF_API_URL to the PDF server URL' : 'Download PDF'}
                                      >
                                        <Download className={actionIcon} />
                                        <span className={actionText}>Download PDF</span>
                                      </a>
                                      <button type="button" className={actionBtn} onClick={() => void handleCopyLink(row)} title="Copy link">
                                        <Copy className={actionIcon} />
                                        <span className={actionText}>Copy link</span>
                                      </button>
                                      {canResubmit ? (
                                        <button
                                          type="button"
                                          className={actionBtn}
                                          onClick={async () => {
                                            setManagingId(row.id);
                                            await allowStudentResubmission(row.id);
                                            setManagingId(null);
                                            await loadAssessments();
                                            toast.success('Resubmission allowed');
                                          }}
                                          disabled={managingId === row.id}
                                          title="Allow resubmission"
                                        >
                                          {managingId === row.id ? <Loader variant="dots" size="sm" inline className="mr-1" /> : <RotateCcw className={actionIcon} />}
                                          <span className={actionText}>Resubmit</span>
                                        </button>
                                      ) : null}
                                    </>
                                  );
                                })()}
                              </div>
                            </td>
                          </tr>
                          {expandedId === row.id ? (
                            <tr className={cn(ui.rowClassName, trainerHighlightExtra)}>
                              <td className="px-3 py-3 border-b border-[var(--border)]" colSpan={7} onClick={(e) => e.stopPropagation()}>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                                  <FormDocumentsPanel
                                    formId={Number(row.form_id)}
                                    formName={String(row.form_name ?? 'Assessment')}
                                    canUpload={true}
                                    canDelete={viewerIsSuperadmin}
                                  />
                                  <button
                                    type="button"
                                    className="rounded-lg border border-[var(--border)] bg-white p-4 text-left hover:bg-[var(--brand)]/10 focus-visible:bg-[var(--brand)]/10 transition-colors"
                                    onClick={() => void handleOpen(row)}
                                    title="Open assessment"
                                  >
                                    <div className="text-sm font-semibold text-[var(--text)]">Assessment</div>
                                    <div className="mt-1 text-xs text-gray-600 break-words">{row.form_name || '—'}</div>
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

      <Modal
        isOpen={addAssessmentOpen}
        onClose={() => {
          if (adding) return;
          setAddAssessmentOpen(false);
        }}
        title="Add Assessment"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Select a course to create/update assessment records for this student. If records already exist, dates will be updated.
          </p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Course</label>
              {courses.length > 0 ? (
                <SelectAsync
                  value={addCourseId}
                  onChange={(v) => setAddCourseId(v)}
                  loadOptions={loadCoursesOptions}
                  placeholder="Select course"
                  selectedLabel={selectedCourseLabel}
                  className="w-full"
                />
              ) : (
                <div className="text-sm text-amber-700">
                  No course is set for this student. All active forms will be used.
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Form</label>
              {addFormsLoading ? (
                <div className="py-3">
                  <Loader variant="dots" size="sm" message="Loading forms..." />
                </div>
              ) : addForms.length === 0 ? (
                <div className="text-sm text-gray-500">No forms found for this course.</div>
              ) : (
                <Select
                  value={addFormId}
                  onChange={(v) => setAddFormId(v)}
                  options={addForms.map((f) => ({
                    value: String(f.id),
                    label: `${f.name}${f.version ? ` (v${f.version})` : ''}`,
                  }))}
                />
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Start date</span>
                <DatePicker value={addStart} onChange={(v) => setAddStart(v || '')} className="mt-1 max-w-[200px]" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">End date</span>
                <DatePicker value={addEnd} onChange={(v) => setAddEnd(v || '')} className="mt-1 max-w-[200px]" />
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddAssessmentOpen(false)} disabled={adding}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (courses.length > 0) {
                  const cid = Number(addCourseId);
                  if (!Number.isFinite(cid) || cid <= 0) {
                    toast.error('Select a course');
                    return;
                  }
                }
                if (!addStart.trim() || !addEnd.trim()) {
                  toast.error('Select start and end date');
                  return;
                }
                if (addEnd.trim() < addStart.trim()) {
                  toast.error('End date cannot be earlier than start date');
                  return;
                }
                const fid = Number(addFormId);
                if (!Number.isFinite(fid) || fid <= 0) {
                  toast.error('Select a form');
                  return;
                }
                setAdding(true);
                const res = await upsertStudentAssessmentsForForms(sid, [fid], {
                  start_date: addStart.trim(),
                  end_date: addEnd.trim(),
                });
                setAdding(false);
                setAddAssessmentOpen(false);
                await loadAssessments();
                toast.success(`Assessment updated. ${res.created} created, ${res.updated} updated.`);
              }}
              disabled={adding || addFormsLoading || addForms.length === 0 || !addFormId || (courses.length > 0 && !addCourseId)}
            >
              {adding ? <Loader variant="dots" size="sm" inline className="mr-2" /> : null}
              Save
            </Button>
          </div>

          {addFormId ? (
            <div className="pt-2 border-t border-gray-100">
              <div className="text-sm font-semibold text-[var(--text)] mb-2">Learning materials</div>
              <FormDocumentsPanel
                formId={Number(addFormId)}
                formName={String(addForms.find((f) => String(f.id) === String(addFormId))?.name ?? 'Assessment')}
                canUpload={true}
                canDelete={viewerIsSuperadmin}
              />
              <div className="text-xs text-gray-500 mt-2">
                Student-learning files are visible to enrolled students; trainer/assessor files stay staff-only.
              </div>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        isOpen={deleteStudentOpen}
        onClose={() => {
          if (deletingStudent) return;
          setDeleteStudentOpen(false);
        }}
        title="Delete student"
        size="md"
      >
        {student ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Delete <strong>{[student.first_name, student.last_name].filter(Boolean).join(' ').trim() || student.email}</strong>?
            </p>
            <p className="text-xs text-gray-500">
              {viewerIsSuperadmin ? (
                <>
                  This will permanently delete the student and <strong>all their assessments</strong>. This action cannot be undone.
                </>
              ) : (
                <>
                  This is only allowed when the student has <strong>no submitted assessments</strong> (allocated but
                  unsubmitted work does not block delete). This action cannot be undone.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteStudentOpen(false)} disabled={deletingStudent}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void confirmDeleteStudent()} disabled={deletingStudent}>
                {deletingStudent ? <Loader variant="dots" size="sm" inline className="mr-2" /> : null}
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};

