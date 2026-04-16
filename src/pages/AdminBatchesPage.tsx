import React, { useEffect, useState, useCallback } from 'react';
import { Plus, Pencil, Users } from 'lucide-react';
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
  getFormsForCourse,
  getInstanceForStudentAndForm,
  createFormInstance,
  updateFormInstanceDates,
  extendInstanceAccessTokensToDate,
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
import { DatePicker } from '../components/ui/DatePicker';
import { toast } from '../utils/toast';

const BATCH_PAGE_SIZE = 20;

const getTodayIso = () => new Date().toISOString().slice(0, 10);
const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());

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
  const [unitStudentIds, setUnitStudentIds] = useState<number[]>([]);
  const [unitLoading, setUnitLoading] = useState(false);
  const [unitSavingFormId, setUnitSavingFormId] = useState<number | null>(null);
  const [unitForms, setUnitForms] = useState<Array<Record<string, unknown>>>([]);
  const [unitDatesByFormId, setUnitDatesByFormId] = useState<Record<number, { start: string; end: string }>>({});
  const [unitSelectedFormId, setUnitSelectedFormId] = useState<number | null>(null);
  const [unitMonthFromDate, setUnitMonthFromDate] = useState<string>(() => getTodayIso());
  const [unitMonthToDate, setUnitMonthToDate] = useState<string>(() => getTodayIso());
  const [unitEligibilityReady, setUnitEligibilityReady] = useState(false);
  const [eligibleStudentOptions, setEligibleStudentOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [eligibleUnitOptions, setEligibleUnitOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [eligibleStudentUnits, setEligibleStudentUnits] = useState<Record<string, number[]>>({});

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
      setUnitStudentIds([]);
      setUnitForms([]);
      setUnitDatesByFormId({});
      setUnitSelectedFormId(null);
      setUnitMonthFromDate(getTodayIso());
      setUnitMonthToDate(getTodayIso());
      setUnitEligibilityReady(false);
      setEligibleStudentOptions([]);
      setEligibleUnitOptions([]);
      setEligibleStudentUnits({});
      return;
    }
    setEditDraft({ name: editingBatch.name, trainer_id: String(editingBatch.trainer_id), course_id: editingBatch.course_id != null ? String(editingBatch.course_id) : '', student_ids: [] });
    listStudentsInBatch(editingBatch.id).then((students) => {
      const studentIds = students.map((s) => s.id);
      setEditStudents(students);
      setEditDraft((p) => (p ? { ...p, student_ids: studentIds } : null));
      setUnitStudentIds(students[0]?.id ? [students[0].id] : []);
    });
  }, [editingId, editingBatch?.id, editingBatch?.name, editingBatch?.trainer_id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const courseId = Number(editDraft?.course_id);
      if (!editDraft || !courseId || !Number.isFinite(courseId) || courseId <= 0) {
        setUnitForms([]);
        setUnitDatesByFormId({});
        setUnitSelectedFormId(null);
        setUnitEligibilityReady(false);
        setEligibleStudentOptions([]);
        setEligibleUnitOptions([]);
        setEligibleStudentUnits({});
        return;
      }
      setUnitLoading(true);
      try {
        const forms = await getFormsForCourse(courseId, { asAdmin: true });
        const byForm: Record<number, { start: string; end: string }> = {};
        for (const f of forms) {
          const fid = Number((f as Record<string, unknown>).id);
          byForm[fid] = { start: '', end: '' };
        }
        if (!cancelled) {
          setUnitForms(forms as unknown as Array<Record<string, unknown>>);
          setUnitDatesByFormId(byForm);
          setUnitSelectedFormId((prev) => {
            const firstId = Number((forms[0] as Record<string, unknown> | undefined)?.id);
            if (!Number.isFinite(firstId) || firstId <= 0) return null;
            if (prev && forms.some((x) => Number((x as Record<string, unknown>).id) === prev)) return prev;
            return firstId;
          });
        }
      } finally {
        if (!cancelled) setUnitLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editDraft?.course_id, editDraft?.student_ids]);

  // Fetch which students/units actually have assessments in the selected month range (batch + course only).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const courseId = Number(editDraft?.course_id);
      const batchId = Number(editingBatch?.id);
      if (!editDraft || !courseId || !Number.isFinite(courseId) || courseId <= 0) {
        setUnitEligibilityReady(false);
        setEligibleStudentOptions([]);
        setEligibleUnitOptions([]);
        setEligibleStudentUnits({});
        return;
      }
      if (!Number.isFinite(batchId) || batchId <= 0) {
        setUnitEligibilityReady(false);
        setEligibleStudentOptions([]);
        setEligibleUnitOptions([]);
        setEligibleStudentUnits({});
        return;
      }
      const rangeStart = String(unitMonthFromDate || '').trim();
      const rangeEnd = String(unitMonthToDate || '').trim();
      if (!isIsoDate(rangeStart) || !isIsoDate(rangeEnd) || rangeEnd < rangeStart) {
        setUnitEligibilityReady(true);
        setEligibleStudentOptions([]);
        setEligibleUnitOptions([]);
        setEligibleStudentUnits({});
        return;
      }
      setUnitEligibilityReady(false);
      setUnitLoading(true);
      try {
        const { data, error } = await supabase.rpc('skyline_batch_assessment_options', {
          p_batch_id: batchId,
          p_course_id: courseId,
          p_from_date: rangeStart,
          p_to_date: rangeEnd,
        });
        if (error) {
          console.error('skyline_batch_assessment_options rpc error', error);
          if (!cancelled) {
            setUnitEligibilityReady(true);
            setEligibleStudentOptions([]);
            setEligibleUnitOptions([]);
            setEligibleStudentUnits({});
          }
          return;
        }
        const payload = (data as unknown as {
          students?: Array<{ id: number; label: string }>;
          units?: Array<{ id: number; name: string }>;
          student_units?: Record<string, number[]>;
        }) || {};
        const students = Array.isArray(payload.students) ? payload.students : [];
        const units = Array.isArray(payload.units) ? payload.units : [];
        const studentUnits = (payload.student_units && typeof payload.student_units === 'object') ? payload.student_units : {};

        if (!cancelled) {
          setEligibleStudentOptions(students);
          setEligibleUnitOptions(units);
          setEligibleStudentUnits(studentUnits);
          setUnitEligibilityReady(true);
          // If selected students are now out of range, drop them.
          const allowedStudents = new Set(students.map((s) => Number(s.id)).filter((n) => Number.isFinite(n) && n > 0));
          setUnitStudentIds((prev) => prev.filter((id) => allowedStudents.has(Number(id))));
          // If selected unit is out of range, clear it.
          const allowedUnits = new Set(units.map((u) => Number(u.id)).filter((n) => Number.isFinite(n) && n > 0));
          setUnitSelectedFormId((prev) => (prev && allowedUnits.has(prev) ? prev : null));
        }
      } finally {
        if (!cancelled) setUnitLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editDraft?.course_id, editDraft?.student_ids, unitMonthFromDate, unitMonthToDate, editingBatch?.id]);

  const saveUnitDates = useCallback(async (formId: number) => {
    if (!editDraft || unitStudentIds.length === 0) return;
    const fid = Number(formId);
    const sids = Array.from(new Set(unitStudentIds.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)));
    if (!Number.isFinite(fid) || fid <= 0 || sids.length === 0) return;
    const dates = unitDatesByFormId[fid] || { start: '', end: '' };
    const start = dates.start?.trim() || null;
    const end = dates.end?.trim() || null;
    setUnitSavingFormId(fid);
    try {
      for (const sid of sids) {
        // eslint-disable-next-line no-await-in-loop
        const existing = await getInstanceForStudentAndForm(fid, sid);
        if (existing?.id) {
          // eslint-disable-next-line no-await-in-loop
          await updateFormInstanceDates(existing.id, { start_date: start, end_date: end });
          if (end) {
            // eslint-disable-next-line no-await-in-loop
            await extendInstanceAccessTokensToDate(existing.id, 'student', end);
          }
        } else {
          // eslint-disable-next-line no-await-in-loop
          const inst = await createFormInstance(fid, 'student', sid, { start_date: start, end_date: end });
          if (inst?.id && end) {
            // eslint-disable-next-line no-await-in-loop
            await extendInstanceAccessTokensToDate(inst.id, 'student', end);
          }
        }
      }
      toast.success(`Dates updated for ${sids.length} student${sids.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update dates');
    } finally {
      setUnitSavingFormId(null);
    }
  }, [createFormInstance, editDraft, extendInstanceAccessTokensToDate, getInstanceForStudentAndForm, unitDatesByFormId, unitStudentIds]);

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

            <div className="mt-6 rounded-lg border border-[var(--border)] bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800">Student unit dates</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Select one or more students in this batch, then select a unit and edit assessment start/end dates.
                  </div>
                </div>
                <div className="w-full sm:w-[420px]">
                  <MultiSelectAsync
                    label="Students"
                    value={unitStudentIds}
                    onChange={(ids) => setUnitStudentIds(ids)}
                    loadOptions={async (_page: number, search: string) => {
                      const base = eligibleStudentOptions.map((s) => ({ value: s.id, label: s.label }));
                      const q = (search || '').trim().toLowerCase();
                      const filtered = q
                        ? base.filter((o) => o.label.toLowerCase().includes(q))
                        : base;
                      return {
                        options: unitEligibilityReady ? filtered : [],
                        hasMore: false,
                      };
                    }}
                    placeholder="Select students"
                    maxHeight={220}
                    countLabel="students"
                    searchPlaceholder="Search students..."
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DatePicker
                  label="From date"
                  value={unitMonthFromDate}
                  onChange={(v) => setUnitMonthFromDate(v || '')}
                  placement="below"
                />
                <DatePicker
                  label="To date"
                  value={unitMonthToDate}
                  onChange={(v) => setUnitMonthToDate(v || '')}
                  placement="below"
                />
              </div>
              {unitEligibilityReady && eligibleStudentOptions.length === 0 ? (
                <div className="mt-2 text-xs text-gray-500">
                  No students in this batch have assessments during the selected month range.
                </div>
              ) : null}

              {unitLoading ? (
                <div className="py-8">
                  <Loader variant="dots" size="md" message="Loading units..." />
                </div>
              ) : unitForms.length === 0 ? (
                <div className="py-6 text-sm text-gray-600">No units found for this course.</div>
              ) : (
                (() => {
                  const opts = eligibleUnitOptions.map((u) => ({ value: String(u.id), label: u.name }));

                  // If students are selected, narrow units to the union of their eligible unit IDs.
                  const allowedFormIds = (() => {
                    if (!unitEligibilityReady) return new Set<number>();
                    if (unitStudentIds.length === 0) return new Set<number>(eligibleUnitOptions.map((u) => Number(u.id)));
                    const allowed = new Set<number>();
                    for (const sid of unitStudentIds) {
                      const list = eligibleStudentUnits[String(sid)] || [];
                      for (const fid of list) allowed.add(Number(fid));
                    }
                    return allowed;
                  })();

                  const fid = unitSelectedFormId && Number.isFinite(unitSelectedFormId) ? unitSelectedFormId : null;
                  const dates = fid ? (unitDatesByFormId[fid] || { start: '', end: '' }) : { start: '', end: '' };
                  const currentUnit = fid ? eligibleUnitOptions.find((u) => Number(u.id) === fid) : null;
                  const unitName = currentUnit?.name ?? '';

                  return (
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="min-w-0">
                        <label className="block">
                          <span className="block text-xs font-medium text-gray-700 mb-1">Unit</span>
                          <SelectAsync
                            value={fid ? String(fid) : ''}
                            onChange={(v) => setUnitSelectedFormId(v ? Number(v) : null)}
                            loadOptions={async (_page: number, search: string) => {
                              const q = (search || '').trim().toLowerCase();
                              const base = opts.filter((o) => allowedFormIds.has(Number(o.value)));
                              const filtered = q ? base.filter((o) => o.label.toLowerCase().includes(q)) : base;
                              // Keep it simple: options are local, no paging needed.
                              return { options: filtered, hasMore: false };
                            }}
                            placeholder="Select unit"
                            className="w-full"
                            attachDropdown="trigger"
                          />
                        </label>
                      </div>
                      <div className="min-w-0">
                        {!fid ? (
                          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                            Select a unit to edit dates.
                          </div>
                        ) : (
                          <div className="rounded-lg border border-gray-200 bg-white p-4">
                            <div className="text-sm font-semibold text-gray-900">
                              {unitName || `Form ${fid}`}
                            </div>
                            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
                              <DatePicker
                                label="Start date"
                                value={dates.start}
                                onChange={(v) =>
                                  setUnitDatesByFormId((p) => ({ ...p, [fid]: { ...(p[fid] || { start: '', end: '' }), start: v } }))
                                }
                                compact
                                placement="below"
                                className="w-full"
                              />
                              <DatePicker
                                label="End date"
                                value={dates.end}
                                onChange={(v) =>
                                  setUnitDatesByFormId((p) => ({ ...p, [fid]: { ...(p[fid] || { start: '', end: '' }), end: v } }))
                                }
                                compact
                                placement="below"
                                className="w-full"
                              />
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  variant="primary"
                                  disabled={unitSavingFormId === fid || unitStudentIds.length === 0}
                                  onClick={() => void saveUnitDates(fid)}
                                  className="w-full sm:w-auto"
                                >
                                  {unitSavingFormId === fid ? 'Saving…' : 'Save changes'}
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
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
