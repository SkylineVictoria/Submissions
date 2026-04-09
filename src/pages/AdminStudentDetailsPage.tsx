import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle, Copy, ExternalLink, Phone, Mail, ArrowLeft, CalendarDays, RotateCcw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Loader } from '../components/ui/Loader';
import { Modal } from '../components/ui/Modal';
import { DatePicker } from '../components/ui/DatePicker';
import { toast } from '../utils/toast';
import { AdminListPagination } from '../components/admin/AdminListPagination';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Select } from '../components/ui/Select';
import {
  allowStudentResubmission,
  extendInstanceAccessTokensToDate,
  getOrIssueInstanceAccessLink,
  listCoursesPaged,
  listSubmittedInstancesPaged,
  updateFormInstanceDates,
  listActiveFormsByQualificationCode,
  upsertStudentAssessmentsForForms,
  getCoursesForForms,
} from '../lib/formEngine';
import type { Student, SubmittedInstanceRow } from '../lib/formEngine';

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
      <Item label="Student" ok={studentDone} />
      <Item label="Trainer" ok={trainerDone} />
      <Item label="Admin" ok={adminDone} />
    </div>
  );
}

export const AdminStudentDetailsPage: React.FC = () => {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const sid = Number(studentId);
  const PAGE_SIZE = 20;

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<Student | null>(null);
  const [courses, setCourses] = useState<Array<{ id: number; name: string; qualification_code: string | null }>>([]);
  const [assessments, setAssessments] = useState<SubmittedInstanceRow[]>([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(false);
  const [courseByFormId, setCourseByFormId] = useState<Map<number, { id: number; name: string; qualification_code?: string | null }[]>>(
    () => new Map()
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  const [managingId, setManagingId] = useState<number | null>(null);
  const [addAssessmentOpen, setAddAssessmentOpen] = useState(false);
  const [addCourseId, setAddCourseId] = useState<string>('');
  const [addStart, setAddStart] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [addEnd, setAddEnd] = useState<string>(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [adding, setAdding] = useState(false);
  const [addForms, setAddForms] = useState<Array<{ id: number; name: string; version: string | null }>>([]);
  const [addFormsLoading, setAddFormsLoading] = useState(false);
  const [addFormId, setAddFormId] = useState<string>('');
  const [editDatesRow, setEditDatesRow] = useState<SubmittedInstanceRow | null>(null);
  const [editDatesStart, setEditDatesStart] = useState('');
  const [editDatesEnd, setEditDatesEnd] = useState('');
  const [savingDates, setSavingDates] = useState(false);

  const title = useMemo(() => {
    if (!student) return 'Student';
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ').trim();
    return name || student.email || 'Student';
  }, [student]);

  const loadAssessments = useCallback(async (page: number) => {
    if (!Number.isFinite(sid) || sid <= 0) return;
    setAssessmentsLoading(true);
    const res = await listSubmittedInstancesPaged(page, PAGE_SIZE, undefined, undefined, undefined, sid);
    setAssessments(res.data);
    setTotalRows(res.total);
    const formIds = Array.from(new Set(res.data.map((r) => Number(r.form_id)).filter((n) => Number.isFinite(n) && n > 0)));
    if (formIds.length > 0) {
      const map = await getCoursesForForms(formIds);
      setCourseByFormId(map);
    } else {
      setCourseByFormId(new Map());
    }
    setAssessmentsLoading(false);
  }, [sid]);

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
        const selected = courses.find((c) => String(c.id) === String(addCourseId)) ?? null;
        const qual = selected?.qualification_code ?? null;
        const filtered = await listActiveFormsByQualificationCode(qual);
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
          .select('course_id, skyline_courses(id, name, qualification_code)')
          .eq('student_id', sid)
          .eq('status', 'active');
        const courseList =
          ((scRows as Array<{ skyline_courses: { id: number; name: string; qualification_code: string | null } | null }> | null) || [])
            .map((r) => r.skyline_courses)
            .filter((c): c is { id: number; name: string; qualification_code: string | null } => !!c);

        if (cancelled) return;
        setStudent(st);
        setCourses(courseList);
        setCurrentPage(1);
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
    void loadAssessments(currentPage);
  }, [currentPage, loadAssessments, loading]);

  const openEditDates = (row: SubmittedInstanceRow) => {
    setEditDatesRow(row);
    setEditDatesStart((row.start_date ?? '').trim() || new Date().toISOString().slice(0, 10));
    setEditDatesEnd((row.end_date ?? '').trim() || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  };

  const handleSaveDates = async () => {
    if (!editDatesRow) return;
    const start = editDatesStart.trim();
    const end = editDatesEnd.trim();
    if (!start || !end) {
      toast.error('Select start and end date');
      return;
    }
    if (end < start) {
      toast.error('End date cannot be earlier than start date');
      return;
    }
    setSavingDates(true);
    await updateFormInstanceDates(editDatesRow.id, { start_date: start, end_date: end });
    await extendInstanceAccessTokensToDate(editDatesRow.id, 'student', end);
    setSavingDates(false);
    setEditDatesRow(null);
    await loadAssessments(currentPage);
    toast.success('Assessment dates updated');
  };

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
                          <div className="space-y-1">
                            {courses.map((c) => (
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
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-gray-500">Role</span>
                      <span className="text-gray-800">Student</span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            <div className="min-w-0 flex-1">
              <Card>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-bold text-[var(--text)]">Assessment records</h3>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setAddAssessmentOpen(true)}>
                      + Add Assessment
                    </Button>
                    <div className="text-xs text-gray-500">{totalRows} total</div>
                  </div>
                </div>

                {assessmentsLoading ? (
                  <div className="py-10">
                    <Loader variant="dots" size="lg" message="Loading assessments..." />
                  </div>
                ) : assessments.length === 0 ? (
                  <p className="text-gray-600">No assessments for this student.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[860px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                      <thead className="bg-gray-50 text-gray-700">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)] w-[300px]">Course</th>
                          <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)]">Start</th>
                          <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)]">End</th>
                          <th className="text-left px-3 py-2 font-semibold border-b border-[var(--border)]">Completed</th>
                          <th className="text-right px-3 py-2 font-semibold border-b border-[var(--border)]">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {assessments.map((row) => (
                          <tr key={row.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2 border-b border-[var(--border)] align-top">
                              {(() => {
                                const courses = courseByFormId.get(Number(row.form_id)) || [];
                                const c = courses[0];
                                return (
                                  <div className="min-w-0">
                                    <div className="font-medium text-[var(--text)] break-words whitespace-normal">
                                      {c ? `${c.qualification_code ? `${c.qualification_code} — ` : ''}${c.name}` : '—'}
                                    </div>
                                    <div className="text-xs text-gray-500 break-words">
                                      {row.form_name} {row.form_version ? `(v${row.form_version})` : ''}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-2 border-b border-[var(--border)] text-gray-700">
                              {formatDDMMYYYY(row.start_date)}
                            </td>
                            <td className="px-3 py-2 border-b border-[var(--border)] text-gray-700">
                              {formatDDMMYYYY(row.end_date)}
                            </td>
                            <td className="px-3 py-2 border-b border-[var(--border)]">
                              <StatusChecks row={row} />
                            </td>
                            <td className="px-3 py-2 border-b border-[var(--border)] text-right">
                              <div className="flex items-center justify-end gap-2">
                                {(() => {
                                  const actionBtn =
                                    'group inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/40 hover:text-[var(--brand)] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-gray-200 disabled:hover:text-gray-600 text-xs font-medium';
                                  const actionIcon = 'w-3 h-3 shrink-0';
                                  const actionText = 'max-w-0 overflow-hidden group-hover:max-w-[8rem] transition-all duration-200 whitespace-nowrap';
                                  const canResubmit =
                                    row.status !== 'locked' &&
                                    (Number((row as unknown as { submission_count?: number }).submission_count ?? 0) > 0 || !!row.submitted_at);
                                  return (
                                    <>
                                      <button type="button" className={actionBtn} onClick={() => void handleOpen(row)} title="Open">
                                        <ExternalLink className={actionIcon} />
                                        <span className={actionText}>Open</span>
                                      </button>
                                      <button type="button" className={actionBtn} onClick={() => void handleCopyLink(row)} title="Copy link">
                                        <Copy className={actionIcon} />
                                        <span className={actionText}>Copy link</span>
                                      </button>
                                      <button type="button" className={actionBtn} onClick={() => openEditDates(row)} title="Edit dates">
                                        <CalendarDays className={actionIcon} />
                                        <span className={actionText}>Edit dates</span>
                                      </button>
                                      {canResubmit ? (
                                        <button
                                          type="button"
                                          className={actionBtn}
                                          onClick={async () => {
                                            setManagingId(row.id);
                                            await allowStudentResubmission(row.id);
                                            setManagingId(null);
                                            await loadAssessments(currentPage);
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
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!assessmentsLoading && totalRows > PAGE_SIZE && (
                  <div className="mt-3">
                    <AdminListPagination
                      placement="bottom"
                      totalItems={totalRows}
                      pageSize={PAGE_SIZE}
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      itemLabel="assessments"
                    />
                  </div>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!editDatesRow}
        onClose={() => {
          if (savingDates) return;
          setEditDatesRow(null);
        }}
        title="Edit assessment dates"
        size="md"
      >
        {editDatesRow && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Update dates for <strong>{student?.email ?? 'student'}</strong> — <strong>{editDatesRow.form_name}</strong>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700">Start date</span>
                <DatePicker value={editDatesStart} onChange={(v) => setEditDatesStart(v || '')} className="mt-1 max-w-[200px]" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700">End date</span>
                <DatePicker value={editDatesEnd} onChange={(v) => setEditDatesEnd(v || '')} className="mt-1 max-w-[200px]" />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditDatesRow(null)} disabled={savingDates}>
                Cancel
              </Button>
              <Button onClick={handleSaveDates} disabled={savingDates || !editDatesStart.trim() || !editDatesEnd.trim()}>
                {savingDates ? <Loader variant="dots" size="sm" inline className="mr-2" /> : null}
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>

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
                await loadAssessments(currentPage);
                toast.success(`Assessment updated. ${res.created} created, ${res.updated} updated.`);
              }}
              disabled={adding || addFormsLoading || addForms.length === 0 || !addFormId || (courses.length > 0 && !addCourseId)}
            >
              {adding ? <Loader variant="dots" size="sm" inline className="mr-2" /> : null}
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

