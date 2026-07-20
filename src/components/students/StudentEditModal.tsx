import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listBatchesPaged,
  listCoursesPaged,
  listStudentCourseEnrollments,
  setStudentCourses,
  updateStudent,
  type Student,
  type StudentCourseEnrollmentStatus,
} from '../../lib/formEngine';
import {
  buildEmailFromLocalAndDomain,
  getEmailLocalPartForEdit,
  getInstitutionalDomainFromEmail,
  STUDENT_DOMAIN,
  type InstitutionalDomain,
} from '../../lib/emailUtils';
import {
  COURSE_LIFECYCLE_LABELS,
  defaultStatusForNewCourseEnrollment,
  normalizeCourseLifecycleStatus,
} from '../../lib/courseLifecycle';
import { CourseLifecycleBadge } from './CourseLifecycleBadge';
import { DatePicker } from '../ui/DatePicker';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { EmailWithDomainPicker } from '../ui/EmailWithDomainPicker';
import { Select } from '../ui/Select';
import { SelectAsync } from '../ui/SelectAsync';
import { MultiSelectAsync } from '../ui/MultiSelectAsync';
import { Modal } from '../ui/Modal';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
] as const;

const digitsOnly = (val: string) => val.replace(/\D/g, '');

type EditFormState = {
  student_id: string;
  first_name: string;
  last_name: string;
  email_local: string;
  email_domain: InstitutionalDomain;
  phone: string;
  batch_id: string;
  course_ids: number[];
  status: string;
};

type EnrollmentDraft = {
  name: string;
  qualification_code: string | null;
  start_date: string;
  end_date: string;
  enrollment_status: StudentCourseEnrollmentStatus;
};

function validateEditStudentForm(form: {
  student_id: string;
  first_name: string;
  last_name: string;
  email_local: string;
  phone: string;
  batch_id?: string;
  course_ids?: number[];
  email_domain?: InstitutionalDomain;
}): string | null {
  if (!String(form.student_id ?? '').trim()) return 'Student ID is required.';
  if (!String(form.first_name ?? '').trim()) return 'First name is required.';
  const courseIds = Array.isArray(form.course_ids) ? form.course_ids : [];
  if (courseIds.filter((n) => Number.isFinite(Number(n)) && Number(n) > 0).length === 0) {
    return 'Select at least one course.';
  }
  const email = buildEmailFromLocalAndDomain(
    form.email_local?.trim() || form.student_id,
    form.email_domain ?? STUDENT_DOMAIN
  );
  if (!email) return 'Email local part (or Student ID) is required.';
  if (/\s/.test((form.student_id ?? '').trim())) return 'Student ID cannot contain spaces.';
  if (form.phone && !/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits when provided.';
  return null;
}

export type StudentEditModalProps = {
  student: Student | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (updated: Student) => void;
};

export const StudentEditModal: React.FC<StudentEditModalProps> = ({ student, isOpen, onClose, onSaved }) => {
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editCourseLoading, setEditCourseLoading] = useState(false);
  const [editEnrollmentDrafts, setEditEnrollmentDrafts] = useState<Record<number, EnrollmentDraft>>({});
  const [saving, setSaving] = useState(false);

  const loadCoursesOptions = useCallback(async (page: number, search: string) => {
    const res = await listCoursesPaged(page, 20, search || undefined);
    return {
      options: res.data.map((c) => ({
        value: c.id,
        label: c.qualification_code?.trim() ? `${c.qualification_code} — ${c.name}` : c.name,
      })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const loadBatchesOptionsWithNone = useCallback(async (page: number, search: string) => {
    const res = await listBatchesPaged(page, 20, search || undefined);
    const opts = res.data.map((b) => ({ value: String(b.id), label: b.name }));
    const withNone = page === 1 && !search?.trim() ? [{ value: '', label: 'No batch' }, ...opts] : opts;
    return { options: withNone, hasMore: page * 20 < res.total };
  }, []);

  useEffect(() => {
    if (!isOpen || !student) {
      setEditForm(null);
      setEditEnrollmentDrafts({});
      return;
    }
    const email = student.email || student.student_id || '';
    const domain = getInstitutionalDomainFromEmail(email) ?? STUDENT_DOMAIN;
    setEditForm({
      student_id: student.student_id ?? '',
      first_name: student.first_name ?? '',
      last_name: student.last_name ?? '',
      email_local: getEmailLocalPartForEdit(email),
      email_domain: domain,
      phone: student.phone ?? '',
      batch_id: student.batch_id != null ? String(student.batch_id) : '',
      course_ids: [],
      status: student.status ?? 'active',
    });
    setEditEnrollmentDrafts({});
  }, [isOpen, student]);

  useEffect(() => {
    if (!isOpen || !student?.id) return;
    setEditCourseLoading(true);
    void listStudentCourseEnrollments(student.id)
      .then((enrollments) => {
        const ids = enrollments.map((e) => e.course_id);
        const drafts: Record<number, EnrollmentDraft> = {};
        for (const e of enrollments) {
          drafts[e.course_id] = {
            name: e.name,
            qualification_code: e.qualification_code,
            start_date: e.start_date ?? '',
            end_date: e.end_date ?? '',
            enrollment_status: e.enrollment_status,
          };
        }
        setEditEnrollmentDrafts(drafts);
        setEditForm((p) => (p ? { ...p, course_ids: Array.from(new Set(ids)) } : p));
      })
      .finally(() => setEditCourseLoading(false));
  }, [isOpen, student?.id]);

  const editFormError = useMemo(() => (editForm ? validateEditStudentForm(editForm) : null), [editForm]);

  const handleSave = async () => {
    if (!student?.id || !editForm) return;
    const formError = validateEditStudentForm(editForm);
    if (formError) {
      toast.error(formError);
      return;
    }
    const batchId = editForm.batch_id ? Number(editForm.batch_id) || null : null;
    setSaving(true);
    const email = buildEmailFromLocalAndDomain(
      editForm.email_local?.trim() || editForm.student_id,
      editForm.email_domain
    );
    let updated: Student | null = null;
    try {
      updated = await updateStudent(student.id, {
        student_id: editForm.student_id,
        first_name: editForm.first_name,
        last_name: editForm.last_name || undefined,
        phone: editForm.phone || undefined,
        email,
        status: editForm.status,
      });
      if (updated) {
        const hasInProgress = Object.entries(editEnrollmentDrafts).some(
          ([cid, d]) => editForm.course_ids.includes(Number(cid)) && d.enrollment_status === 'in_progress'
        );
        const courseRes = await setStudentCourses(updated.id, editForm.course_ids, {
          cancelInsteadOfDelete: true,
          enrollments: editForm.course_ids.map((courseId) => {
            const d = editEnrollmentDrafts[courseId];
            return {
              course_id: courseId,
              start_date: d?.start_date || null,
              end_date: d?.end_date || null,
              enrollment_status: defaultStatusForNewCourseEnrollment({
                hasInProgress,
                startDate: d?.start_date || null,
                endDate: d?.end_date || null,
                explicitStatus: d?.enrollment_status ?? null,
              }),
            };
          }),
        });
        if (!courseRes.ok) {
          setSaving(false);
          toast.error(courseRes.error ?? 'Could not update course enrolments');
          return;
        }
        if (batchId != null) {
          const withBatch = await updateStudent(updated.id, { batch_id: batchId });
          if (!withBatch) {
            setSaving(false);
            toast.error(
              'Student could not be added to this batch. Ensure the batch course can be enrolled (or enrol the student in that course first).'
            );
            return;
          }
          updated = withBatch;
        } else {
          const cleared = await updateStudent(updated.id, { batch_id: null });
          if (cleared) updated = cleared;
        }
      }
    } catch (e) {
      setSaving(false);
      toast.error(e instanceof Error && e.message ? e.message : 'Could not save student');
      return;
    }
    setSaving(false);
    if (updated) {
      onSaved?.(updated);
      onClose();
      toast.success('Student updated');
    } else {
      toast.error('Failed to update student');
    }
  };

  if (!isOpen || !editForm) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Student" size="lg">
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Input
            value={editForm.student_id}
            onChange={(e) => setEditForm((p) => (p ? { ...p, student_id: e.target.value } : p))}
            placeholder="Student ID *"
            required
          />
          <Input
            value={editForm.first_name}
            onChange={(e) => setEditForm((p) => (p ? { ...p, first_name: e.target.value } : p))}
            placeholder="First name *"
            required
          />
          <Input
            value={editForm.last_name}
            onChange={(e) => setEditForm((p) => (p ? { ...p, last_name: e.target.value } : p))}
            placeholder="Last name"
          />
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Course *</label>
            <MultiSelectAsync
              value={editForm.course_ids}
              onChange={(vals) => {
                setEditForm((p) => (p ? { ...p, course_ids: vals } : p));
                setEditEnrollmentDrafts((prev) => {
                  const next = { ...prev };
                  const hasInProgress = Object.entries(next).some(
                    ([cid, d]) => vals.includes(Number(cid)) && d.enrollment_status === 'in_progress'
                  );
                  for (const id of vals) {
                    if (!next[id]) {
                      next[id] = {
                        name: `Course #${id}`,
                        qualification_code: null,
                        start_date: '',
                        end_date: '',
                        enrollment_status: defaultStatusForNewCourseEnrollment({
                          hasInProgress,
                          startDate: '',
                          endDate: '',
                        }),
                      };
                    }
                  }
                  return next;
                });
              }}
              loadOptions={loadCoursesOptions}
              placeholder={editCourseLoading ? 'Loading courses…' : 'Select course(s)'}
              className="w-full"
            />
            <p className="text-xs text-gray-500 mt-1">
              Each course has its own start/end dates and lifecycle status. Without dates, new courses start as Tentative.
              Set dates before changing status to In Progress. Deselecting a course cancels/deactivates it — assessments
              are not deleted.
            </p>
            {editForm.course_ids.length > 0 ? (
              <div className="mt-3 space-y-3">
                {editForm.course_ids.map((cid) => {
                  const d = editEnrollmentDrafts[cid];
                  if (!d) return null;
                  return (
                    <div key={cid} className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-800">
                          {d.qualification_code ? `${d.qualification_code} — ${d.name}` : d.name}
                        </p>
                        <CourseLifecycleBadge status={d.enrollment_status} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">Course start date</label>
                          <DatePicker
                            value={d.start_date}
                            onChange={(v) =>
                              setEditEnrollmentDrafts((prev) => ({
                                ...prev,
                                [cid]: { ...prev[cid], start_date: v || '' },
                              }))
                            }
                            compact
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">Course end date</label>
                          <DatePicker
                            value={d.end_date}
                            onChange={(v) =>
                              setEditEnrollmentDrafts((prev) => ({
                                ...prev,
                                [cid]: { ...prev[cid], end_date: v || '' },
                              }))
                            }
                            compact
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-gray-600 mb-1">Course status</label>
                          <select
                            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                            value={d.enrollment_status}
                            onChange={(e) => {
                              const nextStatus = normalizeCourseLifecycleStatus(e.target.value);
                              if (!nextStatus) return;
                              setEditEnrollmentDrafts((prev) => ({
                                ...prev,
                                [cid]: { ...prev[cid], enrollment_status: nextStatus },
                              }));
                            }}
                          >
                            {Object.entries(COURSE_LIFECYCLE_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <EmailWithDomainPicker
              label="Email"
              localPart={editForm.email_local}
              onLocalPartChange={(v) => setEditForm((p) => (p ? { ...p, email_local: v } : p))}
              domain={editForm.email_domain}
              onDomainChange={(d) => setEditForm((p) => (p ? { ...p, email_domain: d } : p))}
              placeholder="Student ID or e.g. firstname.lastname"
            />
          </div>
          <Input
            value={editForm.phone}
            onChange={(e) => setEditForm((p) => (p ? { ...p, phone: digitsOnly(e.target.value).slice(0, 10) } : p))}
            placeholder="Phone"
          />
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Batch</label>
            <SelectAsync
              value={editForm.batch_id}
              onChange={(v) => setEditForm((p) => (p ? { ...p, batch_id: v } : p))}
              loadOptions={loadBatchesOptionsWithNone}
              placeholder="Select batch (optional)"
              selectedLabel={student?.batch_name ?? undefined}
              className="w-full"
            />
          </div>
          <div className="md:col-span-2">
            <Select
              value={editForm.status}
              onChange={(v) => setEditForm((p) => (p ? { ...p, status: v as 'active' | 'inactive' } : p))}
              options={[...STATUS_OPTIONS]}
              label="Status"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || !!editFormError}>
            {saving ? (
              <>
                <Loader variant="dots" size="sm" inline className="mr-2" />
                Saving...
              </>
            ) : (
              'Save changes'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
