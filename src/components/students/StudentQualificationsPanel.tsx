import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, UserRound } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { DatePicker } from '../ui/DatePicker';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import type { StudentCourseEnrollment, StudentCourseEnrollmentStatus } from '../../lib/formEngine';
import {
  markStudentCourseComplete,
  updateStudentCourseEnrollment,
  upsertStudentAssessmentsForCourse,
} from '../../lib/formEngine';
import type { SubmittedInstanceRow } from '../../lib/formEngine';
import type { AttemptResult } from '../../utils/assessmentRowUi';
import {
  computeCourseProgressPercent,
  defaultIntakeLabel,
  groupAssessmentsByCourse,
} from '../../lib/studentCourseEnrollment';
import {
  allowedNextCourseStatuses,
  courseBlocksNewAssessmentActivity,
  courseLifecycleLabel,
  ERROR_ALREADY_IN_PROGRESS,
} from '../../lib/courseLifecycle';
import {
  evaluateStudentCourseRunningAccess,
  studentMayMutateAssessment,
} from '../../lib/studentAssessmentAccess';
import { melDateString } from '../../utils/assessmentRowUi';
import { CourseLifecycleBadge } from './CourseLifecycleBadge';
import { cn } from '../utils/cn';

const formatDDMMYYYY = (value: string | null): string => {
  const v = (value ?? '').trim();
  if (!v) return '—';
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v;
};

interface StudentQualificationsPanelProps {
  studentId?: number;
  enrollments: StudentCourseEnrollment[];
  assessments: SubmittedInstanceRow[];
  summaries: Record<
    number,
    { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }
  >;
  loading?: boolean;
  variant?: 'admin' | 'student';
  onRefresh?: () => void;
  onAddAssessment?: (courseId: number) => void;
  onActiveCourseChange?: (courseId: number | null) => void;
  renderExpandedContent?: (course: StudentCourseEnrollment, rows: SubmittedInstanceRow[]) => React.ReactNode;
}

type EditDraft = {
  course: StudentCourseEnrollment;
  start_date: string;
  end_date: string;
  enrollment_status: StudentCourseEnrollmentStatus;
};

export const StudentQualificationsPanel: React.FC<StudentQualificationsPanelProps> = ({
  studentId,
  enrollments,
  assessments,
  summaries,
  loading,
  variant = 'admin',
  onRefresh,
  onAddAssessment,
  onActiveCourseChange,
  renderExpandedContent,
}) => {
  const isAdmin = variant === 'admin';
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeCourse, setCompleteCourse] = useState<StudentCourseEnrollment | null>(null);
  const [completeDate, setCompleteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [completeSaving, setCompleteSaving] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignCourse, setAssignCourse] = useState<StudentCourseEnrollment | null>(null);
  const [assignStart, setAssignStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [assignEnd, setAssignEnd] = useState(() =>
    new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [assignSaving, setAssignSaving] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    status: 'suspended' | 'cancelled' | 'completed';
    course: StudentCourseEnrollment;
  } | null>(null);

  const inProgressCourse = useMemo(
    () => enrollments.find((e) => e.enrollment_status === 'in_progress') ?? null,
    [enrollments]
  );

  const grouped = useMemo(
    () => groupAssessmentsByCourse(assessments, enrollments),
    [assessments, enrollments]
  );

  const toggleExpanded = (courseId: number) => {
    setExpanded((prev) => {
      const next = !prev[courseId];
      onActiveCourseChange?.(next ? courseId : null);
      return { ...prev, [courseId]: next };
    });
  };

  const openComplete = (course: StudentCourseEnrollment) => {
    setCompleteCourse(course);
    setCompleteDate(course.completed_at ?? course.end_date ?? new Date().toISOString().slice(0, 10));
    setCompleteOpen(true);
  };

  const openAssign = (course: StudentCourseEnrollment) => {
    setAssignCourse(course);
    setAssignStart(course.start_date ?? new Date().toISOString().slice(0, 10));
    setAssignEnd(
      course.end_date ?? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    );
    setAssignOpen(true);
  };

  const openEdit = (course: StudentCourseEnrollment) => {
    setEditError(null);
    setEditDraft({
      course,
      start_date: course.start_date ?? '',
      end_date: course.end_date ?? '',
      enrollment_status: course.enrollment_status,
    });
  };

  const handleConfirmComplete = async () => {
    if (!isAdmin || !studentId || !completeCourse) return;
    if (!completeDate.trim()) {
      toast.error('Select a completion date');
      return;
    }
    setCompleteSaving(true);
    const res = await markStudentCourseComplete(studentId, completeCourse.course_id, completeDate);
    setCompleteSaving(false);
    if (!res.ok) {
      toast.error(res.error ?? 'Could not mark course complete');
      return;
    }
    toast.success('Course marked complete');
    setCompleteOpen(false);
    setCompleteCourse(null);
    onRefresh?.();
  };

  const handleAssignAssessments = async () => {
    if (!isAdmin || !studentId || !assignCourse) return;
    if (!assignStart.trim() || !assignEnd.trim()) {
      toast.error('Select start and end dates');
      return;
    }
    if (assignEnd < assignStart) {
      toast.error('End date cannot be before start date');
      return;
    }
    setAssignSaving(true);
    const upd = await updateStudentCourseEnrollment(studentId, assignCourse.course_id, {
      start_date: assignStart,
      end_date: assignEnd,
    });
    if (!upd.ok) {
      setAssignSaving(false);
      toast.error(upd.error ?? 'Could not update course dates');
      return;
    }
    const res = await upsertStudentAssessmentsForCourse(studentId, assignCourse.course_id, {
      start_date: assignStart,
      end_date: assignEnd,
    });
    setAssignSaving(false);
    setAssignOpen(false);
    setAssignCourse(null);
    onRefresh?.();
    toast.success(`Assessments assigned: ${res.created} created, ${res.updated} updated.`);
  };

  const handleSaveEdit = async () => {
    if (!isAdmin || !studentId || !editDraft) return;
    setEditSaving(true);
    setEditError(null);
    const res = await updateStudentCourseEnrollment(studentId, editDraft.course.course_id, {
      start_date: editDraft.start_date || null,
      end_date: editDraft.end_date || null,
      enrollment_status: editDraft.enrollment_status,
      completed_at:
        editDraft.enrollment_status === 'completed'
          ? editDraft.end_date || new Date().toISOString().slice(0, 10)
          : null,
    });
    setEditSaving(false);
    if (!res.ok) {
      setEditError(res.error ?? ERROR_ALREADY_IN_PROGRESS);
      toast.error(res.error ?? 'Could not update course');
      return;
    }
    toast.success('Course enrolment updated');
    setEditDraft(null);
    onRefresh?.();
  };

  const handleConfirmStatus = async () => {
    if (!isAdmin || !studentId || !confirmAction) return;
    const { course, status } = confirmAction;
    const end = course.end_date || new Date().toISOString().slice(0, 10);
    const res = await updateStudentCourseEnrollment(studentId, course.course_id, {
      enrollment_status: status,
      end_date: status === 'completed' ? end : course.end_date,
      completed_at: status === 'completed' ? end : null,
    });
    if (!res.ok) {
      toast.error(res.error ?? 'Could not update course status');
      return;
    }
    toast.success(`Course marked ${status === 'completed' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Suspended'}`);
    setConfirmAction(null);
    onRefresh?.();
  };

  const headerCols = isAdmin
    ? 'grid-cols-[minmax(0,1fr)_88px_88px_120px_120px_auto]'
    : 'grid-cols-[minmax(0,1fr)_88px_88px_120px_120px]';
  const rowCols = headerCols;

  if (loading) {
    return (
      <div className="py-10">
        <Loader variant="dots" size="lg" message="Loading qualifications…" />
      </div>
    );
  }

  if (enrollments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-600">
        {isAdmin
          ? 'No courses assigned to this student. Assign courses from the Students list to manage qualifications here.'
          : 'No courses are linked to your account yet. Contact your training provider if you expect to see qualifications here.'}
      </div>
    );
  }

  const nextStatuses = editDraft ? allowedNextCourseStatuses(editDraft.course.enrollment_status) : [];

  return (
    <>
      {!isAdmin && inProgressCourse ? (
        <p className="mb-3 text-xs text-gray-600">
          Current In Progress course:{' '}
          <strong>
            {inProgressCourse.qualification_code
              ? `${inProgressCourse.qualification_code} — ${inProgressCourse.name}`
              : inProgressCourse.name}
          </strong>
          {inProgressCourse.start_date || inProgressCourse.end_date
            ? ` (${formatDDMMYYYY(inProgressCourse.start_date)} – ${formatDDMMYYYY(inProgressCourse.end_date)})`
            : null}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <div className="min-w-[800px] overflow-hidden rounded-lg border border-[var(--border)]">
          <div className={cn('grid gap-2 bg-[#ea580c] px-3 py-2 text-xs font-semibold text-white', headerCols)}>
            <span>Qualification / Intake</span>
            <span>Start</span>
            <span>End</span>
            <span>Status</span>
            <span>Progress</span>
            {isAdmin ? <span className="text-right">Actions</span> : null}
          </div>

          {enrollments.map((course) => {
            const rows = grouped.get(course.course_id) ?? [];
            const progress = computeCourseProgressPercent(rows, summaries);
            const isOpen = !!expanded[course.course_id];
            const intake = course.intake_label?.trim() || defaultIntakeLabel(course);
            const accessEval = !isAdmin
              ? evaluateStudentCourseRunningAccess({
                  linkStatus: course.link_status,
                  enrollmentStatus: course.enrollment_status,
                  startDate: course.start_date,
                  endDate: course.end_date,
                  todayMelbourneIso: melDateString(),
                  courseId: course.course_id,
                })
              : null;
            const accessMsg =
              accessEval && !studentMayMutateAssessment(accessEval) ? accessEval.message : null;
            const endClass =
              course.enrollment_status === 'suspended' ? 'text-orange-700 font-medium' : 'text-gray-800';

            return (
              <div key={course.course_id} className="border-t border-[var(--border)]">
                <div className={cn('grid gap-2 items-center px-3 py-3 bg-white', rowCols)}>
                  <button
                    type="button"
                    className="flex min-w-0 items-start gap-2 text-left"
                    onClick={() => toggleExpanded(course.course_id)}
                  >
                    {isOpen ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-[var(--text)] break-words">
                        {course.qualification_code ? `${course.qualification_code} — ${course.name}` : course.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-600 break-words">
                        <UserRound className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                        {intake}
                      </div>
                      {accessMsg ? <p className="mt-1 text-xs text-amber-800">{accessMsg}</p> : null}
                    </div>
                  </button>
                  <span className="text-xs text-gray-700">{formatDDMMYYYY(course.start_date)}</span>
                  <span className={cn('text-xs', endClass)}>{formatDDMMYYYY(course.end_date)}</span>
                  <CourseLifecycleBadge status={course.enrollment_status} />
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 min-w-[60px] rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', progress >= 100 ? 'bg-emerald-500' : 'bg-emerald-400')}
                        style={{ width: `${Math.min(100, progress)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-600 w-8 text-right">{progress}%</span>
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button variant="outline" size="sm" className="text-xs px-2 py-1 h-8" onClick={() => openEdit(course)}>
                        Edit
                      </Button>
                      {course.enrollment_status === 'in_progress' ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs px-2 py-1 h-8"
                            onClick={() => setConfirmAction({ status: 'suspended', course })}
                          >
                            Suspend
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs px-2 py-1 h-8"
                            onClick={() => openComplete(course)}
                          >
                            Complete
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs px-2 py-1 h-8 text-red-700"
                            onClick={() => setConfirmAction({ status: 'cancelled', course })}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : null}
                      {course.enrollment_status === 'in_progress' || course.enrollment_status === 'tentative' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs px-2 py-1 h-8"
                          onClick={() => openAssign(course)}
                        >
                          Give assessments
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs px-2 py-1 h-8"
                        onClick={() => onAddAssessment?.(course.course_id)}
                        disabled={courseBlocksNewAssessmentActivity(course.enrollment_status)}
                      >
                        + Unit
                      </Button>
                    </div>
                  ) : null}
                </div>

                {isOpen ? (
                  <div className="border-t border-gray-100 bg-[#fafafa] px-4 py-4">
                    {renderExpandedContent ? (
                      renderExpandedContent(course, rows)
                    ) : rows.length === 0 ? (
                      <p className="text-sm text-gray-500">
                        {isAdmin
                          ? 'No assessments for this course yet. Use “Give assessments”.'
                          : 'No assessments for this course yet.'}
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500">
                        {rows.length} unit{rows.length === 1 ? '' : 's'} of competency
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {isAdmin ? (
        <>
          <Modal
            isOpen={completeOpen}
            onClose={() => {
              if (completeSaving) return;
              setCompleteOpen(false);
            }}
            title="Mark course complete"
            size="md"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Completing this course will close the enrolment on{' '}
                <strong>{formatDDMMYYYY(completeDate)}</strong>. Existing assessment records will not be changed.
                Continue?
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Completion date</label>
                <DatePicker value={completeDate} onChange={(v) => setCompleteDate(v || '')} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCompleteOpen(false)} disabled={completeSaving}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void handleConfirmComplete()} disabled={completeSaving}>
                  {completeSaving ? 'Saving…' : 'Confirm completion'}
                </Button>
              </div>
            </div>
          </Modal>

          <Modal
            isOpen={!!confirmAction}
            onClose={() => setConfirmAction(null)}
            title={
              confirmAction?.status === 'suspended'
                ? 'Suspend course'
                : confirmAction?.status === 'cancelled'
                  ? 'Cancel course'
                  : 'Complete course'
            }
            size="md"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {confirmAction?.status === 'suspended'
                  ? 'Suspending this course keeps assessment history. Another course may then become In Progress. Continue?'
                  : confirmAction?.status === 'cancelled'
                    ? 'Cancelling this course keeps historical records but blocks new assessment activity. Continue?'
                    : 'Complete this course? Existing assessment records will not be changed.'}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmAction(null)}>
                  Back
                </Button>
                <Button variant="primary" onClick={() => void handleConfirmStatus()}>
                  Confirm
                </Button>
              </div>
            </div>
          </Modal>

          <Modal
            isOpen={!!editDraft}
            onClose={() => {
              if (editSaving) return;
              setEditDraft(null);
            }}
            title="Edit course enrolment"
            size="md"
          >
            {editDraft ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-700 font-medium">
                  {editDraft.course.qualification_code
                    ? `${editDraft.course.qualification_code} — ${editDraft.course.name}`
                    : editDraft.course.name}
                </p>
                {inProgressCourse && inProgressCourse.course_id !== editDraft.course.course_id ? (
                  <p className="text-xs text-amber-800 rounded-md bg-amber-50 border border-amber-200 px-2 py-1.5">
                    Currently In Progress:{' '}
                    {inProgressCourse.qualification_code
                      ? `${inProgressCourse.qualification_code} — ${inProgressCourse.name}`
                      : inProgressCourse.name}{' '}
                    ({formatDDMMYYYY(inProgressCourse.start_date)} – {formatDDMMYYYY(inProgressCourse.end_date)})
                  </p>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Course start date</label>
                    <DatePicker
                      value={editDraft.start_date}
                      onChange={(v) => setEditDraft((p) => (p ? { ...p, start_date: v || '' } : p))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Course end date</label>
                    <DatePicker
                      value={editDraft.end_date}
                      onChange={(v) => setEditDraft((p) => (p ? { ...p, end_date: v || '' } : p))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Course status</label>
                  <select
                    className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
                    value={editDraft.enrollment_status}
                    onChange={(e) =>
                      setEditDraft((p) =>
                        p
                          ? { ...p, enrollment_status: e.target.value as StudentCourseEnrollmentStatus }
                          : p
                      )
                    }
                  >
                    <option value={editDraft.course.enrollment_status}>
                      Current: {courseLifecycleLabel(editDraft.course.enrollment_status)}
                    </option>
                    {nextStatuses.map((s) => (
                      <option key={s} value={s}>
                        {courseLifecycleLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                {editError ? <p className="text-sm text-red-700">{editError}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditDraft(null)} disabled={editSaving}>
                    Cancel
                  </Button>
                  <Button variant="primary" onClick={() => void handleSaveEdit()} disabled={editSaving}>
                    {editSaving ? 'Saving…' : 'Save changes'}
                  </Button>
                </div>
              </div>
            ) : null}
          </Modal>

          <Modal
            isOpen={assignOpen}
            onClose={() => {
              if (assignSaving) return;
              setAssignOpen(false);
            }}
            title="Give assessments for course"
            size="md"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Create or update all unit assessments linked to <strong>{assignCourse?.name}</strong>.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start date</label>
                  <DatePicker value={assignStart} onChange={(v) => setAssignStart(v || '')} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End date</label>
                  <DatePicker value={assignEnd} onChange={(v) => setAssignEnd(v || '')} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignSaving}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void handleAssignAssessments()} disabled={assignSaving}>
                  {assignSaving ? 'Assigning…' : 'Confirm & assign'}
                </Button>
              </div>
            </div>
          </Modal>
        </>
      ) : null}
    </>
  );
};
