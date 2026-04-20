import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Users, CalendarRange, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import {
  listBatchesPaged,
  createBatch,
  updateBatch,
  updateBatchStudentAssignments,
  listUsersForBatchAssignmentPaged,
  listStudentsPaged,
  listStudentsInBatch,
  listCoursesPaged,
  deleteBatchIfAllStudentsInactive,
} from '../lib/formEngine';
import type { Batch, Student } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { SelectAsync } from '../components/ui/SelectAsync';
import { MultiSelectAsync } from '../components/ui/MultiSelectAsync';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { AdminListPagination } from '../components/admin/AdminListPagination';
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
  const [, setEditStudents] = useState<Student[]>([]);
  const [activeCountByBatchId, setActiveCountByBatchId] = useState<Record<number, number>>({});
  const [deletingBatchId, setDeletingBatchId] = useState<number | null>(null);
  const [deleteBatchTarget, setDeleteBatchTarget] = useState<Batch | null>(null);

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

  useEffect(() => {
    if (batches.length === 0) {
      setActiveCountByBatchId({});
      return;
    }
    const ids = batches.map((b) => Number(b.id)).filter((n) => Number.isFinite(n) && n > 0);
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('skyline_students')
        .select('batch_id, status')
        .in('batch_id', ids);
      if (cancelled) return;
      if (error) {
        console.error('load active students for batches error', error);
        setActiveCountByBatchId({});
        return;
      }
      const rows = (data as Array<{ batch_id: number | null; status: string | null }> | null) || [];
      const map: Record<number, number> = {};
      for (const id of ids) map[id] = 0;
      for (const r of rows) {
        const bid = Number(r.batch_id);
        if (!Number.isFinite(bid) || bid <= 0) continue;
        const st = (r.status ?? 'active') as string;
        if (st === 'inactive') continue;
        map[bid] = (map[bid] ?? 0) + 1;
      }
      setActiveCountByBatchId(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [batches]);

  const requestDeleteBatch = useCallback((batch: Batch) => {
    const bid = Number(batch.id);
    if (!Number.isFinite(bid) || bid <= 0) return;
    const active = activeCountByBatchId[bid] ?? 0;
    if (active > 0) {
      toast.error('Cannot delete. This batch has active students.');
      return;
    }
    setDeleteBatchTarget(batch);
  }, [activeCountByBatchId]);

  const confirmDeleteBatch = useCallback(async () => {
    const batch = deleteBatchTarget;
    if (!batch) return;
    const bid = Number(batch.id);
    if (!Number.isFinite(bid) || bid <= 0) return;
    const active = activeCountByBatchId[bid] ?? 0;
    if (active > 0) {
      toast.error('Cannot delete. This batch has active students.');
      setDeleteBatchTarget(null);
      return;
    }
    setDeletingBatchId(bid);
    try {
      const res = await deleteBatchIfAllStudentsInactive(bid);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Batch deleted');
      await loadBatches(currentPage);
    } finally {
      setDeletingBatchId(null);
      setDeleteBatchTarget(null);
    }
  }, [activeCountByBatchId, currentPage, deleteBatchTarget, loadBatches]);

  const loadTrainersOptions = useCallback(async (page: number, search: string) => {
    const res = await listUsersForBatchAssignmentPaged(page, 20, search || undefined);
    return {
      options: res.data.map((t) => ({ value: String(t.id), label: `${t.full_name} (${t.email})` })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const loadStudentsOptions = useCallback(async (page: number, search: string) => {
    const res = await listStudentsPaged(page, 20, search || undefined, 'active');
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
      setEditStudents([]);
      return;
    }
    setEditDraft({ name: editingBatch.name, trainer_id: String(editingBatch.trainer_id), course_id: editingBatch.course_id != null ? String(editingBatch.course_id) : '', student_ids: [] });
    listStudentsInBatch(editingBatch.id).then((students) => {
      const studentIds = students.map((s) => s.id);
      setEditStudents(students);
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
          <h2 className="text-lg font-bold text-[var(--text)] mb-4">Batch Directory</h2>
          {!loading && (
            <AdminListPagination
              placement="top"
              totalItems={totalBatches}
              pageSize={BATCH_PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="batches"
            />
          )}
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
                        <Link
                          to={`/admin/batches/${batch.id}/unit-dates`}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline break-words"
                        >
                          {batch.name}
                        </Link>
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
                          {(activeCountByBatchId[batch.id] ?? 0) === 0 ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full mt-2"
                              onClick={() => requestDeleteBatch(batch)}
                              disabled={deletingBatchId === batch.id}
                              title="Delete batch (only when no active students)"
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              Delete
                            </Button>
                          ) : null}
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
                        <div className="flex items-center gap-2 min-w-0">
                          <Users className="w-4 h-4 text-gray-400 shrink-0" />
                          <Link
                            to={`/admin/batches/${batch.id}/unit-dates`}
                            className="font-medium text-blue-600 hover:text-blue-800 hover:underline truncate"
                          >
                            {batch.name}
                          </Link>
                        </div>
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">
                        {batch.course_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">
                        {batch.trainer_name ?? `ID: ${batch.trainer_id}`}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <div className="inline-flex items-center justify-end gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingId(batch.id)}
                            className="inline-flex items-center justify-center gap-1.5"
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </Button>
                          {(activeCountByBatchId[batch.id] ?? 0) === 0 ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => requestDeleteBatch(batch)}
                              disabled={deletingBatchId === batch.id}
                              className="inline-flex items-center justify-center gap-1.5"
                              title="Delete batch (only when no active students)"
                            >
                              <Trash2 className="w-4 h-4" />
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
          {!loading && (
            <AdminListPagination
              placement="bottom"
              totalItems={totalBatches}
              pageSize={BATCH_PAGE_SIZE}
              currentPage={currentPage}
              totalPages={totalPages}
              onPrev={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              onGoToPage={(p) => setCurrentPage(p)}
              itemLabel="batches"
            />
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

            {editingBatch ? (
              <div className="mt-6 rounded-lg border border-[var(--border)] bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800">Student unit dates</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Filter by date range, select students and units, and mass-edit assessment dates.
                  </div>
                </div>
                <Link to={`/admin/batches/${editingBatch.id}/unit-dates`} className="shrink-0">
                  <Button type="button" variant="outline" className="w-full sm:w-auto">
                    <CalendarRange className="w-4 h-4 mr-2 inline" />
                    Open unit dates
                  </Button>
                </Link>
              </div>
            ) : null}
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

      <Modal
        isOpen={!!deleteBatchTarget}
        onClose={() => {
          if (deletingBatchId) return;
          setDeleteBatchTarget(null);
        }}
        title="Delete batch"
        size="md"
      >
        {deleteBatchTarget ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">
              Delete batch <strong>{deleteBatchTarget.name}</strong>?
            </p>
            <p className="text-xs text-gray-500">
              This is only allowed when the batch has <strong>no active students</strong>. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteBatchTarget(null)} disabled={!!deletingBatchId}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void confirmDeleteBatch()} disabled={!!deletingBatchId}>
                {deletingBatchId === deleteBatchTarget.id ? <Loader variant="dots" size="sm" inline className="mr-2" /> : null}
                Delete
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
};
