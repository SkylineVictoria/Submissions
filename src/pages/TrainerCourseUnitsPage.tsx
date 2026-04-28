import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BookOpen, ChevronDown } from 'lucide-react';
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

export const TrainerCourseUnitsPage: React.FC = () => {
  const { user } = useAuth();
  const [courseOptions, setCourseOptions] = useState<TrainerCourseOption[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(true);
  const [selectedCourseId, setSelectedCourseId] = useState<string>('');
  const [forms, setForms] = useState<Form[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [expandedFormId, setExpandedFormId] = useState<number | null>(null);

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
      return;
    }
    let cancelled = false;
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

  if (user && user.role !== 'trainer') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  const selectedCourse = courseOptions.find((o) => String(o.courseId) === selectedCourseId);

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
            <BookOpen className="w-7 h-7 text-[var(--brand)]" />
            Course units
          </h1>
          <p className="text-sm text-gray-600 mt-1">
            Units (forms) linked to your batches&apos; courses. Open a unit to view student learning materials and trainer /
            assessor documents.
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
              {courseOptions.length > 1 ? (
                <div className="max-w-xl">
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
              ) : (
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Course</div>
                  <div className="mt-1 text-lg font-semibold text-[var(--text)]">{selectedCourse?.courseName ?? '—'}</div>
                  {selectedCourse?.qualificationCode ? (
                    <div className="text-sm text-gray-600 mt-0.5">{selectedCourse.qualificationCode}</div>
                  ) : null}
                </div>
              )}
              {selectedCourse && selectedCourse.batchNames.length > 0 ? (
                <p className="text-xs text-gray-500 mt-3">
                  Your batch{selectedCourse.batchNames.length > 1 ? 'es' : ''}: {selectedCourse.batchNames.join(', ')}
                </p>
              ) : null}
            </Card>

            <Card>
              <h2 className="text-lg font-bold text-[var(--text)] mb-4">Units</h2>
              {formsLoading ? (
                <div className="py-10">
                  <Loader variant="dots" size="lg" message="Loading units..." />
                </div>
              ) : forms.length === 0 ? (
                <div className="text-sm text-gray-600 py-6">No active units are linked to this course.</div>
              ) : (
                <div className="space-y-2">
                  {forms.map((f) => {
                    const open = expandedFormId === f.id;
                    return (
                      <div key={f.id} className="rounded-lg border border-[var(--border)] bg-white overflow-hidden">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--brand)]/10 transition-colors"
                          onClick={() => setExpandedFormId((p) => (p === f.id ? null : f.id))}
                          aria-expanded={open}
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--text)] break-words">{f.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-1">
                              {f.unit_code ? <span>Unit {f.unit_code}</span> : null}
                              {f.unit_name ? <span>{f.unit_name}</span> : null}
                              {f.version ? <span>v{f.version}</span> : null}
                            </div>
                          </div>
                          <ChevronDown
                            className={cn('h-5 w-5 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')}
                          />
                        </button>
                        {open ? (
                          <div className="border-t border-[var(--border)] px-3 py-3 bg-gray-50/80">
                            <FormDocumentsPanel
                              formId={f.id}
                              formName={f.name}
                              canUpload={false}
                              canDelete={false}
                              showTrainerSection
                              autoLoad={open}
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
