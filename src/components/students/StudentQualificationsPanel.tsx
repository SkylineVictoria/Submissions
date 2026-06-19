import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, UserRound } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { DatePicker } from '../ui/DatePicker';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import type { StudentCourseEnrollment } from '../../lib/formEngine';
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
  enrollmentStatusLabel,
  groupAssessmentsByCourse,
} from '../../lib/studentCourseEnrollment';
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
    setCompleteDate(course.completed_at ?? new Date().toISOString().slice(0, 10));
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

  const handleConfirmComplete = async () => {
    if (!isAdmin || !studentId || !completeCourse) return;
    if (!completeDate.trim()) {
      toast.error('Select a completion date');
      return;
    }
    setCompleteSaving(true);
    const ok = await markStudentCourseComplete(studentId, completeCourse.course_id, completeDate);
    setCompleteSaving(false);
    if (!ok) {
      toast.error('Could not mark course complete');
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
    await updateStudentCourseEnrollment(studentId, assignCourse.course_id, {
      start_date: assignStart,
      end_date: assignEnd,
    });
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

  const headerCols = isAdmin
    ? 'grid-cols-[minmax(0,1fr)_88px_88px_110px_120px_auto]'
    : 'grid-cols-[minmax(0,1fr)_88px_88px_110px_120px]';
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

  return (
    <>
      <div className="overflow-x-auto">
        <div className="min-w-[760px] overflow-hidden rounded-lg border border-[var(--border)]">
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
            const status = enrollmentStatusLabel(course.enrollment_status);
            const endClass =
              course.enrollment_status === 'suspended' ? 'text-red-600 font-medium' : 'text-gray-800';

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
                    </div>
                  </button>
                  <span className="text-xs text-gray-700">{formatDDMMYYYY(course.start_date)}</span>
                  <span className={cn('text-xs', endClass)}>{formatDDMMYYYY(course.end_date)}</span>
                  <span className="text-xs font-medium text-gray-800">{status}</span>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 min-w-[60px] rounded-full bg-gray-200 overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          progress >= 100 ? 'bg-emerald-500' : 'bg-emerald-400'
                        )}
                        style={{ width: `${Math.min(100, progress)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-600 w-8 text-right">{progress}%</span>
                  </div>
                  {isAdmin ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {course.enrollment_status !== 'completed' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs px-2 py-1 h-8"
                          onClick={() => openComplete(course)}
                        >
                          Mark complete
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs px-2 py-1 h-8"
                        onClick={() => openAssign(course)}
                      >
                        Give assessments
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs px-2 py-1 h-8"
                        onClick={() => onAddAssessment?.(course.course_id)}
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
            Confirm completion for{' '}
            <strong>
              {completeCourse?.qualification_code ? `${completeCourse.qualification_code} — ` : ''}
              {completeCourse?.name}
            </strong>
            . This sets the course to <strong>Completed</strong> and records the completion date.
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
