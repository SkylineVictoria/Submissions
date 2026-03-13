import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Send, Mail, Phone, Pencil, Key, Link } from 'lucide-react';
import { listStudentsPaged, createStudent, updateStudent, createFormInstance, getInstanceForStudentAndForm, listForms, listBatchesPaged, listStudentsInBatch, setStudentPassword, listCoursesPaged, getFormsForCourse, listFormsPaged } from '../lib/formEngine';
import { buildStudentEmailFromLocal, getStudentEmailLocalPart, STUDENT_DOMAIN } from '../lib/emailUtils';
import type { Student } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { SelectAsync } from '../components/ui/SelectAsync';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

export const AdminStudentsPage: React.FC = () => {
  const PAGE_SIZE = 20;
  const [students, setStudents] = useState<Student[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalStudents, setTotalStudents] = useState(0);
  const [rowFormMap, setRowFormMap] = useState<Record<number, string>>({});
  const [sending, setSending] = useState<number | null>(null);
  const [sendingBatch, setSendingBatch] = useState(false);
  const [sendToBatchFormId, setSendToBatchFormId] = useState('');
  const [sendToBatchBatchId, setSendToBatchBatchId] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [filteredForms, setFilteredForms] = useState<Form[]>([]);
  const [hasBatches, setHasBatches] = useState(false);
  const [setPasswordStudentId, setSetPasswordStudentId] = useState<number | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);
  const [studentDraft, setStudentDraft] = useState({
    student_id: '',
    first_name: '',
    last_name: '',
    email_local: '',
    phone: '',
    batch_id: '',
    password: '',
  });

  const digitsOnly = (val: string) => val.replace(/\D/g, '');
  const validateCreateStudentForm = (form: {
    student_id: string;
    first_name: string;
    last_name: string;
    email_local: string;
    phone: string;
    batch_id?: string;
    password?: string;
  }): string | null => {
    const requiredFields: Array<[string, string]> = [
      ['student_id', 'Student ID'],
      ['first_name', 'First name'],
      ['last_name', 'Last name'],
      ['phone', 'Phone'],
      ['batch_id', 'Batch'],
      ['password', 'Password'],
    ];
    for (const [key, label] of requiredFields) {
      if (!String((form as Record<string, unknown>)[key] ?? '').trim()) return `${label} is required.`;
    }
    const email = buildStudentEmailFromLocal(form.email_local?.trim() || form.student_id);
    if (!email) return 'Email local part (or Student ID) is required.';
    if (/\s/.test(form.student_id.trim())) return 'Student ID cannot contain spaces.';
    if (!/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits.';
    if (form.password && form.password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  };

  useEffect(() => {
    listForms('published').then((f) => setForms(f));
  }, []);
  useEffect(() => {
    listBatchesPaged(1, 1).then((res) => setHasBatches(res.total > 0));
  }, []);

  useEffect(() => {
    if (!courseFilter) {
      setFilteredForms([]);
      return;
    }
    const cid = Number(courseFilter);
    if (!Number.isFinite(cid)) return;
    getFormsForCourse(cid).then((f) => setFilteredForms(f.filter((form) => form.status === 'published')));
  }, [courseFilter]);

  const displayForms = courseFilter ? filteredForms : forms;

  const loadBatchesOptions = useCallback(async (page: number, search: string) => {
    const res = await listBatchesPaged(page, 20, search || undefined);
    return {
      options: res.data.map((b) => ({ value: String(b.id), label: b.name })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const loadCoursesOptions = useCallback(async (page: number, search: string) => {
    const res = await listCoursesPaged(page, 20, search || undefined);
    const opts = res.data.map((c) => ({ value: String(c.id), label: c.name }));
    const withAll = page === 1 && !search?.trim() ? [{ value: '', label: 'All courses' }, ...opts] : opts;
    return { options: withAll, hasMore: page * 20 < res.total };
  }, []);

  const loadFormsOptions = useCallback(
    async (page: number, search: string) => {
      if (courseFilter) {
        const cid = Number(courseFilter);
        if (!Number.isFinite(cid)) return { options: [], hasMore: false };
        const formsForCourse = await getFormsForCourse(cid);
        const published = formsForCourse.filter((f) => f.status === 'published');
        const filtered = search?.trim()
          ? published.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
          : published;
        return {
          options: filtered.map((f) => ({ value: String(f.id), label: `${f.name} (${f.version ?? '1.0.0'})` })),
          hasMore: false,
        };
      }
      const res = await listFormsPaged(page, 20, 'published', undefined, search || undefined);
      return {
        options: res.data.map((f) => ({ value: String(f.id), label: `${f.name} (${f.version ?? '1.0.0'})` })),
        hasMore: page * 20 < res.total,
      };
    },
    [courseFilter]
  );

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await listStudentsPaged(currentPage, PAGE_SIZE, searchTerm);
      setStudents(res.data);
      setTotalStudents(res.total);
      setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [currentPage, searchTerm]);

  useEffect(() => {
    if (displayForms.length === 0 || students.length === 0) return;
    const firstFormId = String(displayForms[0].id);
    setRowFormMap((prev) => {
      const next = { ...prev };
      for (const st of students) {
        if (!next[st.id]) next[st.id] = firstFormId;
      }
      return next;
    });
  }, [displayForms, students]);

  const handleCreate = async () => {
    const formError = validateCreateStudentForm(studentDraft);
    if (formError) {
      toast.error(formError);
      return;
    }
    setCreating(true);
    const batchId = Number(studentDraft.batch_id);
    if (!batchId || !Number.isFinite(batchId)) {
      toast.error('Select a batch');
      return;
    }
    const email = buildStudentEmailFromLocal(studentDraft.email_local?.trim() || studentDraft.student_id);
    const created = await createStudent({
      student_id: studentDraft.student_id,
      first_name: studentDraft.first_name,
      last_name: studentDraft.last_name,
      phone: studentDraft.phone,
      email,
      batch_id: batchId,
    });
    if (created) {
      if (studentDraft.password.trim().length >= 6) {
        await setStudentPassword(created.id, studentDraft.password);
      }
      setCurrentPage(1);
      const res = await listStudentsPaged(1, PAGE_SIZE, searchTerm);
      setStudents(res.data);
      setTotalStudents(res.total);
      setStudentDraft({
        student_id: '',
        first_name: '',
        last_name: '',
        email_local: '',
        phone: '',
        batch_id: '',
        password: '',
      });
      setIsCreateOpen(false);
      toast.success('Student added');
    } else {
      toast.error('Failed to add student');
    }
    setCreating(false);
  };

  const handleSendForm = async (studentId: number) => {
    const formId = Number(rowFormMap[studentId]);
    if (!formId) return;
    setSending(studentId);
    const existing = await getInstanceForStudentAndForm(formId, studentId);
    if (!existing) {
      await createFormInstance(formId, 'student', studentId);
    }
    setSending(null);
    const url = `${window.location.origin}/forms/${formId}/student-access`;
    await navigator.clipboard.writeText(url);
    toast.success(existing ? 'Student already has this form. Generic link copied.' : 'Secure student form link copied! Share with student.');
  };

  const handleSetPassword = async () => {
    if (!setPasswordStudentId || !passwordDraft.trim() || passwordDraft.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    setSettingPassword(true);
    const res = await setStudentPassword(setPasswordStudentId, passwordDraft);
    setSettingPassword(false);
    if (res.success) {
      setSetPasswordStudentId(null);
      setPasswordDraft('');
      toast.success(res.message);
    } else {
      toast.error(res.message);
    }
  };

  const handleCopyGenericLink = () => {
    const formId = sendToBatchFormId || (displayForms[0] ? String(displayForms[0].id) : '');
    if (!formId) {
      toast.error('Select a form first.');
      return;
    }
    const url = `${window.location.origin}/forms/${formId}/student-access`;
    navigator.clipboard.writeText(url);
    toast.success('Generic student access link copied. Share with students—they enter email and password.');
  };

  const handleSendToBatch = async () => {
    const formId = Number(sendToBatchFormId);
    const batchId = Number(sendToBatchBatchId);
    if (!formId || !batchId) {
      toast.error('Select form and batch');
      return;
    }
    setSendingBatch(true);
    const batchStudents = await listStudentsInBatch(batchId);
    let created = 0;
    let skipped = 0;
    for (const s of batchStudents) {
      const existing = await getInstanceForStudentAndForm(formId, s.id);
      if (existing) {
        skipped++;
      } else {
        const inst = await createFormInstance(formId, 'student', s.id);
        if (inst) created++;
      }
    }
    setSendingBatch(false);
    if (created > 0 || skipped > 0) {
      const url = `${window.location.origin}/forms/${formId}/student-access`;
      await navigator.clipboard.writeText(url);
      const msg = skipped > 0
        ? `Form sent to ${created} students. ${skipped} already had this form. Generic link copied—students use email and password.`
        : `Form sent to ${created} students. Generic link copied—students use email and password.`;
      toast.success(msg);
    } else if (batchStudents.length === 0) {
      toast.error('No students in this batch');
    } else {
      toast.error('Failed to send form');
    }
  };

  const editingStudent = useMemo(() => (editingId ? students.find((s) => s.id === editingId) : null), [editingId, students]);
  const [editForm, setEditForm] = useState<{
    student_id: string;
    first_name: string;
    last_name: string;
    email_local: string;
    phone: string;
    batch_id: string;
  } | null>(null);

  useEffect(() => {
    if (editingStudent) {
      setEditForm({
        student_id: editingStudent.student_id ?? '',
        first_name: editingStudent.first_name ?? '',
        last_name: editingStudent.last_name ?? '',
        email_local: getStudentEmailLocalPart(editingStudent.email || editingStudent.student_id || ''),
        phone: editingStudent.phone ?? '',
        batch_id: editingStudent.batch_id != null ? String(editingStudent.batch_id) : '',
      });
    } else {
      setEditForm(null);
    }
  }, [editingStudent]);

  const handleSaveEdit = async () => {
    if (!editingId || !editForm) return;
    const formError = validateCreateStudentForm(editForm);
    if (formError) {
      toast.error(formError);
      return;
    }
    const batchId = Number(editForm.batch_id);
    if (!batchId || !Number.isFinite(batchId)) {
      toast.error('Select a batch');
      return;
    }
    setSavingEdit(true);
    const email = buildStudentEmailFromLocal(editForm.email_local?.trim() || editForm.student_id);
    const updated = await updateStudent(editingId, {
      student_id: editForm.student_id,
      first_name: editForm.first_name,
      last_name: editForm.last_name,
      phone: editForm.phone,
      email,
      batch_id: batchId,
    });
    setSavingEdit(false);
    if (updated) {
      const res = await listStudentsPaged(currentPage, PAGE_SIZE, searchTerm);
      setStudents(res.data);
      setTotalStudents(res.total);
      setEditingId(null);
      toast.success('Student updated');
    } else {
      toast.error('Failed to update student');
    }
  };

  const validateEditStudentForm = (form: {
    student_id: string;
    first_name: string;
    last_name: string;
    email_local: string;
    phone: string;
    batch_id?: string;
  }): string | null => {
    if (!form.student_id?.trim()) return 'Student ID is required.';
    if (!form.first_name?.trim()) return 'First name is required.';
    if (!form.last_name?.trim()) return 'Last name is required.';
    if (!buildStudentEmailFromLocal(form.email_local?.trim() || form.student_id)) return 'Email local part is required.';
    if (!form.phone?.trim()) return 'Phone is required.';
    if (!/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits.';
    if (!form.batch_id) return 'Batch is required.';
    return null;
  };

  const createFormError = useMemo(() => validateCreateStudentForm(studentDraft), [studentDraft]);
  const editFormError = useMemo(() => (editForm ? validateEditStudentForm(editForm) : null), [editForm]);
  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Students</h2>
              <div className="text-sm text-gray-600 mt-1">
              <p>Manage learner profiles and send form links. Students must be in a batch.</p>
              {!hasBatches && <p className="text-amber-600 mt-1">Create batches first (Batches page).</p>}
            </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search by name, email, phone, city..."
                className="w-full md:w-72"
              />
              <Button onClick={() => setIsCreateOpen(true)} className="min-w-[160px]" disabled={!hasBatches}>
                <Plus className="w-4 h-4 mr-2 inline" />
                Add Student
              </Button>
            </div>
          </div>
        </Card>

        <Card className="mb-6">
          <h3 className="text-base font-semibold text-[var(--text)] mb-3">Send form to batch</h3>
          <p className="text-sm text-gray-600 mb-4">
            Send a form to all students in a batch. Students who already have this form are skipped.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Course</label>
              <SelectAsync
                value={courseFilter}
                onChange={(v) => {
                  setCourseFilter(v);
                  setSendToBatchFormId('');
                }}
                loadOptions={loadCoursesOptions}
                placeholder="All courses"
                selectedLabel={!courseFilter ? 'All courses' : undefined}
                className="w-full"
              />
            </div>
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Form</label>
              <SelectAsync
                value={sendToBatchFormId}
                onChange={(v) => setSendToBatchFormId(v)}
                loadOptions={loadFormsOptions}
                placeholder="Select form"
                className="w-full"
              />
            </div>
            <div className="min-w-[200px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Batch</label>
              <SelectAsync
                value={sendToBatchBatchId}
                onChange={(v) => setSendToBatchBatchId(v)}
                loadOptions={loadBatchesOptions}
                placeholder="Select batch"
                className="w-full"
              />
            </div>
            <Button
              onClick={handleSendToBatch}
              disabled={sendingBatch || !sendToBatchFormId || !sendToBatchBatchId || displayForms.length === 0}
            >
              {sendingBatch ? (
                <>
                  <Loader variant="dots" size="sm" inline className="mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2 inline" />
                  Send to batch
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleCopyGenericLink}
              disabled={displayForms.length === 0}
              title="Copy generic link for students to login with email/password"
            >
              <Link className="w-4 h-4 mr-2 inline" />
              Copy generic link
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Generic link: students enter email + password to access. Set each student&apos;s password first (Password button).
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-[var(--text)] mb-4">Student Directory</h2>
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading students..." />
            </div>
          ) : students.length === 0 ? (
            <p className="text-gray-500">No students found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1000px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Student</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Batch</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Contact</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Form</th>
                    <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <tr key={student.id} className="hover:bg-gray-50 align-top">
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-orange-100 text-orange-700 font-semibold flex items-center justify-center">
                            {`${student.first_name?.[0] ?? ''}${student.last_name?.[0] ?? ''}`.toUpperCase() || (student.first_name?.[0] ?? student.email?.[0] ?? 'S').toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-[var(--text)]">
                              {[student.first_name, student.last_name].filter(Boolean).join(' ') || student.email}
                            </div>
                            <div className="text-xs text-gray-500">Student ID: {student.student_id || '-'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <span className="text-gray-700">{student.batch_name ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-gray-700">
                            <Mail className="w-4 h-4 text-gray-400" />
                            <span>{student.email}</span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-700">
                            <Phone className="w-4 h-4 text-gray-400" />
                            <span>{student.phone || 'No phone'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] w-[320px]">
                        <SelectAsync
                          value={rowFormMap[student.id] || (displayForms[0] ? String(displayForms[0].id) : '')}
                          onChange={(v) => setRowFormMap((prev) => ({ ...prev, [student.id]: v }))}
                          loadOptions={loadFormsOptions}
                          placeholder="Select form"
                          selectedLabel={
                            (() => {
                              const fid = rowFormMap[student.id] || (displayForms[0] ? String(displayForms[0].id) : '');
                              const f = displayForms.find((x) => String(x.id) === fid);
                              return f ? `${f.name} (${f.version ?? '1.0.0'})` : undefined;
                            })()
                          }
                          className="max-w-[320px]"
                        />
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSetPasswordStudentId(student.id)}
                            className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
                            title="Set password for email/password login"
                          >
                            <Key className="w-4 h-4" />
                            Password
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingId(student.id)}
                            className="inline-flex items-center justify-center gap-1.5 min-w-[96px] whitespace-nowrap"
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSendForm(student.id)}
                            disabled={sending !== null || displayForms.length === 0}
                            className="inline-flex items-center justify-center gap-1.5 min-w-[110px] whitespace-nowrap"
                          >
                            <Send className="w-4 h-4" />
                            {sending === student.id ? 'Creating...' : 'Send form'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!loading && totalStudents > PAGE_SIZE && (
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="text-xs text-gray-500">Page {currentPage} of {totalPages} ({totalStudents} total)</div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Add Student" size="lg">
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              value={studentDraft.student_id}
              onChange={(e) => {
                const v = e.target.value;
                setStudentDraft((p) => {
                  const syncEmail = !p.email_local || p.email_local === p.student_id;
                  return { ...p, student_id: v, email_local: syncEmail ? v : p.email_local };
                });
              }}
              placeholder="Student ID *"
              required
            />
            <Input
              value={studentDraft.first_name}
              onChange={(e) => setStudentDraft((p) => ({ ...p, first_name: e.target.value }))}
              placeholder="First name *"
              required
            />
            <Input
              value={studentDraft.last_name}
              onChange={(e) => setStudentDraft((p) => ({ ...p, last_name: e.target.value }))}
              placeholder="Last name"
              required
            />
            <div className="space-y-1 md:col-span-2">
              <label className="block text-xs font-medium text-gray-600">Email (editable, @{STUDENT_DOMAIN.slice(1)} fixed)</label>
              <div className="flex items-center gap-1 rounded border border-[var(--border)] overflow-hidden">
                <Input
                  value={studentDraft.email_local || studentDraft.student_id}
                  onChange={(e) => setStudentDraft((p) => ({ ...p, email_local: e.target.value.replace(/\s/g, '').toLowerCase() }))}
                  placeholder="Student ID or e.g. firstname.lastname"
                  className="border-0 rounded-none focus:ring-0"
                />
                <span className="px-3 py-2 bg-gray-100 text-gray-600 text-sm shrink-0">@{STUDENT_DOMAIN.slice(1)}</span>
              </div>
            </div>
            <Input
              value={studentDraft.phone}
              onChange={(e) => setStudentDraft((p) => ({ ...p, phone: digitsOnly(e.target.value).slice(0, 10) }))}
              placeholder="Phone"
              required
            />
            <Input
              type="password"
              value={studentDraft.password}
              onChange={(e) => setStudentDraft((p) => ({ ...p, password: e.target.value }))}
              placeholder="Password * (min 6 characters)"
              autoComplete="new-password"
              required
            />
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Batch *</label>
              <SelectAsync
                value={studentDraft.batch_id}
                onChange={(v) => setStudentDraft((p) => ({ ...p, batch_id: v }))}
                loadOptions={loadBatchesOptions}
                placeholder="Select batch"
                className="w-full"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !!createFormError || !studentDraft.batch_id || (studentDraft.password?.length ?? 0) < 6}>
              {creating ? (
                <>
                  <Loader variant="dots" size="sm" inline className="mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2 inline" />
                  Add Student
                </>
              )}
            </Button>
          </div>
        </div>
      </Modal>

      {editingId && editForm && (
        <Modal isOpen={!!editingId} onClose={() => setEditingId(null)} title="Edit Student" size="lg">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                value={editForm.student_id}
                onChange={(e) => setEditForm((p) => p ? { ...p, student_id: e.target.value } : p)}
                placeholder="Student ID *"
                required
              />
              <Input
                value={editForm.first_name}
                onChange={(e) => setEditForm((p) => p ? { ...p, first_name: e.target.value } : p)}
                placeholder="First name *"
                required
              />
              <Input
                value={editForm.last_name}
                onChange={(e) => setEditForm((p) => p ? { ...p, last_name: e.target.value } : p)}
                placeholder="Last name"
                required
              />
              <div className="space-y-1 md:col-span-2">
                <label className="block text-xs font-medium text-gray-600">Email (editable, @{STUDENT_DOMAIN.slice(1)} fixed)</label>
                <div className="flex items-center gap-1 rounded border border-[var(--border)] overflow-hidden">
                  <Input
                    value={editForm?.email_local ?? ''}
                    onChange={(e) => setEditForm((p) => p ? { ...p, email_local: e.target.value.replace(/\s/g, '').toLowerCase() } : p)}
                    placeholder="Student ID or e.g. firstname.lastname"
                    className="border-0 rounded-none focus:ring-0"
                  />
                  <span className="px-3 py-2 bg-gray-100 text-gray-600 text-sm shrink-0">@{STUDENT_DOMAIN.slice(1)}</span>
                </div>
              </div>
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm((p) => p ? { ...p, phone: digitsOnly(e.target.value).slice(0, 10) } : p)}
                placeholder="Phone"
                required
              />
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Batch *</label>
                <SelectAsync
                  value={editForm.batch_id}
                  onChange={(v) => setEditForm((p) => (p ? { ...p, batch_id: v } : p))}
                  loadOptions={loadBatchesOptions}
                  placeholder="Select batch"
                  selectedLabel={editingStudent?.batch_name ?? undefined}
                  className="w-full"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit || !!editFormError || !editForm.batch_id}>
                {savingEdit ? (
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
      )}

      {setPasswordStudentId && (
        <Modal
          isOpen={!!setPasswordStudentId}
          onClose={() => {
            setSetPasswordStudentId(null);
            setPasswordDraft('');
          }}
          title="Set Student Password"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Set a password for this student. They will use their email and this password to access the form via the generic link.
            </p>
            <Input
              type="password"
              label="Password (min 6 characters)"
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSetPasswordStudentId(null);
                  setPasswordDraft('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSetPassword}
                disabled={settingPassword || passwordDraft.length < 6}
              >
                {settingPassword ? (
                  <>
                    <Loader variant="dots" size="sm" inline className="mr-2" />
                    Setting...
                  </>
                ) : (
                  'Set Password'
                )}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
