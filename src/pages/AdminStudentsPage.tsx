import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Send, Mail, Phone, Pencil } from 'lucide-react';
import { listStudentsPaged, createStudent, updateStudent, createFormInstance, listForms, issueInstanceAccessLink } from '../lib/formEngine';
import type { Student } from '../lib/formEngine';
import type { Form } from '../types/database';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { DatePicker } from '../components/ui/DatePicker';
import { Textarea } from '../components/ui/Textarea';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

export const AdminStudentsPage: React.FC = () => {
  const PAGE_SIZE = 20;
  const STATE_OPTIONS = [
    { value: 'NSW', label: 'New South Wales (NSW)' },
    { value: 'VIC', label: 'Victoria (VIC)' },
    { value: 'QLD', label: 'Queensland (QLD)' },
    { value: 'WA', label: 'Western Australia (WA)' },
    { value: 'SA', label: 'South Australia (SA)' },
    { value: 'TAS', label: 'Tasmania (TAS)' },
    { value: 'ACT', label: 'Australian Capital Territory (ACT)' },
    { value: 'NT', label: 'Northern Territory (NT)' },
  ];
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
    email: '',
    phone: '',
    date_of_birth: '',
    status: 'active',
    guardian_name: '',
    guardian_phone: '',
    address_line_1: '',
    address_line_2: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'Australia',
    notes: '',
  });

  const digitsOnly = (val: string) => val.replace(/\D/g, '');
  const validateStudentForm = (form: {
    student_id: string;
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    date_of_birth: string;
    status: string;
    guardian_name: string;
    guardian_phone: string;
    address_line_1: string;
    address_line_2: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    notes: string;
  }): string | null => {
    const requiredFields: Array<[string, string]> = [
      ['student_id', 'Student ID'],
      ['first_name', 'First name'],
      ['last_name', 'Last name'],
      ['email', 'Email'],
      ['phone', 'Phone'],
      ['date_of_birth', 'Date of birth'],
      ['status', 'Status'],
      ['guardian_name', 'Guardian / Emergency contact'],
      ['guardian_phone', 'Guardian phone'],
      ['address_line_1', 'Address line 1'],
      ['address_line_2', 'Address line 2'],
      ['city', 'City'],
      ['state', 'State'],
      ['postal_code', 'Postal code'],
      ['country', 'Country'],
      ['notes', 'Notes'],
    ];
    for (const [key, label] of requiredFields) {
      if (!String((form as Record<string, unknown>)[key] ?? '').trim()) return `${label} is required.`;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return 'Enter a valid email address.';
    if (!/^\d{10}$/.test(form.phone.trim())) return 'Phone must be exactly 10 digits.';
    if (!/^\d{10}$/.test(form.guardian_phone.trim())) return 'Guardian phone must be exactly 10 digits.';
    if (!/^\d+$/.test(form.postal_code.trim())) return 'Postal code must contain numbers only.';
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

  const handleCreate = async () => {
    const formError = validateStudentForm(studentDraft);
    if (formError) {
      toast.error(formError);
      return;
    }
    setCreating(true);
    const created = await createStudent(studentDraft);
    if (created) {
      setCurrentPage(1);
      const res = await listStudentsPaged(1, PAGE_SIZE, searchTerm);
      setStudents(res.data);
      setTotalStudents(res.total);
      setStudentDraft({
        student_id: '',
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        date_of_birth: '',
        status: 'active',
        guardian_name: '',
        guardian_phone: '',
        address_line_1: '',
        address_line_2: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'Australia',
        notes: '',
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
    email: string;
    phone: string;
    date_of_birth: string;
    status: string;
    guardian_name: string;
    guardian_phone: string;
    address_line_1: string;
    address_line_2: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
    notes: string;
  } | null>(null);

  useEffect(() => {
    if (editingStudent) {
      setEditForm({
        student_id: editingStudent.student_id ?? '',
        first_name: editingStudent.first_name ?? '',
        last_name: editingStudent.last_name ?? '',
        email: editingStudent.email,
        phone: editingStudent.phone ?? '',
        date_of_birth: editingStudent.date_of_birth ?? '',
        status: editingStudent.status ?? 'active',
        guardian_name: editingStudent.guardian_name ?? '',
        guardian_phone: editingStudent.guardian_phone ?? '',
        address_line_1: editingStudent.address_line_1 ?? '',
        address_line_2: editingStudent.address_line_2 ?? '',
        city: editingStudent.city ?? '',
        state: editingStudent.state ?? '',
        postal_code: editingStudent.postal_code ?? '',
        country: editingStudent.country ?? 'Australia',
        notes: editingStudent.notes ?? '',
      });
    } else {
      setEditForm(null);
    }
  }, [editingStudent]);

  const editDraft = editForm;

  const handleSaveEdit = async () => {
    if (!editingId || !editForm) return;
    const formError = validateStudentForm(editForm);
    if (formError) {
      toast.error(formError);
      return;
    }
    setSavingEdit(true);
    const updated = await updateStudent(editingId, editForm);
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

  const createFormError = useMemo(() => validateStudentForm(studentDraft), [studentDraft]);
  const editFormError = useMemo(() => (editForm ? validateStudentForm(editForm) : 'Student form is unavailable.'), [editForm]);
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
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Profile</th>
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
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="space-y-1 text-gray-700">
                          <div><span className="text-gray-500">DOB:</span> {student.date_of_birth || '-'}</div>
                          <div><span className="text-gray-500">City:</span> {student.city || '-'}</div>
                          <div className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            {student.status || 'active'}
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
              value={studentDraft.email}
              onChange={(e) => setStudentDraft((p) => ({ ...p, email: e.target.value }))}
              placeholder="Email *"
              type="email"
              required
            />
            <Input
              value={studentDraft.phone}
              onChange={(e) => setStudentDraft((p) => ({ ...p, phone: digitsOnly(e.target.value).slice(0, 10) }))}
              placeholder="Phone"
              required
            />
            <DatePicker
              value={studentDraft.date_of_birth}
              onChange={(v) => setStudentDraft((p) => ({ ...p, date_of_birth: v }))}
              placeholder="Date of birth (dd-mm-yyyy)"
              placement="below"
              fromYear={1960}
              toYear={new Date().getFullYear()}
              disableFuture
              required
            />
            <Select
              value={studentDraft.status}
              onChange={(v) => setStudentDraft((p) => ({ ...p, status: v }))}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'prospect', label: 'Prospect' },
              ]}
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              value={studentDraft.guardian_name}
              onChange={(e) => setStudentDraft((p) => ({ ...p, guardian_name: e.target.value }))}
              placeholder="Guardian / Emergency contact"
              required
            />
            <Input
              value={studentDraft.guardian_phone}
              onChange={(e) => setStudentDraft((p) => ({ ...p, guardian_phone: digitsOnly(e.target.value).slice(0, 10) }))}
              placeholder="Guardian phone"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <Input
              value={studentDraft.address_line_1}
              onChange={(e) => setStudentDraft((p) => ({ ...p, address_line_1: e.target.value }))}
              placeholder="Address line 1"
              required
            />
            <Input
              value={studentDraft.address_line_2}
              onChange={(e) => setStudentDraft((p) => ({ ...p, address_line_2: e.target.value }))}
              placeholder="Address line 2"
              required
            />
            <Input
              value={studentDraft.city}
              onChange={(e) => setStudentDraft((p) => ({ ...p, city: e.target.value }))}
              placeholder="City"
              required
            />
            <Input
              value={studentDraft.state}
              onChange={() => {}}
              placeholder="State"
              required
              className="hidden"
            />
            <Select
              value={studentDraft.state}
              onChange={(v) => setStudentDraft((p) => ({ ...p, state: v }))}
              options={STATE_OPTIONS}
              className="md:col-span-1"
            />
            <Input
              value={studentDraft.postal_code}
              onChange={(e) => setStudentDraft((p) => ({ ...p, postal_code: digitsOnly(e.target.value) }))}
              placeholder="Postal code"
              required
            />
            <Input
              value={studentDraft.country}
              onChange={(e) => setStudentDraft((p) => ({ ...p, country: e.target.value }))}
              placeholder="Country"
              required
            />
          </div>

          <Textarea
            value={studentDraft.notes}
            onChange={(e) => setStudentDraft((p) => ({ ...p, notes: e.target.value }))}
            placeholder="Notes"
            rows={2}
            required
          />

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
                value={editForm.email}
                onChange={(e) => setEditForm((p) => p ? { ...p, email: e.target.value } : p)}
                placeholder="Email *"
                type="email"
                required
              />
              <Input
                value={editForm.phone}
                onChange={(e) => setEditForm((p) => p ? { ...p, phone: digitsOnly(e.target.value).slice(0, 10) } : p)}
                placeholder="Phone"
                required
              />
              <DatePicker
                value={editForm.date_of_birth}
                onChange={(v) => setEditForm((p) => (p ? { ...p, date_of_birth: v } : p))}
                placeholder="Date of birth (dd-mm-yyyy)"
                placement="below"
                fromYear={1960}
                toYear={new Date().getFullYear()}
                disableFuture
                required
              />
              <Select
                value={editForm.status}
                onChange={(v) => setEditForm((p) => p ? { ...p, status: v } : p)}
                options={[
                  { value: 'active', label: 'Active' },
                  { value: 'inactive', label: 'Inactive' },
                  { value: 'prospect', label: 'Prospect' },
                ]}
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                value={editForm.guardian_name}
                onChange={(e) => setEditForm((p) => p ? { ...p, guardian_name: e.target.value } : p)}
                placeholder="Guardian / Emergency contact"
                required
              />
              <Input
                value={editForm.guardian_phone}
                onChange={(e) => setEditForm((p) => p ? { ...p, guardian_phone: digitsOnly(e.target.value).slice(0, 10) } : p)}
                placeholder="Guardian phone"
                required
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input
                value={editForm.address_line_1}
                onChange={(e) => setEditForm((p) => p ? { ...p, address_line_1: e.target.value } : p)}
                placeholder="Address line 1"
                required
              />
              <Input
                value={editForm.address_line_2}
                onChange={(e) => setEditForm((p) => p ? { ...p, address_line_2: e.target.value } : p)}
                placeholder="Address line 2"
                required
              />
              <Input
                value={editForm.city}
                onChange={(e) => setEditForm((p) => p ? { ...p, city: e.target.value } : p)}
                placeholder="City"
                required
              />
              <Input
                value={editForm.state}
                onChange={() => {}}
                placeholder="State"
                required
                className="hidden"
              />
              <Select
                value={editForm.state}
                onChange={(v) => setEditForm((p) => (p ? { ...p, state: v } : p))}
                options={STATE_OPTIONS}
                className="md:col-span-1"
              />
              <Input
                value={editForm.postal_code}
                onChange={(e) => setEditForm((p) => p ? { ...p, postal_code: digitsOnly(e.target.value) } : p)}
                placeholder="Postal code"
                required
              />
              <Input
                value={editForm.country}
                onChange={(e) => setEditForm((p) => p ? { ...p, country: e.target.value } : p)}
                placeholder="Country"
                required
              />
            </div>
            <Textarea
              value={editForm.notes}
              onChange={(e) => setEditForm((p) => p ? { ...p, notes: e.target.value } : p)}
              placeholder="Notes"
              rows={2}
              required
            />
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
