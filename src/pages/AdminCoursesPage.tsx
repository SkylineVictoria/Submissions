import React, { useEffect, useState } from 'react';
import { Plus, Pencil, FileText, Trash2 } from 'lucide-react';
import {
  listCourses,
  createCourse,
  updateCourse,
  deleteCourse,
  setCourseForms,
  getFormsForCourse,
  listForms,
} from '../lib/formEngine';
import type { Course, Form } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

export const AdminCoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [forms, setForms] = useState<Form[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: '' });
  const [editDraft, setEditDraft] = useState<{ name: string; form_ids: number[] } | null>(null);

  const loadCourses = async () => {
    const data = await listCourses();
    setCourses(data);
  };

  const loadForms = async () => {
    const data = await listForms();
    setForms(data);
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCourses(), loadForms()]).finally(() => setLoading(false));
  }, []);

  const formOptions = forms.map((f) => ({
    value: f.id,
    label: `${f.name} (v${f.version ?? '1.0.0'})`,
  }));

  const handleCreate = async () => {
    if (!draft.name.trim()) {
      toast.error('Course name is required');
      return;
    }
    setCreating(true);
    const created = await createCourse(draft.name.trim());
    setCreating(false);
    if (created) {
      await loadCourses();
      setDraft({ name: '' });
      setIsCreateOpen(false);
      toast.success('Course added');
    } else {
      toast.error('Failed to add course');
    }
  };

  const editingCourse = courses.find((c) => c.id === editingId);
  useEffect(() => {
    if (!editingCourse) {
      setEditDraft(null);
      return;
    }
    getFormsForCourse(editingCourse.id).then((courseForms) => {
      setEditDraft({
        name: editingCourse.name,
        form_ids: courseForms.map((f) => f.id),
      });
    });
  }, [editingId, editingCourse?.id]);

  const handleSaveEdit = async () => {
    if (!editingId || !editDraft) return;
    if (!editDraft.name.trim()) {
      toast.error('Course name is required');
      return;
    }
    setSavingEdit(true);
    const updated = await updateCourse(editingId, { name: editDraft.name.trim() });
    const formsOk = await setCourseForms(editingId, editDraft.form_ids);
    setSavingEdit(false);
    if (updated && formsOk) {
      await loadCourses();
      setEditingId(null);
      toast.success('Course updated');
    } else {
      toast.error('Failed to update course');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!window.confirm(`Delete course "${name}"? Forms will not be deleted, only the course assignment.`)) return;
    setDeletingId(id);
    const ok = await deleteCourse(id);
    setDeletingId(null);
    if (ok) {
      await loadCourses();
      if (editingId === id) setEditingId(null);
      toast.success('Course deleted');
    } else {
      toast.error('Failed to delete course');
    }
  };

  const [formCountMap, setFormCountMap] = useState<Record<number, number>>({});
  useEffect(() => {
    if (courses.length === 0) return;
    Promise.all(courses.map(async (c) => [c.id, (await getFormsForCourse(c.id)).length] as const)).then((pairs) => {
      setFormCountMap(Object.fromEntries(pairs));
    });
  }, [courses]);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Courses</h2>
              <p className="text-sm text-gray-600 mt-1">
                Categories for forms. One course can have many forms; one form can belong to many courses.
              </p>
            </div>
            <Button onClick={() => setIsCreateOpen(true)} className="min-w-[140px]">
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Course
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-[var(--text)] mb-4">Course Directory</h2>
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading courses..." />
            </div>
          ) : courses.length === 0 ? (
            <p className="text-gray-500">No courses yet. Create a course and assign forms to it.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[600px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Course</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Forms</th>
                    <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course) => (
                    <tr key={course.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-400" />
                          <span className="font-medium">{course.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">
                        {formCountMap[course.id] ?? '...'} form{formCountMap[course.id] !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingId(course.id)}
                            className="inline-flex items-center justify-center gap-1.5"
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(course.id, course.name)}
                            disabled={deletingId === course.id}
                            className="inline-flex items-center justify-center gap-1.5 text-red-600 hover:border-red-300"
                          >
                            {deletingId === course.id ? (
                              <Loader variant="dots" size="sm" inline />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        isOpen={isCreateOpen}
        onClose={() => !creating && setIsCreateOpen(false)}
        title="Add Course"
        size="md"
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Course Name *</span>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Certificate III in Painting"
              className="mt-1"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-[var(--border)]">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={creating || !draft.name.trim()}>
            {creating ? 'Adding...' : 'Add Course'}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={!!editingId}
        onClose={() => !savingEdit && setEditingId(null)}
        title="Edit Course"
        size="lg"
      >
        {editDraft && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Course Name *</span>
              <Input
                value={editDraft.name}
                onChange={(e) => setEditDraft((p) => (p ? { ...p, name: e.target.value } : null))}
                placeholder="e.g. Certificate III in Painting"
                className="mt-1"
              />
            </label>
            <div className="mt-4">
              <MultiSelect
                label="Forms in this course"
                value={editDraft.form_ids}
                onChange={(ids) => setEditDraft((p) => (p ? { ...p, form_ids: ids } : null))}
                options={formOptions}
                placeholder="Select forms for this course"
                maxHeight={220}
                countLabel="forms"
              />
            </div>
          </div>
        )}
        {editDraft && (
          <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-[var(--border)]">
            <Button variant="outline" onClick={() => setEditingId(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSaveEdit}
              disabled={savingEdit || !editDraft.name.trim()}
            >
              {savingEdit ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
};
