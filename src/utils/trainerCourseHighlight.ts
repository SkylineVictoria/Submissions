/** Persists the trainer's selected course on Course units so other screens can visually match assessments to that unit. */

import { useEffect, useState } from 'react';

export const TRAINER_HIGHLIGHT_COURSE_STORAGE_KEY = 'signflow.trainerHighlightCourseId';

export const TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS =
  'ring-1 ring-amber-200/90 bg-amber-50/65 shadow-[inset_3px_0_0_0_rgba(251,146,60,0.65)]';

export function getTrainerHighlightCourseId(): number | null {
  try {
    const raw = localStorage.getItem(TRAINER_HIGHLIGHT_COURSE_STORAGE_KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  } catch {
    return null;
  }
}

export function setTrainerHighlightCourseId(courseId: number | null): void {
  try {
    if (courseId == null || !Number.isFinite(courseId) || courseId <= 0) {
      localStorage.removeItem(TRAINER_HIGHLIGHT_COURSE_STORAGE_KEY);
    } else {
      localStorage.setItem(TRAINER_HIGHLIGHT_COURSE_STORAGE_KEY, String(Math.floor(courseId)));
    }
    window.dispatchEvent(new CustomEvent('signflow-trainer-highlight-course'));
  } catch {
    /* ignore */
  }
}

export function rowMatchesTrainerHighlightCourse(row: { form_course_ids?: number[] }, highlightCourseId: number | null): boolean {
  if (highlightCourseId == null) return false;
  const ids = row.form_course_ids;
  if (!ids || ids.length === 0) return false;
  return ids.includes(highlightCourseId);
}

/** Re-read when trainer changes course (same tab) or another tab updates storage. */
export function useTrainerHighlightCourseId(): number | null {
  const [id, setId] = useState<number | null>(() => getTrainerHighlightCourseId());
  useEffect(() => {
    const sync = () => setId(getTrainerHighlightCourseId());
    window.addEventListener('storage', sync);
    window.addEventListener('signflow-trainer-highlight-course', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('signflow-trainer-highlight-course', sync);
    };
  }, []);
  return id;
}
