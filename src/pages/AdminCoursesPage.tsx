import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Pencil, FileText, Trash2, Send } from 'lucide-react';
import {
  listCoursesPaged,
  createCourse,
  updateCourse,
  deleteCourse,
  setCourseForms,
  getFormsForCourse,
  listFormsPaged,
  listBatchesPaged,
  listBatchesForCourse,
  setCourseBatches,
  createFormInstance,
  getInstanceForStudentAndForm,
  listStudentsInBatch,
  createCourseLinkExport,
  listCourseLinkExports,
} from '../lib/formEngine';
import type { Course } from '../lib/formEngine';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { MultiSelectAsync } from '../components/ui/MultiSelectAsync';
import { Modal } from '../components/ui/Modal';
import { Loader } from '../components/ui/Loader';
import { DatePicker } from '../components/ui/DatePicker';
import { toast } from '../utils/toast';
import { pdf } from '@react-pdf/renderer';
import { GenericLinksPdf } from '../components/pdf/GenericLinksPdf';
import { registerPdfFonts } from '../utils/fontLoader';
import { SelectAsync } from '../components/ui/SelectAsync';

const COURSE_PAGE_SIZE = 20;

export const AdminCoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [totalCourses, setTotalCourses] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: '', qualification_code: '' });
  const [editDraft, setEditDraft] = useState<{
    name: string;
    qualification_code: string;
    form_ids: number[];
    batch_ids: number[];
  } | null>(null);

  const [sendCourseId, setSendCourseId] = useState<number | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendFormIds, setSendFormIds] = useState<number[]>([]);
  const [sendBatchId, setSendBatchId] = useState<string>('');
  const [sendStartDate, setSendStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [sendEndDate, setSendEndDate] = useState<string>(() => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [sendDatesByPair, setSendDatesByPair] = useState<Record<string, { start: string; end: string }>>({});
  const [sendDatesTouched, setSendDatesTouched] = useState<Record<string, boolean>>({});
  const [sendPairEnabled, setSendPairEnabled] = useState<Record<string, boolean>>({});
  const [sendStudents, setSendStudents] = useState<Array<{ id: number; name: string; email: string }>>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloadsCourseId, setDownloadsCourseId] = useState<number | null>(null);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [exports, setExports] = useState<Array<{ id: number; created_at: string; payload_json: unknown }>>([]);

  const loadCourses = useCallback(async (page: number) => {
    setLoading(true);
    const res = await listCoursesPaged(page, COURSE_PAGE_SIZE);
    setCourses(res.data);
    setTotalCourses(res.total);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadCourses(currentPage);
  }, [currentPage, loadCourses]);

  const loadFormsOptions = useCallback(async (page: number, search: string) => {
    const res = await listFormsPaged(page, 20, undefined, undefined, search || undefined, { asAdmin: true });
    return {
      options: res.data.map((f) => ({
        value: f.id,
        label: `${f.name} (v${f.version ?? '1.0.0'})`,
      })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const loadBatchesOptions = useCallback(async (page: number, search: string) => {
    const res = await listBatchesPaged(page, 20, search || undefined);
    return {
      options: res.data.map((b) => ({
        value: b.id,
        label: b.course_name ? `${b.name} — ${b.course_name}` : b.name,
      })),
      hasMore: page * 20 < res.total,
    };
  }, []);

  const loadCourseBatchesOptions = useCallback(async (page: number, search: string) => {
    if (!sendCourseId) return { options: [], hasMore: false };
    const res = await listBatchesPaged(page, 20, search || undefined, sendCourseId);
    return {
      options: res.data.map((b) => ({ value: String(b.id), label: b.name })),
      hasMore: page * 20 < res.total,
    };
  }, [sendCourseId]);

  const selectedCourse = useMemo(() => courses.find((c) => c.id === sendCourseId) ?? null, [courses, sendCourseId]);
  const [sendCourseForms, setSendCourseForms] = useState<Array<{ id: number; name: string; version?: string | null }>>([]);

  useEffect(() => {
    if (!sendOpen || !sendCourseId) return;
    // Load forms for this course (published only).
    getFormsForCourse(sendCourseId, { asAdmin: true }).then((f) => {
      const published = f.filter((x) => x.status === 'published');
      setSendCourseForms(published.map((x) => ({ id: x.id, name: x.name, version: x.version })));
      // Default selection: all forms in course (can uncheck).
      setSendFormIds((prev) => (prev.length ? prev : published.map((x) => x.id)));
    });
  }, [sendOpen, sendCourseId]);

  useEffect(() => {
    if (!sendBatchId) {
      setSendStudents([]);
      setSelectedStudentIds([]);
      return;
    }
    const bid = Number(sendBatchId);
    if (!Number.isFinite(bid) || bid <= 0) return;
    listStudentsInBatch(bid).then((students) => {
      const rows = students.map((s) => ({
        id: s.id,
        name: [s.first_name, s.last_name].filter(Boolean).join(' ').trim() || s.email,
        email: s.email,
      }));
      setSendStudents(rows);
      setSelectedStudentIds(rows.map((r) => r.id));
    });
  }, [sendBatchId]);

  useEffect(() => {
    // Keep per-pair defaults in sync when selections or global dates change.
    const start = sendStartDate.trim();
    const end = sendEndDate.trim();
    if (!start || !end) return;
    const studentIds = [...new Set(selectedStudentIds)].filter((n) => Number.isFinite(n) && n > 0);
    const formIds = [...new Set(sendFormIds)].filter((n) => Number.isFinite(n) && n > 0);
    setSendDatesByPair((prev) => {
      const next: Record<string, { start: string; end: string }> = {};
      for (const sid of studentIds) {
        for (const fid of formIds) {
          const k = `${sid}:${fid}`;
          const existing = prev[k];
          const touched = !!sendDatesTouched[k];
          next[k] = existing
            ? (touched ? existing : { start, end })
            : { start, end };
        }
      }
      return next;
    });
    setSendDatesTouched((prev) => {
      const next: Record<string, boolean> = {};
      for (const sid of studentIds) {
        for (const fid of formIds) {
          const k = `${sid}:${fid}`;
          if (prev[k]) next[k] = true;
        }
      }
      return next;
    });
    setSendPairEnabled((prev) => {
      const next: Record<string, boolean> = {};
      for (const sid of studentIds) {
        for (const fid of formIds) {
          const k = `${sid}:${fid}`;
          next[k] = prev[k] !== false;
        }
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudentIds, sendFormIds, sendStartDate, sendEndDate]);

  const selectedBatchLabel = useMemo(() => {
    const bid = Number(sendBatchId);
    if (!Number.isFinite(bid) || bid <= 0) return '';
    // We only have labels in SelectAsync menu; use a safe fallback in PDF.
    return `Batch #${bid}`;
  }, [sendBatchId]);

  const handleSendUnits = async () => {
    if (!sendCourseId || !selectedCourse) return;
    const bid = Number(sendBatchId);
    if (!bid || !Number.isFinite(bid)) {
      toast.error('Select a batch');
      return;
    }
    const studentIds = [...new Set(selectedStudentIds)];
    if (studentIds.length === 0) {
      toast.error('Select at least one student');
      return;
    }
    const formIds = [...new Set(sendFormIds)];
    if (formIds.length === 0) {
      toast.error('Select at least one form');
      return;
    }
    const start = sendStartDate.trim();
    const end = sendEndDate.trim();
    if (!start || !end) {
      toast.error('Select start and end date');
      return;
    }
    if (end < start) {
      toast.error('End date cannot be earlier than start date');
      return;
    }

    setSending(true);
    let createdCount = 0;
    let skippedCount = 0;
    try {
      for (const studentId of studentIds) {
        for (const formId of formIds) {
          const existing = await getInstanceForStudentAndForm(formId, studentId);
          if (existing) {
            skippedCount++;
            continue;
          }
          const key = `${studentId}:${formId}`;
          if (sendPairEnabled[key] === false) continue;
          const pair = sendDatesByPair[key];
          const pairStart = (pair?.start ?? start).trim();
          const pairEnd = (pair?.end ?? end).trim();
          if (!pairStart || !pairEnd) {
            throw new Error('Missing assessment dates for one or more selected student/forms.');
          }
          if (pairEnd < pairStart) {
            throw new Error('End date cannot be earlier than start date.');
          }
          const inst = await createFormInstance(formId, 'student', studentId, { start_date: pairStart, end_date: pairEnd });
          if (inst) createdCount++;
        }
      }

      // Generate PDF with generic links and selected students.
      await registerPdfFonts();
      const origin = window.location.origin;
      const formsForPdf = sendCourseForms
        .filter((f) => formIds.includes(f.id))
        .map((f) => ({
          id: f.id,
          name: f.name,
          version: f.version ?? null,
          url: `${origin}/forms/${f.id}/student-access`,
        }));
      const studentsForPdf = sendStudents.filter((s) => studentIds.includes(s.id));

      const createdAtIso = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const payload = {
        title: 'Course forms – generic links',
        courseName: selectedCourse.name,
        batchName: selectedBatchLabel,
        createdAtIso,
        forms: formsForPdf,
        students: studentsForPdf,
      };
      const doc = (
        <GenericLinksPdf
          title="Course forms – generic links"
          courseName={selectedCourse.name}
          batchName={selectedBatchLabel}
          createdAtIso={createdAtIso}
          forms={formsForPdf}
          students={studentsForPdf}
        />
      );
      const asPdf = pdf(doc);
      const blob = await asPdf.toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `course-links-${selectedCourse.name.replace(/[^a-z0-9]+/gi, '_')}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Save export snapshot so admin can re-download later.
      await createCourseLinkExport(selectedCourse.id, bid, payload);

      toast.success(`Sent: ${createdCount} created, ${skippedCount} already existed. PDF downloaded.`);
      setSendOpen(false);
      setSendBatchId('');
      setSendStudents([]);
      setSelectedStudentIds([]);
      setSendFormIds([]);
      setSendCourseId(null);
      setSendStartDate(new Date().toISOString().slice(0, 10));
      setSendEndDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
      setSendDatesByPair({});
      setSendDatesTouched({});
      setSendPairEnabled({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send units');
    } finally {
      setSending(false);
    }
  };

  const downloadsCourse = useMemo(
    () => courses.find((c) => c.id === downloadsCourseId) ?? null,
    [courses, downloadsCourseId]
  );

  const openDownloads = async (courseId: number) => {
    setDownloadsCourseId(courseId);
    setDownloadsOpen(true);
    setDownloadsLoading(true);
    const rows = await listCourseLinkExports(courseId, 20);
    setExports(rows.map((r) => ({ id: r.id, created_at: r.created_at, payload_json: r.payload_json })));
    setDownloadsLoading(false);
  };

  const downloadExportPdf = async (payloadJson: unknown) => {
    const p = payloadJson as {
      title?: string;
      courseName?: string;
      batchName?: string;
      createdAtIso?: string;
      forms?: Array<{ id: number; name: string; version?: string | null; url: string }>;
      students?: Array<{ id: number; name: string; email: string }>;
    };
    await registerPdfFonts();
    const doc = (
      <GenericLinksPdf
        title={p.title || 'Course forms – generic links'}
        courseName={p.courseName || ''}
        batchName={p.batchName || ''}
        createdAtIso={p.createdAtIso || new Date().toISOString()}
        forms={Array.isArray(p.forms) ? p.forms : []}
        students={Array.isArray(p.students) ? p.students : []}
      />
    );
    const asPdf = pdf(doc);
    const blob = await asPdf.toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `course-links-${(p.courseName || 'course').replace(/[^a-z0-9]+/gi, '_')}-${(p.createdAtIso || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(totalCourses / COURSE_PAGE_SIZE));

  const handleCreate = async () => {
    if (!draft.name.trim()) {
      toast.error('Course name is required');
      return;
    }
    setCreating(true);
    const created = await createCourse(draft.name.trim(), draft.qualification_code);
    setCreating(false);
    if (created) {
      await loadCourses(currentPage);
      setDraft({ name: '', qualification_code: '' });
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
    Promise.all([
      getFormsForCourse(editingCourse.id, { asAdmin: true }),
      listBatchesForCourse(editingCourse.id),
    ]).then(([courseForms, courseBatches]) => {
      setEditDraft({
        name: editingCourse.name,
        qualification_code: (editingCourse.qualification_code ?? '').trim(),
        form_ids: courseForms.map((f) => f.id),
        batch_ids: courseBatches.map((b) => b.id),
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
    const updated = await updateCourse(editingId, {
      name: editDraft.name.trim(),
      qualification_code: editDraft.qualification_code,
    });
    const formsOk = await setCourseForms(editingId, editDraft.form_ids);
    const batchesOk = await setCourseBatches(editingId, editDraft.batch_ids);
    setSavingEdit(false);
    if (updated && formsOk && batchesOk) {
      await loadCourses(currentPage);
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
      await loadCourses(currentPage);
      if (editingId === id) setEditingId(null);
      toast.success('Course deleted');
    } else {
      toast.error('Failed to delete course');
    }
  };

  const [formCountMap, setFormCountMap] = useState<Record<number, number>>({});
  const [qualificationCodeMap, setQualificationCodeMap] = useState<Record<number, string>>({});
  useEffect(() => {
    if (courses.length === 0) return;
    Promise.all(
      courses.map(async (c) => {
        const forms = await getFormsForCourse(c.id, { asAdmin: true });
        const codes = Array.from(
          new Set(
            forms
              .map((f) => String((f as { qualification_code?: string | null }).qualification_code ?? '').trim())
              .filter(Boolean)
          )
        );
        return [c.id, forms.length, codes.join(', ')] as const;
      })
    ).then((rows) => {
      setFormCountMap(Object.fromEntries(rows.map(([id, count]) => [id, count])));
      setQualificationCodeMap(Object.fromEntries(rows.map(([id, _count, codes]) => [id, codes || '-'])));
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-[var(--text)]">Course Directory</h2>
            {!loading && totalCourses > COURSE_PAGE_SIZE && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  Page {currentPage} of {totalPages} ({totalCourses} total)
                </span>
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
            )}
          </div>
          {loading ? (
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading courses..." />
            </div>
          ) : courses.length === 0 ? (
            <p className="text-gray-500">No courses yet. Create a course and assign forms to it.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-sm border border-[var(--border)] rounded-lg overflow-hidden">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Course</th>
                    <th className="text-left px-4 py-3 font-semibold border-b border-[var(--border)]">Qualification Code</th>
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
                        {course.qualification_code?.trim() || qualificationCodeMap[course.id] || '-'}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-gray-700">
                        {formCountMap[course.id] ?? '...'} form{formCountMap[course.id] !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 border-b border-[var(--border)] text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSendCourseId(course.id);
                              setSendOpen(true);
                              setSendFormIds([]);
                              setSendBatchId('');
                              setSendStudents([]);
                              setSelectedStudentIds([]);
                            }}
                            className="inline-flex items-center justify-center gap-1.5"
                            title="Send course forms to students"
                          >
                            <Send className="w-4 h-4" />
                            Send units
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void openDownloads(course.id)}
                            className="inline-flex items-center justify-center gap-1.5"
                            title="Re-download previously generated PDFs"
                          >
                            <FileText className="w-4 h-4" />
                            Downloads
                          </Button>
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
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Qualification code</span>
            <Input
              value={draft.qualification_code}
              onChange={(e) => setDraft((p) => ({ ...p, qualification_code: e.target.value }))}
              placeholder="e.g. CPC30620"
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
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Qualification code</span>
              <Input
                value={editDraft.qualification_code}
                onChange={(e) =>
                  setEditDraft((p) => (p ? { ...p, qualification_code: e.target.value } : null))
                }
                placeholder="e.g. CPC30620"
                className="mt-1"
              />
            </label>
            <div className="mt-4">
              <MultiSelectAsync
                label="Forms in this course"
                value={editDraft.form_ids}
                onChange={(ids) => setEditDraft((p) => (p ? { ...p, form_ids: ids } : null))}
                loadOptions={loadFormsOptions}
                placeholder="Select forms for this course"
                maxHeight={220}
                countLabel="forms"
                searchPlaceholder="Search forms..."
              />
            </div>
            <div className="mt-4">
              <MultiSelectAsync
                label="Batches in this course"
                value={editDraft.batch_ids}
                onChange={(ids) => setEditDraft((p) => (p ? { ...p, batch_ids: ids } : null))}
                loadOptions={loadBatchesOptions}
                placeholder="Select batches for this course"
                maxHeight={220}
                countLabel="batches"
                searchPlaceholder="Search batches..."
              />
              <p className="mt-1 text-xs text-gray-500">
                Selecting a batch here sets its course. A batch can belong to only one course.
              </p>
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

      <Modal
        isOpen={sendOpen}
        onClose={() => !sending && setSendOpen(false)}
        title="Send units to students"
        size="lg"
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-700">
            <div className="font-semibold">{selectedCourse?.name ?? 'Course'}</div>
            <div className="text-xs text-gray-500">Select forms, batch, and students. Then download a PDF of generic links.</div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <MultiSelectAsync
                label="Forms (check/uncheck)"
                value={sendFormIds}
                onChange={(ids) => setSendFormIds(ids)}
                loadOptions={async () => ({
                  options: sendCourseForms.map((f) => ({ value: f.id, label: `${f.name} (v${f.version ?? '1.0.0'})` })),
                  hasMore: false,
                })}
                placeholder="Select forms"
                maxHeight={220}
                countLabel="forms"
                searchPlaceholder="Search…"
                disabled={!selectedCourse}
              />
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSendFormIds(sendCourseForms.map((f) => f.id))}
                  disabled={sendCourseForms.length === 0}
                >
                  Select all
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSendFormIds([])} disabled={sendFormIds.length === 0}>
                  Clear
                </Button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
              <SelectAsync
                value={sendBatchId}
                onChange={(v) => setSendBatchId(v)}
                loadOptions={loadCourseBatchesOptions}
                placeholder="Select batch (from this course)"
                className="w-full"
                disabled={!selectedCourse}
              />
              <div className="mt-3 text-xs text-gray-500">
                Select forms and a batch. Then manage inclusion and dates per row in the table below.
              </div>
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800">
              Per-student & per-form assessment dates
            </div>
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full text-sm min-w-[780px]">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold w-[44px]"> </th>
                    <th className="text-left px-3 py-2 font-semibold w-[34%]">Student</th>
                    <th className="text-left px-3 py-2 font-semibold w-[40%]">Form</th>
                    <th className="text-left px-3 py-2 font-semibold w-[13%]">Start</th>
                    <th className="text-left px-3 py-2 font-semibold w-[13%]">End</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const studentIds = [...new Set(selectedStudentIds)];
                    const formIds = [...new Set(sendFormIds)];
                    const formById = new Map(sendCourseForms.map((f) => [f.id, f] as const));
                    const studentById = new Map(sendStudents.map((s) => [s.id, s] as const));
                    const rows: Array<{ key: string; studentId: number; formId: number }> = [];
                    for (const sid of studentIds) for (const fid of formIds) rows.push({ key: `${sid}:${fid}`, studentId: sid, formId: fid });
                    if (!sendBatchId) {
                      return (
                        <tr>
                          <td className="px-3 py-3 text-gray-500" colSpan={4}>
                            Select a batch to load students.
                          </td>
                        </tr>
                      );
                    }
                    if (rows.length === 0) {
                      return (
                        <tr>
                          <td className="px-3 py-3 text-gray-500" colSpan={4}>
                            Select at least one form and one student.
                          </td>
                        </tr>
                      );
                    }
                    return rows.map((r) => {
                      const s = studentById.get(r.studentId);
                      const f = formById.get(r.formId);
                      const pair = sendDatesByPair[r.key] ?? { start: sendStartDate, end: sendEndDate };
                      const enabled = sendPairEnabled[r.key] !== false;
                      return (
                        <tr key={r.key} className={`border-t border-gray-100 ${enabled ? '' : 'opacity-50'}`}>
                          <td className="px-3 py-2 align-top">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => setSendPairEnabled((prev) => ({ ...prev, [r.key]: e.target.checked }))}
                              aria-label="Include this assessment"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-gray-900">{s?.name ?? `Student #${r.studentId}`}</div>
                            <div className="text-xs text-gray-500 truncate">{s?.email ?? ''}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-gray-900 line-clamp-2">{f?.name ?? `Form #${r.formId}`}</div>
                            <div className="text-xs text-gray-500">v{f?.version ?? '1.0.0'}</div>
                          </td>
                          <td className="px-3 py-2">
                            <DatePicker
                              value={pair.start}
                              onChange={(v) => {
                                const val = v || '';
                                setSendDatesTouched((prev) => ({ ...prev, [r.key]: true }));
                                setSendDatesByPair((prev) => ({ ...prev, [r.key]: { start: val, end: (prev[r.key]?.end ?? pair.end) } }));
                              }}
                              compact
                              placement="above"
                              className="w-[140px] max-w-[140px]"
                              disabled={!enabled}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <DatePicker
                              value={pair.end}
                              onChange={(v) => {
                                const val = v || '';
                                setSendDatesTouched((prev) => ({ ...prev, [r.key]: true }));
                                setSendDatesByPair((prev) => ({ ...prev, [r.key]: { start: (prev[r.key]?.start ?? pair.start), end: val } }));
                              }}
                              compact
                              placement="above"
                              className="w-[140px] max-w-[140px]"
                              minDate={pair.start || undefined}
                              disabled={!enabled}
                            />
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-[var(--border)]">
          <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSendUnits}
            disabled={sending || !selectedCourse || sendFormIds.length === 0 || !sendBatchId || selectedStudentIds.length === 0}
          >
            {sending ? (
              <>
                <Loader variant="dots" size="sm" inline className="mr-2" />
                Sending…
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2 inline" />
                Send & Download PDF
              </>
            )}
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={downloadsOpen}
        onClose={() => setDownloadsOpen(false)}
        title="Downloads (generic links PDFs)"
        size="lg"
      >
        <div className="space-y-3">
          <div className="text-sm text-gray-700">
            <div className="font-semibold">{downloadsCourse?.name ?? 'Course'}</div>
            <div className="text-xs text-gray-500">These are saved snapshots of previously generated PDFs.</div>
          </div>
          {downloadsLoading ? (
            <div className="py-8">
              <Loader variant="dots" size="lg" message="Loading downloads..." />
            </div>
          ) : exports.length === 0 ? (
            <div className="text-sm text-gray-500">No downloads yet for this course.</div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Generated</th>
                    <th className="text-left px-3 py-2 font-semibold">Forms</th>
                    <th className="text-right px-3 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.map((ex) => (
                    <tr key={ex.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-700">{new Date(ex.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-gray-700">
                        {(() => {
                          const p = ex.payload_json as { forms?: Array<{ name?: string; version?: string | null }> };
                          const forms = Array.isArray(p?.forms) ? p.forms : [];
                          if (forms.length === 0) return <span className="text-gray-400">—</span>;
                          const txt = forms
                            .map((f) => `${String(f?.name ?? '').trim()}${f?.version ? ` (v${f.version})` : ''}`)
                            .filter(Boolean);
                          return (
                            <div className="max-w-[520px] truncate" title={txt.join(', ')}>
                              {txt.join(', ')}
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="outline" size="sm" onClick={() => void downloadExportPdf(ex.payload_json)}>
                          Download PDF
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="flex justify-end pt-4 mt-4 border-t border-[var(--border)]">
          <Button variant="outline" onClick={() => setDownloadsOpen(false)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
};
