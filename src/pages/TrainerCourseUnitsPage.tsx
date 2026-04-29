import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { Loader } from '../components/ui/Loader';
import { FormDocumentsPanel } from '../components/documents/FormDocumentsPanel';
import {
  getFormsForCourse,
  listTrainerCourseOptionsForUnits,
  type TrainerCourseOption,
} from '../lib/formEngine';
import type { Form } from '../types/database';
import { cn } from '../components/utils/cn';
import { setTrainerHighlightCourseId, TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS } from '../utils/trainerCourseHighlight';

export const TrainerCourseUnitsPage: React.FC = () => {
  const { user } = useAuth();
  const [courseOptions, setCourseOptions] = useState<TrainerCourseOption[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [forms, setForms] = useState<Form[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [selectedFormId, setSelectedFormId] = useState<string>('');

  const loadCourses = useCallback(async () => {
    const uid = user?.id;
    if (!uid) return;
    setCoursesLoading(true);
    try {
      const opts = await listTrainerCourseOptionsForUnits(uid);
      setCourseOptions(opts);
      setSelectedCourseId((prev) => {
        if (prev && opts.some((o) => String(o.courseId) === prev)) return prev;
        return opts.length > 0 ? String(opts[0].courseId) : '';
      });
    } finally {
      setCoursesLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadCourses();
  }, [loadCourses]);

  useEffect(() => {
    const cid = Number(selectedCourseId);
    if (!Number.isFinite(cid) || cid <= 0) {
      setForms([]);
      setFormsLoading(false);
      return;
    }
    let cancelled = false;
    setForms([]);
    setFormsLoading(true);
    void getFormsForCourse(cid, { asAdmin: false }).then((list) => {
      if (!cancelled) {
        setForms(list);
        setFormsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedCourseId]);

  useEffect(() => {
    setSelectedFormId((prev) => {
      if (forms.some((f) => String(f.id) === prev)) return prev;
      return forms.length > 0 ? String(forms[0].id) : '';
    });
  }, [forms]);

  useEffect(() => {
    const cid = Number(selectedCourseId);
    if (!Number.isFinite(cid) || cid <= 0) {
      setTrainerHighlightCourseId(null);
      return;
    }
    setTrainerHighlightCourseId(cid);
  }, [selectedCourseId]);

  const selectedCourse = courseOptions.find((o) => String(o.courseId) === selectedCourseId);
  const selectedForm = useMemo(() => forms.find((f) => String(f.id) === selectedFormId) ?? null, [forms, selectedFormId]);

  const unitSelectOptions = useMemo(
    () =>
      forms.map((f) => {
        const codePart = f.unit_code ? `Unit ${f.unit_code}` : null;
        const label = [codePart, f.name].filter(Boolean).join(' · ');
        return { value: String(f.id), label: label || f.name };
      }),
    [forms]
  );

  if (user && user.role !== 'trainer') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
            <BookOpen className="w-7 h-7 text-[var(--brand)]" />
            Course units
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Choose a course, then a unit to view student learning materials and trainer / assessor documents linked to your
            batches.
          </p>
        </div>

        {coursesLoading ? (
          <Card>
            <div className="py-12">
              <Loader variant="dots" size="lg" message="Loading your courses..." />
            </div>
          </Card>
        ) : courseOptions.length === 0 ? (
          <Card>
            <div className="py-10 px-4 text-center text-sm text-gray-600">
              No course is assigned to your batches yet, or your batches have no linked units. Ask an administrator to assign a
              course to your batch and link forms to that course.
            </div>
          </Card>
        ) : (
          <>
            <Card className="mb-6">
              <div className="grid gap-6 md:grid-cols-2 md:items-start max-w-4xl">
                <div className="max-w-xl min-w-0">
                  <Select
                    label="Course"
                    value={selectedCourseId}
                    onChange={setSelectedCourseId}
                    options={courseOptions.map((o) => ({
                      value: String(o.courseId),
                      label: o.qualificationCode ? `${o.courseName} (${o.qualificationCode})` : o.courseName,
                    }))}
                  />
                </div>
                <div className="max-w-xl min-w-0">
                  {formsLoading ? (
                    <div className="pt-1">
                      <span className="block text-sm font-semibold text-gray-700 mb-2">Unit</span>
                      <div className="rounded-lg border border-[var(--border)] bg-gray-50 px-4 py-3 text-sm text-gray-600">
                        Loading units…
                      </div>
                    </div>
                  ) : forms.length > 0 ? (
                    <Select
                      label="Unit"
                      value={selectedFormId}
                      onChange={setSelectedFormId}
                      options={unitSelectOptions}
                      searchable={forms.length > 8}
                      searchPlaceholder="Search units…"
                    />
                  ) : (
                    <div className="pt-1">
                      <span className="block text-sm font-semibold text-gray-700 mb-2">Unit</span>
                      <p className="text-sm text-gray-600">No units linked to this course.</p>
                    </div>
                  )}
                </div>
              </div>
              {selectedCourse && selectedCourse.batchNames.length > 0 ? (
                <p className="text-xs text-gray-500 mt-4">
                  Your batch{selectedCourse.batchNames.length > 1 ? 'es' : ''}: {selectedCourse.batchNames.join(', ')}
                </p>
              ) : null}
            </Card>

            <Card>
              <h2 className="text-lg font-bold text-[var(--text)] mb-4">Learning materials</h2>
              {formsLoading ? (
                <div className="py-10">
                  <Loader variant="dots" size="lg" message="Loading units..." />
                </div>
              ) : !selectedForm ? (
                <div className="text-sm text-gray-600 py-6">No active units are linked to this course.</div>
              ) : (
                <div
                  className={cn(
                    'rounded-lg border border-[var(--border)] bg-white overflow-hidden',
                    TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS
                  )}
                >
                  <div className="px-4 py-3 border-b border-[var(--border)] bg-gray-50/80">
                    <div className="font-semibold text-[var(--text)] break-words">{selectedForm.name}</div>
                    <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {selectedForm.unit_code ? <span>Unit {selectedForm.unit_code}</span> : null}
                      {selectedForm.unit_name ? <span>{selectedForm.unit_name}</span> : null}
                      {selectedForm.version ? <span>v{selectedForm.version}</span> : null}
                    </div>
                  </div>
                  <div className="px-3 py-3 bg-gray-50/80">
                    <FormDocumentsPanel
                      key={selectedForm.id}
                      formId={selectedForm.id}
                      formName={selectedForm.name}
                      canUpload={false}
                      canDelete={false}
                      showTrainerSection
                      autoLoad
                    />
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
