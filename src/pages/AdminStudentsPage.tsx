import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Send, Mail, Phone, Pencil } from 'lucide-react';
import { listStudentsPaged, createStudent, updateStudent, createFormInstance, listForms, issueInstanceAccessLink } from '../lib/formEngine';
import type { Student } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
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
  const [studentDraft, setStudentDraft] = useState({
    student_id: '',
    first_name: '',
    last_name: '',
    phone: '',
  });

  const digitsOnly = (val: string) => val.replace(/\D/g, '');
  const buildStudentEmail = (studentId: string) => `${studentId.trim().toLowerCase()}@student.slit.edu.au`;

  const validateCreateStudentForm = (form: {
    student_id: string;
    first_name: string;
    last_name: string;
    phone: string;
  }): string | null => {
    const requiredFields: Array<[string, string]> = [
      ['student_id', 'Student ID'],
      ['first_name', 'First name'],
      ['last_name', 'Last name'],
      ['phone', 'Phone'],
    ];
    for (const [key, label] of requiredFields) {
      if (!String((form as Record<string, unknown>)[key] ?? '').trim()) return `${label} is required.`;
    }
    if (/\s/.test(form.student_id.trim())) return 'Student ID cannot contain spaces.';
    if (!/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits.';
    if (!/^\S+@\S+\.\S+$/.test(buildStudentEmail(form.student_id))) return 'Generated student email is invalid.';
    return null;
  };

  useEffect(() => {
    listForms('published').then((f) => {
      setForms(f);
    });
  }, []);

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
    if (forms.length === 0 || students.length === 0) return;
    const firstFormId = String(forms[0].id);
    setRowFormMap((prev) => {
      const next = { ...prev };
      for (const st of students) {
        if (!next[st.id]) next[st.id] = firstFormId;
      }
      return next;
    });
  }, [forms, students]);

  const formOptions = forms.map((f) => ({ value: String(f.id), label: `${f.name} (${f.version ?? '1.0.0'})` }));
  const generatedStudentEmail = useMemo(() => {
    const id = studentDraft.student_id.trim();
    return id ? buildStudentEmail(id) : '';
  }, [studentDraft.student_id]);

  const handleCreate = async () => {
    const formError = validateCreateStudentForm(studentDraft);
    if (formError) {
      toast.error(formError);
      return;
    }
    setCreating(true);
    const created = await createStudent({
      student_id: studentDraft.student_id,
      first_name: studentDraft.first_name,
      last_name: studentDraft.last_name,
      phone: studentDraft.phone,
      email: buildStudentEmail(studentDraft.student_id),
    });
    if (created) {
      setCurrentPage(1);
      const res = await listStudentsPaged(1, PAGE_SIZE, searchTerm);
      setStudents(res.data);
      setTotalStudents(res.total);
      setStudentDraft({
        student_id: '',
        first_name: '',
        last_name: '',
        phone: '',
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
    const instance = await createFormInstance(formId, 'student', studentId);
    setSending(null);
    if (instance) {
      const secureUrl = await issueInstanceAccessLink(instance.id, 'student');
      if (secureUrl) {
        await navigator.clipboard.writeText(secureUrl);
        toast.success('Secure student form link copied! Share with student.');
      } else {
        toast.error('Failed to create secure access link');
      }
    } else {
      toast.error('Failed to create form link');
    }
  };

  const editingStudent = useMemo(() => (editingId ? students.find((s) => s.id === editingId) : null), [editingId, students]);
  const [editForm, setEditForm] = useState<{
    student_id: string;
    first_name: string;
    last_name: string;
    phone: string;
  } | null>(null);

  useEffect(() => {
    if (editingStudent) {
      setEditForm({
        student_id: editingStudent.student_id ?? '',
        first_name: editingStudent.first_name ?? '',
        last_name: editingStudent.last_name ?? '',
        phone: editingStudent.phone ?? '',
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
    setSavingEdit(true);
    const updated = await updateStudent(editingId, {
      student_id: editForm.student_id,
      first_name: editForm.first_name,
      last_name: editForm.last_name,
      phone: editForm.phone,
      email: buildStudentEmail(editForm.student_id),
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

  const createFormError = useMemo(() => validateCreateStudentForm(studentDraft), [studentDraft]);
  const editFormError = useMemo(() => (editForm ? validateCreateStudentForm(editForm) : 'Student form is unavailable.'), [editForm]);
  const generatedEditEmail = useMemo(() => {
    const id = editForm?.student_id?.trim() || '';
    return id ? buildStudentEmail(id) : '';
  }, [editForm?.student_id]);
  const totalPages = Math.max(1, Math.ceil(totalStudents / PAGE_SIZE));

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Students</h2>
              <p className="text-sm text-gray-600 mt-1">Manage learner profiles and send form links from each row.</p>
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
              <Button onClick={() => setIsCreateOpen(true)} className="min-w-[160px]">
                <Plus className="w-4 h-4 mr-2 inline" />
                Add Student
              </Button>
            </div>
          </div>
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
                        <Select
                          value={rowFormMap[student.id] || (forms[0] ? String(forms[0].id) : '')}
                          onChange={(v) => setRowFormMap((prev) => ({ ...prev, [student.id]: v }))}
                          options={formOptions}
                          className="max-w-[320px]"
                          portal
                        />
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <div className="flex items-center justify-end gap-2">
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
                            disabled={sending !== null || forms.length === 0}
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
              onChange={(e) => setStudentDraft((p) => ({ ...p, student_id: e.target.value }))}
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
            <Input
              value={generatedStudentEmail}
              placeholder="Auto-generated email"
              type="email"
              disabled
            />
            <Input
              value={studentDraft.phone}
              onChange={(e) => setStudentDraft((p) => ({ ...p, phone: digitsOnly(e.target.value).slice(0, 10) }))}
              placeholder="Phone"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating || !!createFormError}>
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
              <Input
                value={generatedEditEmail}
                placeholder="Auto-generated email"
                type="email"
                disabled
              />
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm((p) => p ? { ...p, phone: digitsOnly(e.target.value).slice(0, 10) } : p)}
                placeholder="Phone"
                required
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit || !!editFormError}>
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
    </div>
  );
};
