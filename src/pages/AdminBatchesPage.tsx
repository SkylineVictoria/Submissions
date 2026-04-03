import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Users } from 'lucide-react';
import { listBatchesPaged, createBatch, updateBatch, updateBatchStudentAssignments, listUsersForBatchAssignmentPaged, listStudentsPaged, listStudentsInBatch, listCoursesPaged } from '../lib/formEngine';
import type { Batch } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { SelectAsync } from '../components/ui/SelectAsync';
import { MultiSelectAsync } from '../components/ui/MultiSelectAsync';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

const BATCH_PAGE_SIZE = 20;

export const AdminBatchesPage: React.FC = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [totalBatches, setTotalBatches] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [draft, setDraft] = useState({ name: '', trainer_id: '', course_id: '' });
  const [editDraft, setEditDraft] = useState<{ name: string; trainer_id: string; course_id: string; student_ids: number[] } | null>(null);

  const loadBatches = useCallback(async (page: number) => {
    setLoading(true);
    const res = await listBatchesPaged(page, BATCH_PAGE_SIZE);
    setBatches(res.data);
    setTotalBatches(res.total);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadBatches(currentPage);
  }, [currentPage, loadBatches]);

  const loadTrainersOptions = useCallback(async (page: number, search: string) => {
    const res = await listUsersForBatchAssignmentPaged(page, 20, search || undefined);
    return {
      options: res.data.map((t) => ({ value: String(t.id), label: `${t.full_name} (${t.email})` })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const loadStudentsOptions = useCallback(async (page: number, search: string) => {
    const res = await listStudentsPaged(page, 20, search || undefined);
    return {
      options: res.data.map((s) => ({
        value: s.id,
        label: `${[s.first_name, s.last_name].filter(Boolean).join(' ') || s.email} (${s.student_id ?? s.email})`,
      })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const loadCoursesOptions = useCallback(async (page: number, search: string) => {
    const res = await listCoursesPaged(page, 20, search || undefined);
    return {
      options: res.data.map((c) => ({ value: String(c.id), label: c.name })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(totalBatches / BATCH_PAGE_SIZE));

  const handleCreate = async () => {
    if (!draft.name.trim()) {
      toast.error('Batch name is required');
      return;
    }
    const trainerId = Number(draft.trainer_id);
    if (!trainerId || !Number.isFinite(trainerId)) {
      toast.error('Select a trainer');
      return;
    }
    const courseId = Number(draft.course_id);
    if (!courseId || !Number.isFinite(courseId)) {
      toast.error('Select a course');
      return;
    }
    setCreating(true);
    const created = await createBatch({ name: draft.name.trim(), trainer_id: trainerId, course_id: courseId });
    setCreating(false);
    if (created) {
      await loadBatches(currentPage);
      setDraft({ name: '', trainer_id: '', course_id: '' });
      setIsCreateOpen(false);
      toast.success('Batch added');
    } else {
      toast.error('Failed to add batch');
    }
  };

  const editingBatch = batches.find((b) => b.id === editingId);
  useEffect(() => {
    if (!editingBatch) {
      setEditDraft(null);
      return;
    }
    setEditDraft({ name: editingBatch.name, trainer_id: String(editingBatch.trainer_id), course_id: editingBatch.course_id != null ? String(editingBatch.course_id) : '', student_ids: [] });
    listStudentsInBatch(editingBatch.id).then((students) => {
      const studentIds = students.map((s) => s.id);
      setEditDraft((p) => (p ? { ...p, student_ids: studentIds } : null));
    });
  }, [editingId, editingBatch?.id, editingBatch?.name, editingBatch?.trainer_id]);

  const handleSaveEdit = async () => {
    if (!editingId || !editDraft) return;
    if (!editDraft.name.trim()) {
      toast.error('Batch name is required');
      return;
    }
    const trainerId = Number(editDraft.trainer_id);
    if (!trainerId || !Number.isFinite(trainerId)) {
      toast.error('Select a trainer');
      return;
    }
    const courseId = Number(editDraft.course_id);
    if (!courseId || !Number.isFinite(courseId)) {
      toast.error('Select a course');
      return;
    }
    setSavingEdit(true);
    const batchUpdated = await updateBatch(editingId, {
      name: editDraft.name.trim(),
      trainer_id: trainerId,
      course_id: courseId,
    });
    const assignmentsOk = await updateBatchStudentAssignments(editingId, editDraft.student_ids);
    setSavingEdit(false);
    if (batchUpdated && assignmentsOk) {
      await loadBatches(currentPage);
      setEditingId(null);
      toast.success('Batch updated');
    } else {
      toast.error('Failed to update batch');
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Batches</h2>
              <p className="text-sm text-gray-600 mt-1">
                Create batches and assign them to trainers. Students must belong to a batch.
              </p>
            </div>
            <Button onClick={() => setIsCreateOpen(true)} className="w-full md:w-auto md:min-w-[140px]">
              <Plus className="w-4 h-4 mr-2 inline" />
              Add Batch
            </Button>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-[var(--text)]">Batch Directory</h2>
            {!loading && totalBatches > BATCH_PAGE_SIZE && (
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                <span className="text-center text-xs text-gray-500 sm:text-left">
                  Page {currentPage} of {totalPages} ({totalBatches} total)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-w-0 flex-1 sm:flex-initial"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-w-0 flex-1 sm:flex-initial"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading batches..." />
            </div>
          ) : batches.length === 0 ? (
            <p className="text-gray-500">No batches yet. Create a batch to assign students.</p>
          ) : (
            <>
              <div className="space-y-3 lg:hidden">
                {batches.map((batch) => (
                  <div key={batch.id} className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm">
                    <div className="flex items-start gap-2">
                      <Users className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-[var(--text)] break-words">{batch.name}</div>
                        <div className="mt-1 text-sm text-gray-600">
                          <span className="font-medium text-gray-500">Course: </span>
                          {batch.course_name ?? '—'}
                        </div>
                        <div className="mt-1 text-sm text-gray-600 break-words">
                          <span className="font-medium text-gray-500">Trainer: </span>
                          {batch.trainer_name ?? `ID: ${batch.trainer_id}`}
                        </div>
                        <div className="mt-3">
                          <Button variant="outline" size="sm" className="w-full" onClick={() => setEditingId(batch.id)}>
                            <Pencil className="mr-1 h-4 w-4" />
                            Edit
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-[600px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Batch</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Course</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Trainer</th>
                    <th className="text-right px-4 py-3 font-semibold border-b border-[var(--border)]">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 border-b border-[var(--border)]">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-gray-400" />
                          <span className="font-medium">{batch.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">
                        {batch.course_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">
                        {batch.trainer_name ?? `ID: ${batch.trainer_id}`}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingId(batch.id)}
                          className="inline-flex items-center justify-center gap-1.5"
                        >
                          <Pencil className="w-4 h-4" />
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </Card>
      </div>

      <Modal
        isOpen={isCreateOpen}
        onClose={() => !creating && setIsCreateOpen(false)}
        title="Add Batch"
        size="md"
      >
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Batch Name *</span>
            <Input
              value={draft.name}
              onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Batch A, Morning Class"
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Trainer *</span>
            <SelectAsync
              value={draft.trainer_id}
              onChange={(v) => setDraft((p) => ({ ...p, trainer_id: v }))}
              loadOptions={loadTrainersOptions}
              placeholder="Select trainer"
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Course *</span>
            <SelectAsync
              value={draft.course_id}
              onChange={(v) => setDraft((p) => ({ ...p, course_id: v }))}
              loadOptions={loadCoursesOptions}
              placeholder="Select course"
              className="mt-1"
            />
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-[var(--border)]">
          <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={creating}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreate}
            disabled={creating || !draft.name.trim() || !draft.trainer_id || !draft.course_id}
          >
            {creating ? 'Adding...' : 'Add Batch'}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={!!editingId}
        onClose={() => !savingEdit && setEditingId(null)}
        title="Edit Batch"
        size="lg"
      >
        {editDraft && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Batch Name *</span>
              <Input
                value={editDraft.name}
                onChange={(e) => setEditDraft((p) => (p ? { ...p, name: e.target.value } : null))}
                placeholder="e.g. Batch A"
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Trainer *</span>
              <SelectAsync
                value={editDraft.trainer_id}
                onChange={(v) => setEditDraft((p) => (p ? { ...p, trainer_id: v } : null))}
                loadOptions={loadTrainersOptions}
                placeholder="Select trainer"
                selectedLabel={editingBatch ? `${editingBatch.trainer_name ?? ''}` : undefined}
                className="mt-1"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Course *</span>
              <SelectAsync
                value={editDraft.course_id}
                onChange={(v) => setEditDraft((p) => (p ? { ...p, course_id: v } : null))}
                loadOptions={loadCoursesOptions}
                placeholder="Select course"
                selectedLabel={editingBatch?.course_name ?? undefined}
                className="mt-1"
              />
            </label>
            <div className="mt-4">
              <MultiSelectAsync
                label="Students"
                value={editDraft.student_ids}
                onChange={(ids) => setEditDraft((p) => (p ? { ...p, student_ids: ids } : null))}
                loadOptions={loadStudentsOptions}
                placeholder="Select students for this batch"
                maxHeight={220}
                countLabel="students"
                searchPlaceholder="Search students..."
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
              disabled={savingEdit || !editDraft.name.trim() || !editDraft.trainer_id || !editDraft.course_id}
            >
              {savingEdit ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
};
