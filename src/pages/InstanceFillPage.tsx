export function normalizeRichTextForPage(html?: string): string {
  if (!html) return '';

  if (typeof window === 'undefined') {
    return html
      .replace(/&nbsp;/gi, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/\u00AD/g, '');
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

  const textNodes: Node[] = [];
  let current: Node | null = walker.nextNode();

  while (current) {
    textNodes.push(current);
    current = walker.nextNode();
  }

  textNodes.forEach((node) => {
    node.textContent = (node.textContent || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\u00AD/g, '');
  });

  return doc.body.innerHTML;
}

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  fetchTemplateForInstance,
  fetchAnswersForInstance,
  fetchInstance,
  saveAnswer,
  saveTrainerAssessment,
  fetchTrainerAssessments,
  fetchTrainerRowAssessments,
  fetchResultsOffice,
  saveResultsOffice,
  fetchResultsData,
  saveResultsData,
  fetchAssessmentSummaryData,
  saveAssessmentSummaryData,
  updateInstanceRole,
  updateInstanceWorkflowStatus,
  validateInstanceAccessToken,
  revokeRoleAccessTokens,
} from '../lib/formEngine';
import type { FormTemplate, FormQuestionWithOptionsAndRows, FormSectionWithQuestions } from '../lib/formEngine';
import { getTaskQuestionDisplayNumbers } from '../lib/taskQuestionsNumbering';
import type { FormAnswer } from '../types/database';
import type { FormRole } from '../utils/roleGuard';
import { isRoleVisible, isRoleEditable } from '../utils/roleGuard';
import { Card } from '../components/ui/Card';
import { Loader } from '../components/ui/Loader';
import { Button } from '../components/ui/Button';
import { Stepper } from '../components/ui/Stepper';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { QuestionRenderer } from '../components/form-fill/QuestionRenderer';
import { SectionLikertTable } from '../components/form-fill/SectionLikertTable';
import { SignatureField } from '../components/form-fill/SignatureField';
import { AppendixAMatrixForm } from '../components/form-fill/AppendixAMatrixForm';
import { DatePicker } from '../components/ui/DatePicker';
import { toast } from '../utils/toast';

const PDF_BASE = import.meta.env.VITE_PDF_API_URL ?? '';

function getAnswerKey(questionId: number, rowId: number | null): string {
  if (rowId === null) return `q-${questionId}`;
  return `q-${questionId}-${rowId}`;
}

/**
 * Normalize calendar strings to yyyy-MM-dd for ordering. DB/UI may have ISO or dd-MM-yyyy;
 * raw string compare wrongly treats '01-03-2026' < '2026-03-02'.
 */
function normalizeCalendarDateToIso(s: string | null | undefined): string | null {
  const t = String(s ?? '').trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{2}-\d{2}-\d{4}$/.test(t)) {
    const [dd, mm, yyyy] = t.split('-');
    if (dd && mm && yyyy && dd.length === 2 && mm.length === 2 && yyyy.length === 4) return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function isCalendarBefore(a: string | null | undefined, b: string | null | undefined): boolean {
  const ai = normalizeCalendarDateToIso(a);
  const bi = normalizeCalendarDateToIso(b);
  if (!ai || !bi) return false;
  return ai < bi;
}

/** Latest of ISO yyyy-MM-dd strings (for min date on 3rd attempt ≥ 1st and 2nd). */
function maxIsoDate(...vals: (string | null | undefined)[]): string | undefined {
  const norm = vals.map((v) => normalizeCalendarDateToIso(v)).filter((x): x is string => !!x);
  if (norm.length === 0) return undefined;
  return norm.reduce((a, b) => (a >= b ? a : b));
}

/**
 * Task results sheet (trainer outcomes): enforce the same chronological hierarchy as the assessment summary.
 *
 * Assessment summary chain is:
 * Student1 → Trainer1 → Student2 → Trainer2 → Student3 → Trainer3.
 *
 * Results sheet attempt dates are trainer-recorded outcomes. So:
 * - Attempt 1 results date must be ≥ assessment summary Student1 date.
 * - Attempt 2 results date must be ≥ assessment summary Trainer1 date (and ≥ Attempt 1 results date).
 * - Attempt 3 results date must be ≥ assessment summary Trainer2 date (and ≥ Attempt 2 results date).
 */
function getResultsMinFirstAttemptDate(
  sum: import('../lib/formEngine').AssessmentSummaryDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(sum?.student_date_1 ?? undefined);
}

function getResultsMinSecondAttemptDate(
  rd: import('../lib/formEngine').ResultsDataEntry | null | undefined,
  sum: import('../lib/formEngine').AssessmentSummaryDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(
    rd?.first_attempt_date ?? undefined,
    sum?.trainer_date_1 ?? undefined,
    // Must not be before summary student attempt-2 date.
    sum?.student_date_2 ?? undefined,
    sum?.student_date_1 ?? undefined,
  );
}

function getResultsMinThirdAttemptDate(
  rd: import('../lib/formEngine').ResultsDataEntry | null | undefined,
  sum: import('../lib/formEngine').AssessmentSummaryDataEntry | null | undefined,
): string | undefined {
  return maxIsoDate(
    rd?.first_attempt_date ?? undefined,
    rd?.second_attempt_date ?? undefined,
    sum?.trainer_date_2 ?? undefined,
    // Must not be before summary student attempt-3 date.
    sum?.student_date_3 ?? undefined,
    sum?.student_date_2 ?? undefined,
    sum?.trainer_date_1 ?? undefined,
    sum?.student_date_1 ?? undefined,
  );
}

function addIsoDays(iso: string, days: number): string | undefined {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Earliest ISO date allowed on student.declarationSignature for resubmissions (strictly after trainer assessment). */
function getStudentResubDeclarationMinDate(
  rd: import('../lib/formEngine').ResultsDataEntry | null | undefined,
  submissionCount: number,
): string | undefined {
  if (!rd || submissionCount < 2) return undefined;
  const baseDeclMin =
    submissionCount >= 3
      ? maxIsoDate(
          rd.second_attempt_date ?? undefined,
          rd.trainer_date ?? undefined,
          rd.first_attempt_date ?? undefined,
        )
      : maxIsoDate(rd.trainer_date ?? undefined, rd.first_attempt_date ?? undefined);
  return baseDeclMin ? (addIsoDays(baseDeclMin, 1) ?? baseDeclMin) : undefined;
}

/**
 * Assessment summary sheet: chronological chain S1 → T1 → S2 → T2 → S3 → T3 (calendar order).
 * Each step must be on or after the previous step. Trainer date for an attempt must be ≥ student date for that attempt.
 * Attempt 1 is not tied to instance submitted_at (assessment may be recorded before the cover sheet is submitted).
 */
function getAssessmentSummaryDateChainMins(sum: import('../lib/formEngine').AssessmentSummaryDataEntry): {
  minStudentDate1: string | undefined;
  minTrainerDate1: string | undefined;
  minStudentDate2: string | undefined;
  minTrainerDate2: string | undefined;
  minStudentDate3: string | undefined;
  minTrainerDate3: string | undefined;
} {
  const s1 = sum.student_date_1?.trim() || '';
  const t1 = sum.trainer_date_1?.trim() || '';
  const s2 = sum.student_date_2?.trim() || '';
  const t2 = sum.trainer_date_2?.trim() || '';
  const s3 = sum.student_date_3?.trim() || '';

  return {
    minStudentDate1: undefined,
    minTrainerDate1: maxIsoDate(s1 || undefined),
    minStudentDate2: maxIsoDate(t1 || undefined, s1 || undefined),
    minTrainerDate2: maxIsoDate(t1 || undefined, s2 || undefined),
    minStudentDate3: maxIsoDate(t2 || undefined, s2 || undefined, t1 || undefined),
    minTrainerDate3: maxIsoDate(t2 || undefined, s3 || undefined),
  };
}

function clampIsoToMin(value: string | null | undefined, min: string | undefined): string | null {
  const v = String(value ?? '').trim();
  const m = min?.trim();
  if (!m) return v || null;
  if (!v) return null;
  const vi = normalizeCalendarDateToIso(v);
  const mi = normalizeCalendarDateToIso(m);
  if (vi && mi && vi < mi) return mi;
  return v;
}

function validateAssessmentSummaryDateChain(sum: import('../lib/formEngine').AssessmentSummaryDataEntry): string | null {
  const s1 = sum.student_date_1?.trim();
  const t1 = sum.trainer_date_1?.trim();
  const s2 = sum.student_date_2?.trim();
  const t2 = sum.trainer_date_2?.trim();
  const s3 = sum.student_date_3?.trim();
  const t3 = sum.trainer_date_3?.trim();

  if (s1 && t1 && isCalendarBefore(t1, s1)) return 'Trainer date (attempt 1) cannot be before the student date (attempt 1).';
  if (t1 && s2 && isCalendarBefore(s2, t1)) return 'Student date (attempt 2) cannot be before the trainer date (attempt 1).';
  if (s1 && s2 && isCalendarBefore(s2, s1)) return 'Student date (attempt 2) cannot be before the student date (attempt 1).';
  if (s2 && t2 && isCalendarBefore(t2, s2)) return 'Trainer date (attempt 2) cannot be before the student date (attempt 2).';
  if (t1 && t2 && isCalendarBefore(t2, t1)) return 'Trainer date (attempt 2) cannot be before the trainer date (attempt 1).';
  if (t2 && s3 && isCalendarBefore(s3, t2)) return 'Student date (attempt 3) cannot be before the trainer date (attempt 2).';
  if (s2 && s3 && isCalendarBefore(s3, s2)) return 'Student date (attempt 3) cannot be before the student date (attempt 2).';
  if (s3 && t3 && isCalendarBefore(t3, s3)) return 'Trainer date (attempt 3) cannot be before the student date (attempt 3).';
  if (t2 && t3 && isCalendarBefore(t3, t2)) return 'Trainer date (attempt 3) cannot be before the trainer date (attempt 2).';
  return null;
}

type AnswersMap = Record<string, string | number | boolean | Record<string, unknown> | string[]>;

function rowAnswerHasContent(val: string | number | boolean | Record<string, unknown> | string[] | undefined): boolean {
  if (val == null) return false;
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.values(val as Record<string, unknown>).some((v) => String(v ?? '').trim());
  }
  return String(val).trim() !== '';
}

type GridColumnType = 'question' | 'answer';

function normalizeGridColumnType(raw: unknown): GridColumnType {
  return String(raw ?? '').trim().toLowerCase() === 'question' ? 'question' : 'answer';
}

function getGridAnswerColumnIndexes(q: FormQuestionWithOptionsAndRows): number[] {
  const pm = (q.pdf_meta as Record<string, unknown>) || {};
  const colsMeta = pm.columnsMeta;
  if (Array.isArray(colsMeta) && colsMeta.length > 0) {
    return colsMeta
      .map((entry, idx) => {
        if (!entry || typeof entry !== 'object') return idx;
        const e = entry as Record<string, unknown>;
        return normalizeGridColumnType(e.type) === 'answer' ? idx : -1;
      })
      .filter((idx) => idx >= 0);
  }
  const columns = Array.isArray(pm.columns) ? (pm.columns as unknown[]) : [];
  const types = Array.isArray(pm.columnTypes) ? (pm.columnTypes as unknown[]) : [];
  if (columns.length > 0) {
    return columns
      .map((_, idx) => (normalizeGridColumnType(types[idx]) === 'answer' ? idx : -1))
      .filter((idx) => idx >= 0);
  }
  return [0];
}

function isGridTableFilled(q: FormQuestionWithOptionsAndRows, answers: AnswersMap): boolean {
  if (q.type !== 'grid_table' || !q.rows?.length) return false;
  const pm = (q.pdf_meta as Record<string, unknown>) || {};
  const layout = String(pm.layout ?? 'no_image');
  const isNoHeader = layout === 'no_image_no_header';
  const answerColIndexes = getGridAnswerColumnIndexes(q);
  const hasQuestionTypedColumn = (() => {
    const colsMeta = pm.columnsMeta;
    if (Array.isArray(colsMeta) && colsMeta.length > 0) {
      return colsMeta.some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        return normalizeGridColumnType((entry as Record<string, unknown>).type) === 'question';
      });
    }
    const types = Array.isArray(pm.columnTypes) ? (pm.columnTypes as unknown[]) : [];
    return types.some((t) => normalizeGridColumnType(t) === 'question');
  })();

  // Case 2: no-header + question-row style table:
  // required means at least one answer column must be fully filled down all rows.
  if (isNoHeader && hasQuestionTypedColumn && answerColIndexes.length > 0) {
    for (const colIdx of answerColIndexes) {
      let allRowsFilledForColumn = true;
      for (const r of q.rows) {
        const rowVal = answers[getAnswerKey(q.id, r.id)];
        const rowObj = rowVal && typeof rowVal === 'object' && !Array.isArray(rowVal)
          ? (rowVal as Record<string, unknown>)
          : null;
        const cellVal = rowObj ? String(rowObj[`r${r.id}_c${colIdx}`] ?? '').trim() : '';
        if (!cellVal) {
          allRowsFilledForColumn = false;
          break;
        }
      }
      if (allRowsFilledForColumn) return true;
    }
    return false;
  }

  // Case 1: header table (or generic grid):
  // required means one full row across answer columns is enough.
  if (answerColIndexes.length > 0) {
    for (const r of q.rows) {
      const rowVal = answers[getAnswerKey(q.id, r.id)];
      const rowObj = rowVal && typeof rowVal === 'object' && !Array.isArray(rowVal)
        ? (rowVal as Record<string, unknown>)
        : null;
      if (!rowObj) continue;
      let fullRow = true;
      for (const colIdx of answerColIndexes) {
        const cellVal = String(rowObj[`r${r.id}_c${colIdx}`] ?? '').trim();
        if (!cellVal) {
          fullRow = false;
          break;
        }
      }
      if (fullRow) return true;
    }
    return false;
  }

  // Fallback for legacy data shapes: any row having content counts as answered.
  for (const r of q.rows) {
    const key = getAnswerKey(q.id, r.id);
    if (rowAnswerHasContent(answers[key])) return true;
  }
  return false;
}

function isLikertFilled(q: FormQuestionWithOptionsAndRows, answers: AnswersMap): boolean {
  if (q.type !== 'likert_5' || !q.rows?.length) return false;
  if (q.rows.length === 1) {
    const v = answers[getAnswerKey(q.id, q.rows[0].id)];
    return v != null && String(v).trim() !== '';
  }
  for (const r of q.rows) {
    const v = answers[getAnswerKey(q.id, r.id)];
    if (v == null || !String(v).trim()) return false;
  }
  return true;
}

/** Parent question with embedded `contentBlocks` answers child question IDs; row-based answers live on children, not `q-{parentId}`. */
function isRequiredSatisfiedByContentBlocks(
  q: FormQuestionWithOptionsAndRows,
  section: FormSectionWithQuestions,
  answers: AnswersMap
): boolean | null {
  const pm = (q.pdf_meta as Record<string, unknown>) || {};
  const blocks = pm.contentBlocks as Array<{ type: string; questionId?: number }> | undefined;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const hasBlockInputs = blocks.some(
    (b) => b.questionId && (b.type === 'grid_table' || b.type === 'short_text' || b.type === 'long_text')
  );
  if (!hasBlockInputs) return null;

  let allGridsOk = true;
  let anyGridBlock = false;
  let allTextBlocksOk = true;
  let anyTextBlock = false;

  for (const b of blocks) {
    if (!b.questionId) continue;
    const childQ = section.questions.find((x) => x.id === b.questionId);
    if (!childQ) continue;
    if (b.type === 'grid_table' && childQ.rows?.length) {
      anyGridBlock = true;
      if (!isGridTableFilled(childQ, answers)) allGridsOk = false;
    } else if (b.type === 'short_text' || b.type === 'long_text') {
      anyTextBlock = true;
      if (childQ.required && !String(answers[getAnswerKey(childQ.id, null)] ?? '').trim()) allTextBlocksOk = false;
    }
  }

  const parentKey = getAnswerKey(q.id, null);
  const parentFilled = String(answers[parentKey] ?? '').trim() !== '';

  if (parentFilled) return true;
  if (anyGridBlock && !allGridsOk) return false;
  if (anyTextBlock && !allTextBlocksOk) return false;
  return (anyGridBlock && allGridsOk) || (anyTextBlock && allTextBlocksOk);
}

function parseAnswerValue(a: FormAnswer): string | number | boolean | Record<string, unknown> | string[] | null {
  if (a.value_text) return a.value_text;
  if (a.value_number != null) return a.value_number;
  if (a.value_json != null) return a.value_json as Record<string, unknown> | string[];
  return null;
}

export const InstanceFillPage: React.FC = () => {
  const { instanceId } = useParams<{ instanceId: string }>();
  const [searchParams] = useSearchParams();
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number | boolean | Record<string, unknown> | string[]>>({});
  const [trainerAssessments, setTrainerAssessments] = useState<Record<number, string>>({});
  const [trainerRowAssessments, setTrainerRowAssessments] = useState<Record<string, string>>({});
  const [resultsOffice, setResultsOffice] = useState<Record<number, { entered_date: string | null; entered_by: string | null }>>({});
  const [resultsData, setResultsData] = useState<Record<number, import('../lib/formEngine').ResultsDataEntry>>({});
  const [assessmentSummary, setAssessmentSummary] = useState<import('../lib/formEngine').AssessmentSummaryDataEntry | null>(null);
  const [role, setRole] = useState<FormRole>('student');
  const [workflowStatus, setWorkflowStatus] = useState<'draft' | 'waiting_trainer' | 'waiting_office' | 'completed'>('draft');
  const [submissionCount, setSubmissionCount] = useState<number>(0);
  const [confirmConfig, setConfirmConfig] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
  } | null>(null);
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const formScrollRef = useRef<HTMLFormElement>(null);

  const id = instanceId ? Number(instanceId) : 0;
  const accessToken = searchParams.get('token')?.trim() || '';
  const [pdfRefresh, setPdfRefresh] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(true);
  const pdfCacheBust = useMemo(() => Date.now(), [id, pdfRefresh]);
  useEffect(() => {
    setPdfLoading(true);
  }, [pdfCacheBust]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setAccessDenied(null);
    setLoading(true);
    if (!accessToken) {
      setAccessDenied('Secure access token is missing. Please use the link shared by admin.');
      setLoading(false);
      return;
    }
    const access = await validateInstanceAccessToken(id, accessToken);
    if (!access.valid || !access.role_context) {
      setAccessDenied(access.reason || 'Invalid secure access link.');
      setLoading(false);
      return;
    }
    const tokenRole = access.role_context as FormRole;
    setRole(tokenRole);
    const [tpl, ans, inst, assessments, rowAssessments, officeData, resultsDataRes, summaryData] = await Promise.all([
      fetchTemplateForInstance(id),
      fetchAnswersForInstance(id),
      fetchInstance(id),
      fetchTrainerAssessments(id).catch(() => ({})),
      fetchTrainerRowAssessments(id).catch(() => ({})),
      fetchResultsOffice(id).catch(() => ({})),
      fetchResultsData(id).catch(() => ({})),
      fetchAssessmentSummaryData(id).catch(() => null),
    ]);
    if (!tpl || !inst) {
      setAccessDenied('Form not found or unavailable.');
      setLoading(false);
      return;
    }
    setTemplate(tpl || null);
    const roleCtx = (inst?.role_context as FormRole) || 'student';
    const rawWorkflow = (inst as unknown as { workflow_status?: string } | null)?.workflow_status;
    const legacyStatus = (inst as unknown as { status?: string } | null)?.status;
    const normalizedWorkflow = (
      rawWorkflow
        ? rawWorkflow
        : legacyStatus === 'locked'
          ? 'completed'
          : legacyStatus === 'submitted'
            ? (roleCtx === 'office' ? 'waiting_office' : 'waiting_trainer')
            : legacyStatus === 'draft' && roleCtx === 'trainer'
              ? 'waiting_trainer'
              : legacyStatus === 'draft' && roleCtx === 'office'
                ? 'waiting_office'
                : 'draft'
    ) as 'draft' | 'waiting_trainer' | 'waiting_office' | 'completed';
    setWorkflowStatus(normalizedWorkflow);
    const instSubmittedAt = (inst as unknown as { submitted_at?: string } | null)?.submitted_at;
    const instSubmissionCount = Number((inst as unknown as { submission_count?: number | null } | null)?.submission_count ?? 0) || 0;
    setSubmissionCount(instSubmissionCount || (instSubmittedAt ? 1 : 0));
    const ansMap: Record<string, string | number | boolean | Record<string, unknown> | string[]> = {};
    for (const a of ans) {
      const key = getAnswerKey(a.question_id, a.row_id);
      ansMap[key] = parseAnswerValue(a) as string | number | boolean | Record<string, unknown> | string[];
    }
    setAnswers(ansMap);
    setTrainerAssessments(assessments || {});
    setTrainerRowAssessments(rowAssessments || {});
    const officeMap: Record<number, { entered_date: string | null; entered_by: string | null }> = {};
    for (const [secId, entry] of Object.entries(officeData || {})) {
      const e = entry as { entered_date: string | null; entered_by: string | null };
      officeMap[Number(secId)] = { entered_date: e.entered_date, entered_by: e.entered_by };
    }
    setResultsOffice(officeMap);
    setResultsData(resultsDataRes || {});
    setAssessmentSummary(summaryData || null);
    setLoading(false);
  }, [id, accessToken]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Normalize signature values: accept string or object with signature/imageDataUrl/typedText. DB stores TEXT. */
  const normalizeSignatureValue = useCallback((v: string | null | { signature?: string; imageDataUrl?: string; typedText?: string } | undefined): string | null => {
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'object' && !Array.isArray(v)) {
      const s = String((v as Record<string, unknown>).signature ?? (v as Record<string, unknown>).imageDataUrl ?? (v as Record<string, unknown>).typedText ?? '').trim();
      return s || null;
    }
    return null;
  }, []);

  const handleResultsDataChange = useCallback(
    async (sectionId: number, field: keyof import('../lib/formEngine').ResultsDataEntry, value: string | null) => {
      const isSig = field === 'student_signature' || field === 'trainer_signature';
      const normalized = isSig ? normalizeSignatureValue(value) : (value != null ? String(value).trim() || null : null);
      let rejectReason: string | null = null;
      setResultsData((prev) => {
        const rd = prev[sectionId];
        const base = rd ?? ({ section_id: sectionId } as import('../lib/formEngine').ResultsDataEntry);
        if (field === 'first_attempt_date' && normalized) {
          const minFirst = getResultsMinFirstAttemptDate(assessmentSummary);
          if (minFirst && isCalendarBefore(normalized, minFirst)) {
            rejectReason = 'First attempt date must be on or after the student date (attempt 1) on the assessment summary.';
            return prev;
          }
        }
        if (field === 'second_attempt_date' && normalized) {
          const minSecond = getResultsMinSecondAttemptDate(base, assessmentSummary);
          if (minSecond && isCalendarBefore(normalized, minSecond)) {
            rejectReason =
              'Second attempt date must be on or after the student date (attempt 2) on the assessment summary and the first attempt date.';
            return prev;
          }
        }
        if (field === 'third_attempt_date' && normalized) {
          const minThird = getResultsMinThirdAttemptDate(base, assessmentSummary);
          if (minThird && isCalendarBefore(normalized, minThird)) {
            rejectReason =
              'Third attempt date must be on or after the student date (attempt 3) on the assessment summary and earlier attempt dates.';
            return prev;
          }
        }

        const next = { ...prev };
        const prevRd = prev[sectionId];
        next[sectionId] = {
          ...(prevRd ?? ({ section_id: sectionId } as import('../lib/formEngine').ResultsDataEntry)),
          [field]: normalized,
        } as import('../lib/formEngine').ResultsDataEntry;
        return next;
      });
      if (rejectReason) {
        toast.error(rejectReason);
        return;
      }
      await saveResultsData(id, sectionId, { [field]: normalized });
      setPdfRefresh((r) => r + 1);
    },
    [id, normalizeSignatureValue, assessmentSummary]
  );

  useEffect(() => {
    if (!template || !id) return;
    const studentNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
    const trainerNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.fullName');
    const studentName = studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '').trim() : '';
    const trainerName = trainerNameQ ? String(answers[getAnswerKey(trainerNameQ.id, null)] ?? '').trim() : '';
    const taskResultSections = template.steps?.flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results') ?? [];
    const updates: { sectionId: number; field: 'student_name' | 'trainer_name'; value: string }[] = [];
    for (const sec of taskResultSections) {
      const rd = resultsData[sec.id];
      const currentStudentName = (rd?.student_name ?? '').trim();
      const currentTrainerName = (rd?.trainer_name ?? '').trim();
      const sigIsTypedText = (s: string | null | undefined) => s && typeof s === 'string' && !s.startsWith('data:') && s.length > 1;
      const betterStudent = studentName || (sigIsTypedText(rd?.student_signature) ? rd!.student_signature! : '');
      const betterTrainer = trainerName || (sigIsTypedText(rd?.trainer_signature) ? rd!.trainer_signature! : '');
      if (betterStudent && (currentStudentName === '' || betterStudent.length > currentStudentName.length)) {
        updates.push({ sectionId: sec.id, field: 'student_name', value: betterStudent });
      }
      if (betterTrainer && (currentTrainerName === '' || betterTrainer.length > currentTrainerName.length)) {
        updates.push({ sectionId: sec.id, field: 'trainer_name', value: betterTrainer });
      }
    }
    if (updates.length === 0) return;
    setResultsData((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        const existing = prev[u.sectionId];
        next[u.sectionId] = {
          ...(existing ?? ({ section_id: u.sectionId } as import('../lib/formEngine').ResultsDataEntry)),
          [u.field]: u.value,
        } as import('../lib/formEngine').ResultsDataEntry;
        saveResultsData(id, u.sectionId, { [u.field]: u.value });
      }
      setPdfRefresh((r) => r + 1);
      return next;
    });
  }, [template, answers, resultsData, id]);

  useEffect(() => {
    if (!template || !id) return;
    const studentNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
    const trainerNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.fullName');
    const evalStudentNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'evaluation.studentName');
    const evalTrainerNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'evaluation.trainerName');
    const studentName = studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '').trim() : '';
    const trainerName = trainerNameQ ? String(answers[getAnswerKey(trainerNameQ.id, null)] ?? '').trim() : '';
    if (!studentName && !trainerName) return;
    const updates: { questionId: number; value: string }[] = [];
    if (evalStudentNameQ && studentName) {
      const current = String(answers[getAnswerKey(evalStudentNameQ.id, null)] ?? '').trim();
      if (current !== studentName) updates.push({ questionId: evalStudentNameQ.id, value: studentName });
    }
    if (evalTrainerNameQ && trainerName) {
      const current = String(answers[getAnswerKey(evalTrainerNameQ.id, null)] ?? '').trim();
      if (current !== trainerName) updates.push({ questionId: evalTrainerNameQ.id, value: trainerName });
    }
    if (updates.length === 0) return;
    setAnswers((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        next[getAnswerKey(u.questionId, null)] = u.value;
      }
      return next;
    });
    for (const u of updates) {
      saveAnswer(id, u.questionId, null, { text: u.value });
    }
    setPdfRefresh((r) => r + 1);
  }, [template, answers, id]);

  useEffect(() => {
    if (!template || !id) return;
    const formExt = template.form as { unit_code?: string | null; unit_name?: string | null } | undefined;
    const unitName = formExt ? [formExt.unit_code, formExt.unit_name].filter(Boolean).join(' ').trim() : '';
    if (!unitName) return;
    const evalUnitNameQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'evaluation.unitName');
    if (!evalUnitNameQ) return;
    const current = String(answers[getAnswerKey(evalUnitNameQ.id, null)] ?? '').trim();
    if (current) return;
    setAnswers((prev) => {
      const next = { ...prev };
      next[getAnswerKey(evalUnitNameQ.id, null)] = unitName;
      return next;
    });
    saveAnswer(id, evalUnitNameQ.id, null, { text: unitName });
    setPdfRefresh((r) => r + 1);
  }, [template, answers, id]);

  useEffect(() => {
    if (!template || !id) return;
    const taskResultSectionIds = (template.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
    const firstTaskSectionId = taskResultSectionIds[0];
    const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
    const raDateSource = firstTaskRd?.trainer_date ?? assessmentSummary?.trainer_date_1;
    if (!raDateSource) return;
    const raTrainerQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
    if (!raTrainerQ) return;
    const raVal = answers[getAnswerKey(raTrainerQ.id, null)];
    const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
    const raDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
    if (raDate) return;
    const base = raSigObj && typeof raSigObj === 'object' ? { ...raSigObj } : (typeof raVal === 'string' ? { signature: raVal } : {});
    const newVal = { ...base, date: raDateSource };
    setAnswers((prev) => {
      const next = { ...prev };
      next[getAnswerKey(raTrainerQ.id, null)] = newVal as string | number | boolean | Record<string, unknown> | string[];
      return next;
    });
    saveAnswer(id, raTrainerQ.id, null, { json: newVal });
    setPdfRefresh((r) => r + 1);
  }, [template, answers, resultsData, assessmentSummary, id]);

  useEffect(() => {
    if (!template || !id) return;
    const taskResultSectionIds = (template.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
    const firstTaskSectionId = taskResultSectionIds[0];
    const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
    const raTrainerQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
    const raVal = raTrainerQ ? answers[getAnswerKey(raTrainerQ.id, null)] : undefined;
    const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
    const raTrainerDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
    /** Only trainer-entered or copied from first task sheet — never auto-fill from student submit / today. 2nd/3rd attempts stay empty until the trainer records that attempt. */
    const firstAttemptSource = raTrainerDate || firstTaskRd?.first_attempt_date || '';
    const secondStartedOnFirstTask =
      !!(
        firstTaskRd?.second_attempt_date ||
        firstTaskRd?.second_attempt_satisfactory ||
        firstTaskRd?.second_attempt_feedback
      );
    const updates: { sectionId: number; field: 'trainer_date' | 'first_attempt_date'; value: string }[] = [];
    for (const sectionId of taskResultSectionIds) {
      const rd = resultsData[sectionId];
      const firstTaskData = firstTaskSectionId && firstTaskSectionId !== sectionId ? resultsData[firstTaskSectionId] : null;
      const trainerDateVal = raTrainerDate || firstTaskData?.trainer_date || '';
      const firstAttemptVal = firstAttemptSource;
      if (!rd?.trainer_date && trainerDateVal) updates.push({ sectionId, field: 'trainer_date', value: trainerDateVal });
      // Do not auto-fill first attempt date after a resubmission cycle or once 2nd attempt exists — avoids overwriting / cross-linking with 2nd attempt edits.
      if (
        !rd?.first_attempt_date &&
        firstAttemptVal &&
        submissionCount < 2 &&
        !secondStartedOnFirstTask
      ) {
        updates.push({ sectionId, field: 'first_attempt_date', value: firstAttemptVal });
      }
    }
    if (updates.length === 0) return;
    setResultsData((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        const existing = prev[u.sectionId];
        next[u.sectionId] = {
          ...(existing ?? ({ section_id: u.sectionId } as import('../lib/formEngine').ResultsDataEntry)),
          [u.field]: u.value,
        } as import('../lib/formEngine').ResultsDataEntry;
        saveResultsData(id, u.sectionId, { [u.field]: u.value });
      }
      setPdfRefresh((r) => r + 1);
      return next;
    });
  }, [template, answers, resultsData, id, submissionCount]);

  useEffect(() => {
    if (!template || !id) return;
    const taskResultSectionIds = (template.steps ?? [])
      .flatMap((st) => st.sections)
      .filter((s) => s.pdf_render_mode === 'task_results')
      .map((s) => s.id);
    if (taskResultSectionIds.length === 0) return;

    // If a later attempt was accidentally set before the prior attempt is truly complete,
    // clear the later attempt to avoid locking the workflow.
    const updates: { sectionId: number; patch: Partial<import('../lib/formEngine').ResultsDataEntry> }[] = [];
    for (const sectionId of taskResultSectionIds) {
      const rd = resultsData[sectionId];
      if (!rd) continue;

      const firstComplete = rowAnswerHasContent(rd.first_attempt_satisfactory ?? undefined) && rowAnswerHasContent(rd.first_attempt_date ?? undefined);
      const secondComplete = rowAnswerHasContent(rd.second_attempt_satisfactory ?? undefined) && rowAnswerHasContent(rd.second_attempt_date ?? undefined);
      const secondUnlockedByResubmission = submissionCount >= 2;
      const thirdUnlockedByResubmission = submissionCount >= 3;

      const hasSecondAny =
        rowAnswerHasContent(rd.second_attempt_satisfactory ?? undefined) ||
        rowAnswerHasContent(rd.second_attempt_date ?? undefined) ||
        rowAnswerHasContent(rd.second_attempt_feedback ?? undefined);
      const hasThirdAny =
        rowAnswerHasContent(rd.third_attempt_satisfactory ?? undefined) ||
        rowAnswerHasContent(rd.third_attempt_date ?? undefined) ||
        rowAnswerHasContent(rd.third_attempt_feedback ?? undefined);

      const patch: Partial<import('../lib/formEngine').ResultsDataEntry> = {};
      if ((!firstComplete || !secondUnlockedByResubmission) && hasSecondAny) {
        patch.second_attempt_satisfactory = null;
        patch.second_attempt_date = null;
        patch.second_attempt_feedback = null;
      }
      // If second is not complete, do not allow third to be set yet.
      if ((!secondComplete || !thirdUnlockedByResubmission) && hasThirdAny) {
        patch.third_attempt_satisfactory = null;
        patch.third_attempt_date = null;
        patch.third_attempt_feedback = null;
      }

      if (Object.keys(patch).length) updates.push({ sectionId, patch });
    }
    if (updates.length === 0) return;

    setResultsData((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        next[u.sectionId] = { ...(next[u.sectionId] ?? ({ section_id: u.sectionId } as import('../lib/formEngine').ResultsDataEntry)), ...u.patch };
        saveResultsData(id, u.sectionId, u.patch);
      }
      setPdfRefresh((r) => r + 1);
      return next;
    });
  }, [template, id, resultsData, submissionCount]);

  // NOTE: We intentionally do not auto-bump the stored student declaration date on resubmissions.
  // The declaration is treated as historical evidence of when the student originally signed,
  // and minDate rules are enforced only when the student edits/re-signs.

  useEffect(() => {
    if (!template || !id || !assessmentSummary) return;
    const taskResultSectionIds = (template.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
    const firstTaskSectionId = taskResultSectionIds[0];
    const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
    const raTrainerQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
    const raVal = raTrainerQ ? answers[getAnswerKey(raTrainerQ.id, null)] : undefined;
    const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
    const raTrainerDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
    const trainerRefDate = raTrainerDate || firstTaskRd?.trainer_date || '';
    const studentDeclQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.declarationSignature');
    const studentDeclVal = studentDeclQ ? answers[getAnswerKey(studentDeclQ.id, null)] : undefined;
    const studentDeclSigObj = studentDeclVal && typeof studentDeclVal === 'object' && !Array.isArray(studentDeclVal) ? (studentDeclVal as Record<string, unknown>) : null;
    const studentDeclDate = studentDeclSigObj ? String(studentDeclSigObj.date ?? studentDeclSigObj.signedAtDate ?? '') : '';
    const sum = assessmentSummary;
    const updates: { field: keyof import('../lib/formEngine').AssessmentSummaryDataEntry; value: string }[] = [];
    if (!sum.trainer_date_1 && trainerRefDate) updates.push({ field: 'trainer_date_1', value: trainerRefDate });
    if (!sum.student_date_1 && studentDeclDate) updates.push({ field: 'student_date_1', value: studentDeclDate });
    if (updates.length === 0) return;
    setAssessmentSummary((prev) => {
      const next = prev ? { ...prev } : ({} as import('../lib/formEngine').AssessmentSummaryDataEntry);
      for (const u of updates) {
        (next as unknown as Record<string, unknown>)[u.field] = u.value;
        saveAssessmentSummaryData(id, { [u.field]: u.value });
      }
      setPdfRefresh((r) => r + 1);
      return next;
    });
  }, [template, answers, resultsData, assessmentSummary, id]);

  /** Enforce assessment summary date chain after auto-fill (clamp stored dates to S1→T1→S2→T2→S3→T3). */
  useEffect(() => {
    if (!template || !id || !assessmentSummary) return;
    const mins = getAssessmentSummaryDateChainMins(assessmentSummary);
    const patch: Partial<import('../lib/formEngine').AssessmentSummaryDataEntry> = {};
    const s = assessmentSummary;
    const bump = (k: keyof import('../lib/formEngine').AssessmentSummaryDataEntry, min: string | undefined) => {
      if (!min) return;
      const cur = (s as unknown as Record<string, unknown>)[k as string];
      const c = cur == null ? '' : String(cur).trim();
      if (c && isCalendarBefore(c, min)) (patch as unknown as Record<string, unknown>)[k as string] = min;
    };
    // Attempt 1 is historical after resubmission — do not bump from changing declaration / attempt 2 mins.
    if (submissionCount < 2) {
      bump('student_date_1', mins.minStudentDate1);
      bump('trainer_date_1', mins.minTrainerDate1);
    }
    bump('student_date_2', mins.minStudentDate2);
    bump('trainer_date_2', mins.minTrainerDate2);
    bump('student_date_3', mins.minStudentDate3);
    bump('trainer_date_3', mins.minTrainerDate3);
    if (Object.keys(patch).length === 0) return;
    setAssessmentSummary((prev) =>
      prev ? { ...prev, ...patch } : ({ ...patch } as import('../lib/formEngine').AssessmentSummaryDataEntry),
    );
    saveAssessmentSummaryData(id, patch);
    setPdfRefresh((r) => r + 1);
  }, [template, id, assessmentSummary, submissionCount]);

  useEffect(() => {
    if (!template || !id) return;
    if (!(role === 'trainer' || role === 'office')) return;
    if (!assessmentSummary) return;

    const taskResultSections = (template.steps ?? [])
      .flatMap((st) => st.sections)
      .filter((s) => s.pdf_render_mode === 'task_results');
    if (taskResultSections.length === 0) return;

    const firstTaskSectionId = taskResultSections[0].id;
    const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;

    const sumFirstComplete =
      rowAnswerHasContent(firstTaskRd?.first_attempt_satisfactory ?? undefined) &&
      rowAnswerHasContent(firstTaskRd?.first_attempt_date ?? undefined);
    const sumSecondOrThirdHasData = !!(
      firstTaskRd?.second_attempt_date ||
      firstTaskRd?.second_attempt_satisfactory ||
      firstTaskRd?.third_attempt_date ||
      firstTaskRd?.third_attempt_satisfactory
    );
    const sumThirdHasData = !!(firstTaskRd?.third_attempt_date || firstTaskRd?.third_attempt_satisfactory);
    const sumSecondComplete =
      rowAnswerHasContent(firstTaskRd?.second_attempt_satisfactory ?? undefined) &&
      rowAnswerHasContent(firstTaskRd?.second_attempt_date ?? undefined);

    // Which summary column is active follows submission cycle; attempt 1 locks once resubmission starts (count ≥ 2).
    const sumFirstEditable = !sumSecondOrThirdHasData && submissionCount < 2;
    const sumSecondEditable = sumFirstComplete && !sumThirdHasData && submissionCount >= 2;
    const sumThirdEditable = sumSecondComplete && submissionCount >= 3;

    const attemptOutcome = (attempt: 1 | 2 | 3): 'competent' | 'not_yet_competent' | null => {
      let anyAnswered = false;
      let anyNs = false;
      for (const sec of taskResultSections) {
        const rd = resultsData[sec.id];
        const sat =
          attempt === 1 ? rd?.first_attempt_satisfactory
          : attempt === 2 ? rd?.second_attempt_satisfactory
          : rd?.third_attempt_satisfactory;
        if (sat === 's' || sat === 'ns') anyAnswered = true;
        if (sat === 'ns') anyNs = true;
      }
      if (!anyAnswered) return null;
      return anyNs ? 'not_yet_competent' : 'competent';
    };

    const sum = assessmentSummary;
    const patch: Partial<import('../lib/formEngine').AssessmentSummaryDataEntry> = {};
    const setIfEmpty = (field: keyof import('../lib/formEngine').AssessmentSummaryDataEntry, value: string | null) => {
      const cur = (sum as unknown as Record<string, unknown>)[field];
      const curStr = cur == null ? '' : String(cur).trim();
      if (!curStr && value) (patch as unknown as Record<string, unknown>)[field] = value;
    };

    if (sumFirstEditable) {
      const o1 = attemptOutcome(1);
      if (o1) setIfEmpty('final_attempt_1_result', o1);
      // Auto-fill attempt 1 signatures/dates from known sources (do not overwrite).
      const todayIso = new Date().toISOString().split('T')[0];
      const raTrainerQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
      const raVal = raTrainerQ ? answers[getAnswerKey(raTrainerQ.id, null)] : undefined;
      const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
      const raTrainerSig = raSigObj ? (String(raSigObj.signature ?? raSigObj.imageDataUrl ?? '') || null) : (typeof raVal === 'string' ? raVal : null);
      const raTrainerDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';

      const studentDeclQ = template.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.declarationSignature');
      const studentDeclVal = studentDeclQ ? answers[getAnswerKey(studentDeclQ.id, null)] : undefined;
      const studentDeclSigObj = studentDeclVal && typeof studentDeclVal === 'object' && !Array.isArray(studentDeclVal) ? (studentDeclVal as Record<string, unknown>) : null;
      const studentDeclSig = studentDeclSigObj ? (String(studentDeclSigObj.signature ?? studentDeclSigObj.imageDataUrl ?? '') || null) : (typeof studentDeclVal === 'string' ? studentDeclVal : null);
      const studentDeclDate = studentDeclSigObj ? String(studentDeclSigObj.date ?? studentDeclSigObj.signedAtDate ?? '') : '';

      const trainerRefSig = raTrainerSig ?? firstTaskRd?.trainer_signature ?? null;
      const trainerRefDate = raTrainerSig ? (raTrainerDate || firstTaskRd?.trainer_date || todayIso) : (firstTaskRd?.trainer_date || todayIso);
      const studentRefSig = studentDeclSig ?? firstTaskRd?.student_signature ?? null;
      const studentRefDate = studentDeclDate || todayIso;

      setIfEmpty('trainer_sig_1', trainerRefSig);
      setIfEmpty('trainer_date_1', trainerRefDate || null);
      setIfEmpty('student_sig_1', studentRefSig);
      setIfEmpty('student_date_1', studentRefDate || null);
    }
    if (sumSecondEditable) {
      const o2 = attemptOutcome(2);
      if (o2) setIfEmpty('final_attempt_2_result', o2);
    }
    if (sumThirdEditable) {
      const o3 = attemptOutcome(3);
      if (o3) setIfEmpty('final_attempt_3_result', o3);
    }

    if (Object.keys(patch).length === 0) return;
    setAssessmentSummary((prev) => (prev ? { ...prev, ...patch } : ({ ...patch } as import('../lib/formEngine').AssessmentSummaryDataEntry)));
    saveAssessmentSummaryData(id, patch);
    setPdfRefresh((r) => r + 1);
  }, [template, id, role, resultsData, assessmentSummary, answers, submissionCount]);

  const valueToSavePayload = (value: string | number | boolean | Record<string, unknown> | string[]) => {
    let text: string | undefined;
    let num: number | undefined;
    let json: unknown;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number') num = value;
    else if (typeof value === 'boolean') text = value ? 'true' : 'false';
    else if (Array.isArray(value)) json = value;
    else if (value && typeof value === 'object') json = value;
    return { text, number: num, json };
  };

  const debouncedSave = useCallback(
    (questionId: number, rowId: number | null, value: string | number | boolean | Record<string, unknown> | string[]) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        const payload = valueToSavePayload(value);
        await saveAnswer(id, questionId, rowId, payload);
        setPdfRefresh((r) => r + 1);
      }, 300);
    },
    [id]
  );

  const handleAnswerChange = useCallback(
    (questionId: number, rowId: number | null, value: string | number | boolean | Record<string, unknown> | string[], immediate = false) => {
      const key = getAnswerKey(questionId, rowId);
      setAnswers((prev) => ({ ...prev, [key]: value }));
      if (immediate) {
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = undefined;
        const payload = valueToSavePayload(value);
        saveAnswer(id, questionId, rowId, payload).then(() => setPdfRefresh((r) => r + 1));
      } else {
        debouncedSave(questionId, rowId, value);
      }
    },
    [debouncedSave, id]
  );

  const handleTrainerAssessmentChange = useCallback(
    (questionId: number, satisfactory: 'yes' | 'no') => {
      setTrainerAssessments((prev) => ({ ...prev, [questionId]: satisfactory }));
      saveTrainerAssessment(id, questionId, satisfactory);
      setPdfRefresh((r) => r + 1);
    },
    [id]
  );

  const handleResultsOfficeChange = useCallback(
    (sectionId: number, field: 'entered_date' | 'entered_by', value: string | null) => {
      setResultsOffice((prev) => {
        const next = { ...prev };
        if (!next[sectionId]) next[sectionId] = { entered_date: null, entered_by: null };
        next[sectionId] = { ...next[sectionId], [field]: value };
        saveResultsOffice(id, sectionId, next[sectionId].entered_date, next[sectionId].entered_by);
        setPdfRefresh((r) => r + 1);
        return next;
      });
    },
    [id]
  );

  const handleAssessmentSummaryChange = useCallback(
    (field: keyof import('../lib/formEngine').AssessmentSummaryDataEntry, value: string | null) => {
      setAssessmentSummary((prev) => {
        const next: import('../lib/formEngine').AssessmentSummaryDataEntry = prev ? { ...prev, [field]: value } : ({ [field]: value } as unknown as import('../lib/formEngine').AssessmentSummaryDataEntry);
        saveAssessmentSummaryData(id, { [field]: value });
        setPdfRefresh((r) => r + 1);
        return next;
      });
    },
    [id]
  );

  const canRoleEditCurrentWorkflow = useMemo(() => {
    if (workflowStatus === 'completed') return false;
    if (role === 'student') return workflowStatus === 'draft';
    if (role === 'trainer') return workflowStatus === 'waiting_trainer';
    if (role === 'office') return workflowStatus === 'waiting_office';
    return false;
  }, [role, workflowStatus]);

  /** True when student is resubmitting after trainer sent back; parts marked Satisfactory Yes become read-only */
  const isResubmissionAfterTrainer = useMemo(
    () =>
      role === 'student' &&
      workflowStatus === 'draft' &&
      (Object.keys(trainerAssessments).length > 0 || Object.keys(trainerRowAssessments).length > 0),
    [role, workflowStatus, trainerAssessments, trainerRowAssessments]
  );

  const isQuestionReadOnlyByTrainer = useCallback(
    (questionId: number) => isResubmissionAfterTrainer && trainerAssessments[questionId] === 'yes',
    [isResubmissionAfterTrainer, trainerAssessments]
  );

  const workflowLabel = useMemo(() => {
    if (workflowStatus === 'draft') return 'Draft';
    if (workflowStatus === 'waiting_trainer') return 'Waiting for trainer check';
    if (workflowStatus === 'waiting_office') return 'Waiting for office check';
    return 'Completed';
  }, [workflowStatus]);

  const sanitizeInstructionHtml = useCallback((html: string) => {
    // Remove common “word split” hints produced by some HTML generators.
    // This prevents things like "demon strating" and dangling "word-" at line end.
    return String(html || '')
      .replace(/\u00ad/g, '') // soft hyphen char
      .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '') // zero-width spaces/joiners that allow mid-word wraps
      .replace(/&shy;/gi, '') // soft hyphen entity
      .replace(/&ZeroWidthSpace;|&#8203;|&#x200B;/gi, '') // zero-width space entities
      .replace(/<wbr\s*\/?>/gi, '') // word break tag
      .replace(/-\s*<br\s*\/?>/gi, '') // hyphen + line break
      .replace(/-\s*\r?\n\s*/g, '') // hyphen + newline
      // Sometimes the HTML includes explicit breaks inside a word (e.g. "prov<br>ide", "applicat\nion").
      // Only remove breaks when they are between letters to avoid altering real paragraph/line breaks.
      .replace(/([A-Za-z])\s*<br\s*\/?>\s*([A-Za-z])/gi, '$1$2')
      .replace(/([A-Za-z])\s*\r?\n\s*([A-Za-z])/g, '$1$2');
  }, []);

  const runFinalSubmitByRole = useCallback(async () => {
    if (!id) return;
    setWorkflowSubmitting(true);
    if (role === 'student' && workflowStatus === 'draft') {
      await updateInstanceWorkflowStatus(id, 'waiting_trainer');
      await updateInstanceRole(id, 'trainer');
      await revokeRoleAccessTokens(id, 'student');
      setWorkflowStatus('waiting_trainer');
      toast.success('Submitted successfully. Waiting for trainer checking.');
      setWorkflowSubmitting(false);
      return;
    }
    if (role === 'trainer' && workflowStatus === 'waiting_trainer') {
      await updateInstanceWorkflowStatus(id, 'waiting_office');
      setWorkflowStatus('waiting_office');
      await updateInstanceRole(id, 'office');
      toast.success('Submitted successfully. Waiting for office checking.');
      setWorkflowSubmitting(false);
      return;
    }
    if (role === 'office' && workflowStatus === 'waiting_office') {
      await updateInstanceWorkflowStatus(id, 'completed');
      setWorkflowStatus('completed');
      toast.success('Office check complete. Form is now completed.');
    }
    setWorkflowSubmitting(false);
  }, [id, role, workflowStatus]);

  const handleFinalSubmitByRole = useCallback(() => {
    if (role === 'student' && workflowStatus === 'draft') {
      setConfirmConfig({
        title: 'Final Submit',
        message: 'After submitting, you will not be able to edit this form again. Please verify all answers before continuing.',
        confirmLabel: 'Submit',
      });
      return;
    }
    if (role === 'trainer' && workflowStatus === 'waiting_trainer') {
      setConfirmConfig({
        title: 'Final Submit',
        message: 'After submitting, you will not be able to edit this form again. Please verify all answers before continuing.',
        confirmLabel: 'Submit',
      });
      return;
    }
    if (role === 'office' && workflowStatus === 'waiting_office') {
      setConfirmConfig({
        title: 'Office Check',
        message: 'Finalize office checking? This will complete and lock the form.',
        confirmLabel: 'Finalize',
      });
    }
  }, [role, workflowStatus]);

  const validateStep = useCallback(
    (stepNumber: number): boolean => {
      if (!template || stepNumber <= 1) return true;
      const stepData = template.steps[stepNumber - 2];
      if (!stepData) return true;
      const stepErrors: Record<string, string> = {};
      const taskResultIdsAppendixVal = (template.steps ?? [])
        .flatMap((st) => st.sections)
        .filter((s) => s.pdf_render_mode === 'task_results')
        .map((s) => s.id);
      const firstTaskSecAppendixVal = taskResultIdsAppendixVal[0];
      const firstTaskRdAppendixVal = firstTaskSecAppendixVal ? resultsData[firstTaskSecAppendixVal] : null;
      const secondOrThirdHasDataAppendixVal = !!(
        firstTaskRdAppendixVal?.second_attempt_date ||
        firstTaskRdAppendixVal?.second_attempt_satisfactory ||
        firstTaskRdAppendixVal?.third_attempt_date ||
        firstTaskRdAppendixVal?.third_attempt_satisfactory
      );
      const isAppendixAStepTitle = /Appendix\s*A/i.test((stepData.title || '').trim());

      for (const section of stepData.sections) {
        // `task_results` and `assessment_summary` are rendered from `resultsData` / `assessmentSummary`
        // state (not from `answers` + `section.questions`). So validate them explicitly here.
        if (section.pdf_render_mode === 'task_results') {
          const rd = resultsData[section.id];
          const trainerCanEdit = role === 'trainer' || role === 'office';
          const studentCanEdit = role === 'student' || role === 'office';

          if (studentCanEdit) {
            if (!rowAnswerHasContent(rd?.student_name ?? undefined)) {
              stepErrors[`task-results-${section.id}-student_name`] = 'Student name is required';
            }
            if (!rowAnswerHasContent(rd?.student_signature ?? undefined)) {
              stepErrors[`task-results-${section.id}-student_signature`] = 'Student signature is required';
            }
          }

          if (trainerCanEdit) {
            // Attempt dates must be filled for the attempt being completed (same rules as task_results UI).
            const firstAttemptComplete =
              rowAnswerHasContent(rd?.first_attempt_satisfactory ?? undefined) &&
              rowAnswerHasContent(rd?.first_attempt_date ?? undefined);
            const secondOrThirdHasData = !!(
              rd?.second_attempt_date ||
              rd?.second_attempt_satisfactory ||
              rd?.third_attempt_date ||
              rd?.third_attempt_satisfactory
            );
            const thirdAttemptHasData = !!(rd?.third_attempt_date || rd?.third_attempt_satisfactory);
            const secondAttemptComplete =
              rowAnswerHasContent(rd?.second_attempt_satisfactory ?? undefined) &&
              rowAnswerHasContent(rd?.second_attempt_date ?? undefined);

            const firstAttemptEditable = trainerCanEdit && submissionCount < 2 && !secondOrThirdHasData;
            const secondAttemptUnlockedByResubmission = submissionCount >= 2;
            const thirdAttemptUnlockedByResubmission = submissionCount >= 3;
            const secondAttemptEditable =
              trainerCanEdit &&
              firstAttemptComplete &&
              secondAttemptUnlockedByResubmission &&
              !thirdAttemptHasData;
            const thirdAttemptEditable =
              trainerCanEdit && secondAttemptComplete && thirdAttemptUnlockedByResubmission;

            if (firstAttemptEditable) {
              if (!rowAnswerHasContent(rd?.first_attempt_satisfactory ?? undefined)) {
                stepErrors[`task-results-${section.id}-first_attempt_satisfactory`] = 'First attempt outcome (S/NS) is required';
              }
              if (!rowAnswerHasContent(rd?.first_attempt_date ?? undefined)) {
                stepErrors[`task-results-${section.id}-first_attempt_date`] = 'First attempt date is required';
              }
            }
            if (secondAttemptEditable) {
              if (!rowAnswerHasContent(rd?.second_attempt_satisfactory ?? undefined)) {
                stepErrors[`task-results-${section.id}-second_attempt_satisfactory`] = 'Second attempt outcome (S/NS) is required';
              }
              if (!rowAnswerHasContent(rd?.second_attempt_date ?? undefined)) {
                stepErrors[`task-results-${section.id}-second_attempt_date`] = 'Second attempt date is required';
              }
            }
            if (thirdAttemptEditable) {
              if (!rowAnswerHasContent(rd?.third_attempt_satisfactory ?? undefined)) {
                stepErrors[`task-results-${section.id}-third_attempt_satisfactory`] = 'Third attempt outcome (S/NS) is required';
              }
              if (!rowAnswerHasContent(rd?.third_attempt_date ?? undefined)) {
                stepErrors[`task-results-${section.id}-third_attempt_date`] = 'Third attempt date is required';
              }
            }

            if (!rowAnswerHasContent(rd?.trainer_name ?? undefined)) {
              stepErrors[`task-results-${section.id}-trainer_name`] = 'Trainer name is required';
            }
            if (!rowAnswerHasContent(rd?.trainer_signature ?? undefined)) {
              stepErrors[`task-results-${section.id}-trainer_signature`] = 'Trainer signature is required';
            }
            if (!rowAnswerHasContent(rd?.trainer_date ?? undefined)) {
              stepErrors[`task-results-${section.id}-trainer_date`] = 'Trainer date is required';
            }
          }

          // Skip question-based validation for this section type.
          continue;
        }

        if (section.pdf_render_mode === 'assessment_summary') {
          const sum = assessmentSummary || ({} as import('../lib/formEngine').AssessmentSummaryDataEntry);

          const trainerCanEdit = role === 'trainer' || role === 'office';
          const studentCanEdit = role === 'student' || role === 'office';

          if (rowAnswerHasContent(sum.start_date ?? undefined) && rowAnswerHasContent(sum.end_date ?? undefined)) {
            const start = String(sum.start_date ?? '');
            const end = String(sum.end_date ?? '');
            if (isCalendarBefore(end, start)) {
              stepErrors['assessment-summary-end_date'] = 'End Date cannot be earlier than Start Date';
            }
          }

          const dateChainErr = validateAssessmentSummaryDateChain(sum);
          if (dateChainErr) {
            stepErrors['assessment-summary-date-chain'] = dateChainErr;
          }

          const taskResultSectionIds = (template?.steps || [])
            .flatMap((st) => st.sections)
            .filter((s) => s.pdf_render_mode === 'task_results')
            .map((s) => s.id);
          const firstTaskSectionId = taskResultSectionIds[0];
          const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;

          const sumFirstComplete =
            rowAnswerHasContent(firstTaskRd?.first_attempt_satisfactory ?? undefined) &&
            rowAnswerHasContent(firstTaskRd?.first_attempt_date ?? undefined);
          const sumSecondOrThirdHasData = !!(
            firstTaskRd?.second_attempt_date ||
            firstTaskRd?.second_attempt_satisfactory ||
            firstTaskRd?.third_attempt_date ||
            firstTaskRd?.third_attempt_satisfactory
          );
          const sumThirdHasData = !!(firstTaskRd?.third_attempt_date || firstTaskRd?.third_attempt_satisfactory);
          const sumSecondComplete =
            rowAnswerHasContent(firstTaskRd?.second_attempt_satisfactory ?? undefined) &&
            rowAnswerHasContent(firstTaskRd?.second_attempt_date ?? undefined);

          const sumFirstEditable = !sumSecondOrThirdHasData && submissionCount < 2;
          const sumSecondEditable = sumFirstComplete && !sumThirdHasData && submissionCount >= 2;
          const sumThirdEditable = sumSecondComplete && submissionCount >= 3;

          if (trainerCanEdit) {
            if (sumFirstEditable) {
              if (!rowAnswerHasContent(sum.final_attempt_1_result ?? undefined)) {
                stepErrors['assessment-summary-final_attempt_1_result'] = 'Attempt 1 result (Competent / Not Yet Competent) is required';
              }
              if (!rowAnswerHasContent(sum.trainer_sig_1 ?? undefined)) {
                stepErrors['assessment-summary-trainer_sig_1'] = 'Trainer signature (attempt 1) is required';
              }
              if (!rowAnswerHasContent(sum.trainer_date_1 ?? undefined)) {
                stepErrors['assessment-summary-trainer_date_1'] = 'Trainer date (attempt 1) is required';
              }
            }
            if (sumSecondEditable) {
              if (!rowAnswerHasContent(sum.final_attempt_2_result ?? undefined)) {
                stepErrors['assessment-summary-final_attempt_2_result'] = 'Attempt 2 result (Competent / Not Yet Competent) is required';
              }
              if (!rowAnswerHasContent(sum.trainer_sig_2 ?? undefined)) {
                stepErrors['assessment-summary-trainer_sig_2'] = 'Trainer signature (attempt 2) is required';
              }
              if (!rowAnswerHasContent(sum.trainer_date_2 ?? undefined)) {
                stepErrors['assessment-summary-trainer_date_2'] = 'Trainer date (attempt 2) is required';
              }
            }
            if (sumThirdEditable) {
              if (!rowAnswerHasContent(sum.final_attempt_3_result ?? undefined)) {
                stepErrors['assessment-summary-final_attempt_3_result'] = 'Attempt 3 result (Competent / Not Yet Competent) is required';
              }
              if (!rowAnswerHasContent(sum.trainer_sig_3 ?? undefined)) {
                stepErrors['assessment-summary-trainer_sig_3'] = 'Trainer signature (attempt 3) is required';
              }
              if (!rowAnswerHasContent(sum.trainer_date_3 ?? undefined)) {
                stepErrors['assessment-summary-trainer_date_3'] = 'Trainer date (attempt 3) is required';
              }
            }
          }

          if (studentCanEdit) {
            if (sumFirstEditable) {
              if (!rowAnswerHasContent(sum.student_sig_1 ?? undefined)) {
                stepErrors['assessment-summary-student_sig_1'] = 'Student signature (attempt 1) is required';
              }
              if (!rowAnswerHasContent(sum.student_date_1 ?? undefined)) {
                stepErrors['assessment-summary-student_date_1'] = 'Student date (attempt 1) is required';
              }
            }
            if (sumSecondEditable) {
              if (!rowAnswerHasContent(sum.student_sig_2 ?? undefined)) {
                stepErrors['assessment-summary-student_sig_2'] = 'Student signature (attempt 2) is required';
              }
              if (!rowAnswerHasContent(sum.student_date_2 ?? undefined)) {
                stepErrors['assessment-summary-student_date_2'] = 'Student date (attempt 2) is required';
              }
            }
            if (sumThirdEditable) {
              if (!rowAnswerHasContent(sum.student_sig_3 ?? undefined)) {
                stepErrors['assessment-summary-student_sig_3'] = 'Student signature (attempt 3) is required';
              }
              if (!rowAnswerHasContent(sum.student_date_3 ?? undefined)) {
                stepErrors['assessment-summary-student_date_3'] = 'Student date (attempt 3) is required';
              }
            }
          }

          // Skip question-based validation for this section type.
          continue;
        }

        const appendixFirstCycleEditableForStep =
          !isAppendixAStepTitle || section.pdf_render_mode !== 'reasonable_adjustment'
            ? true
            : submissionCount < 2 && !secondOrThirdHasDataAppendixVal;

        for (const q of section.questions) {
          if (q.type === 'instruction_block' || q.type === 'page_break') continue;
          if ((q.pdf_meta as Record<string, unknown>)?.isAdditionalBlockOf) continue;
          if (!isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role)) continue;
          const baseEditable = isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role) && canRoleEditCurrentWorkflow;
          const editable = baseEditable && !isQuestionReadOnlyByTrainer(q.id);
          const effectiveEditable = editable && appendixFirstCycleEditableForStep;
          if (!q.required || !effectiveEditable) continue;

          if (q.type === 'grid_table' && q.rows?.length) {
            if (!isGridTableFilled(q, answers)) {
              stepErrors[`q-${q.id}`] = `${q.label} is required`;
            }
            continue;
          }
          if (q.type === 'likert_5' && q.rows?.length) {
            if (!isLikertFilled(q, answers)) {
              stepErrors[`q-${q.id}`] = `${q.label} is required`;
            }
            continue;
          }
          // Checklists are stored per-row (row_id) but are rendered as `single_choice` with rows.
          // Validate that every visible row has a selected option when required.
          if (q.type === 'single_choice' && q.rows?.length) {
            let allRowsAnswered = true;
            for (const r of q.rows) {
              const rowKey = getAnswerKey(q.id, r.id);
              if (!rowAnswerHasContent(answers[rowKey] as AnswersMap[string] | undefined)) {
                allRowsAnswered = false;
                break;
              }
            }
            if (!allRowsAnswered) {
              stepErrors[`q-${q.id}`] = `${q.label} is required`;
            }
            continue;
          }

          const byBlocks = isRequiredSatisfiedByContentBlocks(q, section, answers);
          if (byBlocks !== null) {
            if (!byBlocks) {
              stepErrors[`q-${q.id}`] = `${q.label} is required`;
            }
            continue;
          }

          const key = getAnswerKey(q.id, null);
          const val = answers[key];
          // For signatures, `val` is usually an object; `String(val)` becomes "[object Object]"
          // which incorrectly passes the "required" check. Use content-based validation instead.
          if (!rowAnswerHasContent(val as AnswersMap[string] | undefined)) {
            stepErrors[`q-${q.id}`] = `${q.label} is required`;
          } else if (q.code === 'evaluation.evaluationDate' && rowAnswerHasContent(val as AnswersMap[string] | undefined)) {
            const trIds = (template?.steps ?? [])
              .flatMap((st) => st.sections)
              .filter((s) => s.pdf_render_mode === 'task_results')
              .map((s) => s.id);
            const firstRd = trIds[0] ? resultsData[trIds[0]] : null;
            const firstAttempt = firstRd?.first_attempt_date;
            if (firstAttempt && String(firstAttempt).trim() && isCalendarBefore(String(val), String(firstAttempt))) {
              stepErrors[`q-${q.id}`] = 'Date of Evaluation cannot be before the first attempt date.';
            }
          }
        }
      }
      setErrors(stepErrors);
      if (Object.keys(stepErrors).length > 0) {
        // For result/summary fields we don't always render field-specific errors,
        // so show a clear message to explain why "Next" is blocked.
        toast.error(Object.values(stepErrors)[0]);
      }
      return Object.keys(stepErrors).length === 0;
    },
    [template, role, answers, resultsData, assessmentSummary, submissionCount, canRoleEditCurrentWorkflow, isQuestionReadOnlyByTrainer]
  );

  if (loading) {
    return <Loader fullPage variant="dots" size="lg" message="Loading..." />;
  }
  if (accessDenied) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
        <Card className="max-w-xl w-full">
          <h2 className="text-xl font-bold text-[var(--text)] mb-2">Access denied</h2>
          <p className="text-sm text-gray-600">{accessDenied}</p>
        </Card>
      </div>
    );
  }
  if (!template) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center px-4">
        <Card className="max-w-xl w-full">
          <h2 className="text-xl font-bold text-[var(--text)] mb-2">Instance unavailable</h2>
          <p className="text-sm text-gray-600">This assessment instance could not be loaded.</p>
        </Card>
      </div>
    );
  }

  const showSubmittedPage =
    (role === 'student' && workflowStatus !== 'draft') ||
    (role === 'trainer' && (workflowStatus === 'waiting_office' || workflowStatus === 'completed'));

  const canViewPdfPreview = role === 'office';

  const submittedTitle = 'Thank you';
  const submittedMessage =
    role === 'student'
      ? 'Your assessment has been submitted. Editing is now locked and downloading is disabled.'
      : 'Your trainer checking has been submitted. Editing is now locked and downloading is disabled.';

  if (showSubmittedPage) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <header className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20">
          <div className="w-full px-4 md:px-6 py-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h1 className="text-xl font-bold text-[var(--text)]">{template.form.name}</h1>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{workflowLabel}</span>
                <span className="text-sm font-semibold text-gray-700 capitalize">{role}</span>
              </div>
            </div>
          </div>
        </header>
        <div className="w-full px-4 md:px-6 py-8">
          <div className="max-w-3xl mx-auto">
            <Card>
              <h2 className="text-xl font-bold text-[var(--text)] mb-2">{submittedTitle}</h2>
              <p className="text-sm text-gray-600">{submittedMessage}</p>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // Introduction step is always first, then form steps. Appendix A hidden from students.
  const isAppendixAStep = (s: { title?: string | null }) => /Appendix\s*A/i.test((s.title || '').trim());
  const visibleSteps = (template.steps ?? []).filter(
    (s) => role !== 'student' || !isAppendixAStep(s)
  );
  const steps = [
    { number: 1, label: 'Introduction', description: 'Student Pack overview' },
    ...visibleSteps.map((s, i) => ({
      number: i + 2,
      label: s.title,
      description: s.subtitle || '',
    })),
  ];

  const isIntroductionStep = currentStep === 1;
  const currentStepData = isIntroductionStep ? null : visibleSteps[currentStep - 2];
  const visibleQuestions: { q: typeof template.steps[0]['sections'][0]['questions'][0]; section: typeof template.steps[0]['sections'][0] }[] = [];

  if (currentStepData) {
    for (const section of currentStepData.sections) {
      for (const q of section.questions) {
        const rv = (q.role_visibility as Record<string, boolean>) || {};
        if (isRoleVisible(rv, role)) {
          visibleQuestions.push({ q, section });
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <header className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20">
        <div className="w-full px-4 md:px-6 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h1 className="text-xl font-bold text-[var(--text)]">{template.form.name}</h1>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{workflowLabel}</span>
              <span className="text-sm font-semibold text-gray-700 capitalize">{role}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="w-full px-4 md:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            ref={formScrollRef}
            className={(canViewPdfPreview ? 'lg:col-span-9' : 'lg:col-span-12') + ' space-y-6 overflow-y-auto max-h-[calc(100vh-8rem)] pr-2'}
            onSubmit={(e) => e.preventDefault()}
          >
            <Card>
              <Stepper steps={steps} currentStep={currentStep} />
            </Card>

            {isIntroductionStep ? (
              <Card>
                <h2 className="text-xl font-bold text-[var(--text)] mb-4">Student Pack</h2>
                <h3 className="text-lg font-semibold text-gray-700 mb-3">What is the purpose of this document?</h3>
                <p className="text-gray-700 mb-4">
                  The Student Pack is the document you, the student, needs to complete to demonstrate competency. This document includes the context and conditions of your assessment, the tasks to be completed by you and an outline of the evidence to be gathered.
                </p>
                <h4 className="font-semibold text-gray-700 mb-2">The information includes the following:</h4>
                <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1">
                  <li>Information related to the unit of competency.</li>
                  <li>Guidelines and instructions to complete each task and activity.</li>
                  <li>A student evaluation form</li>
                </ul>
                <h4 className="font-semibold text-gray-700 mb-2">Student Evaluation Form</h4>
                <p className="text-gray-700 mb-4">
                  These documents are designed after conducting thorough industry consultation. Students are encouraged to evaluate this document and provide constructive feedback to their training organisation if they feel that this document can be improved.
                </p>
                <h4 className="font-semibold text-gray-700 mb-2">Link to other unit documents</h4>
                <ul className="list-disc list-inside text-gray-700 space-y-2">
                  <li>The Student Pack is a document for students to complete to demonstrate their competency. This document includes context and conditions of assessment, tasks to be administered to the student, and an outline of the evidence to be gathered from the student.</li>
                  <li>The Unit Mapping is a document that contains information and comprehensive mapping with the training package requirements.</li>
                </ul>
              </Card>
            ) : currentStepData ? (
              (() => {
                const filteredSections = currentStepData.sections.filter((section) => {
                  if (section.pdf_render_mode === 'reasonable_adjustment' && role === 'student') return false;
                  /* Hide Written Evidence Checklist section when it has no rows - avoids blank header */
                  if (section.questions.some((q) => q.code === 'written.evidence.checklist')) {
                    const checklistQ = section.questions.find((q) => q.code === 'written.evidence.checklist' && q.type === 'single_choice');
                    if (checklistQ && checklistQ.rows.length === 0) return false;
                  }
                  /* Hide Assessment Marking Checklist section when it has no rows in either Evidence or Performance outcome */
                  if (section.pdf_render_mode === 'task_marking_checklist') {
                    const evidenceQ = section.questions.find((q) => q.code === 'assessment.marking.evidence_outcome' && q.type === 'single_choice');
                    const perfQ = section.questions.find((q) => q.code === 'assessment.marking.performance_outcome' && q.type === 'single_choice');
                    const evidenceRows = evidenceQ?.rows?.length ?? 0;
                    const perfRows = perfQ?.rows?.length ?? 0;
                    if (evidenceRows === 0 && perfRows === 0) return false;
                  }
                  const hasInteractive = section.questions.some(
                    (q) => q.type !== 'instruction_block' && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role)
                  );
                  return hasInteractive || section.pdf_render_mode === 'assessment_tasks' || section.pdf_render_mode === 'assessment_submission' || section.pdf_render_mode === 'reasonable_adjustment' || section.pdf_render_mode === 'reasonable_adjustment_indicator' || section.pdf_render_mode === 'task_instructions' || section.pdf_render_mode === 'task_questions' || section.pdf_render_mode === 'task_written_evidence_checklist' || section.pdf_render_mode === 'task_marking_checklist' || section.pdf_render_mode === 'task_results' || section.pdf_render_mode === 'assessment_summary';
                });
                if (filteredSections.length === 0) return null;
                return (
              <Card>
                <h2 className="text-xl font-bold text-[var(--text)] mb-4">
                  Step {currentStep}: {currentStepData.title}
                </h2>
                {filteredSections.map((section) => (
                  <div key={section.id} className="mb-8 last:mb-0">
                    {section.pdf_render_mode !== 'likert_table' && section.pdf_render_mode !== 'reasonable_adjustment' && section.pdf_render_mode !== 'reasonable_adjustment_indicator' && section.pdf_render_mode !== 'task_instructions' && section.pdf_render_mode !== 'task_questions' && section.pdf_render_mode !== 'task_written_evidence_checklist' && section.pdf_render_mode !== 'task_marking_checklist' && section.pdf_render_mode !== 'task_results' && section.pdf_render_mode !== 'assessment_summary' && (
                      <h3 className="text-lg font-semibold text-gray-700 mb-2">{section.title}</h3>
                    )}
                    <div className={section.pdf_render_mode === 'declarations' || section.pdf_render_mode === 'assessment_submission' ? 'border border-gray-200 rounded-lg p-4 bg-white space-y-4' : 'space-y-4'}>
                      {section.pdf_render_mode === 'reasonable_adjustment_indicator' ? (
                        <div className="text-sm text-gray-700">
                          <h3 className="text-lg font-semibold text-gray-700 mb-2">{section.title}</h3>
                          <p className="leading-relaxed">{section.description || section.questions.find((q) => q.type === 'instruction_block')?.help_text || 'See Appendix A – Reasonable Adjustments for details and to record any adjustments applied.'}</p>
                        </div>
                      ) : section.pdf_render_mode === 'reasonable_adjustment' ? (
                        (() => {
                          const isAppendixA = currentStepData && /Appendix\s*A/i.test((currentStepData.title || '').trim());
                          const formHasAppendixA = (template?.steps ?? []).some((s) => /Appendix\s*A/i.test((s.title ?? '').trim()));
                          if (!isAppendixA && formHasAppendixA) {
                            return (
                              <div className="text-sm text-gray-700">
                                <h3 className="text-lg font-semibold text-gray-700 mb-2">Reasonable Adjustment</h3>
                                <p className="leading-relaxed">Reasonable Adjustment: See Appendix A – Reasonable Adjustments for details and to record any adjustments applied.</p>
                              </div>
                            );
                          }
                          const taskResultSectionIds = (template?.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                          const firstTaskSectionId = taskResultSectionIds[0];
                          const firstTaskRdForRA = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                          const sumForRA = assessmentSummary;
                          const raSigSuggestion = firstTaskRdForRA?.trainer_signature ?? sumForRA?.trainer_sig_1 ?? null;
                          const raDateSuggestion = firstTaskRdForRA?.trainer_date ?? sumForRA?.trainer_date_1 ?? new Date().toISOString().split('T')[0];
                          return (
                        <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                          <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3 flex items-center gap-2">
                            <span className="text-sm">&#9654;</span>
                            <span>{isAppendixA ? section.title : 'Reasonable Adjustment'}</span>
                          </div>
                          <div className="p-4 space-y-4">
                            {section.questions
                              .filter((q) => isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                              .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                              .map((q) => {
                                const re = (q.role_editability as Record<string, boolean>) || {};
                                const editable = isRoleEditable(re, role) && canRoleEditCurrentWorkflow;
                                const secondOrThirdHasDataAppendix = !!(
                                  firstTaskRdForRA?.second_attempt_date ||
                                  firstTaskRdForRA?.second_attempt_satisfactory ||
                                  firstTaskRdForRA?.third_attempt_date ||
                                  firstTaskRdForRA?.third_attempt_satisfactory
                                );
                                /** Appendix A is first-cycle RA content; lock when resubmission (submission_count ≥ 2) or later attempts exist on task results. */
                                const appendixFirstCycleEditable =
                                  editable && submissionCount < 2 && !secondOrThirdHasDataAppendix;
                                const key = getAnswerKey(q.id, null);
                                const val = answers[key];
                                if (isAppendixA) {
                                  const isTaskField = q.code === 'reasonable_adjustment_appendix.task' || (q.code === 'reasonable_adjustment.task' && q.type === 'short_text');
                                  const isExplanationField = q.code === 'reasonable_adjustment_appendix.explanation' || q.code === 'reasonable_adjustment.description';
                                  if (isTaskField) {
                                    return (
                                      <QuestionRenderer key={q.id} question={q} value={(val as string) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string)} disabled={!appendixFirstCycleEditable} error={errors[`q-${q.id}`]} highlightAsFill={appendixFirstCycleEditable} />
                                    );
                                  }
                                  if (isExplanationField) {
                                    return (
                                      <QuestionRenderer key={q.id} question={q} value={(val as string) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string)} disabled={!appendixFirstCycleEditable} error={errors[`q-${q.id}`]} highlightAsFill={appendixFirstCycleEditable} />
                                    );
                                  }
                                  if (q.code === 'reasonable_adjustment_appendix.matrix' || (q.pdf_meta as Record<string, unknown>)?.appendixMatrix) {
                                    const matrixVal = val && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, boolean>) : {};
                                    return (
                                      <AppendixAMatrixForm
                                        key={q.id}
                                        value={matrixVal}
                                        onChange={(v) => handleAnswerChange(q.id, null, v)}
                                        disabled={!appendixFirstCycleEditable}
                                      />
                                    );
                                  }
                                  if (q.type === 'short_text' && !isTaskField) {
                                    return (
                                      <QuestionRenderer key={q.id} question={q} value={(val as string) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string)} disabled={!appendixFirstCycleEditable} error={errors[`q-${q.id}`]} highlightAsFill={appendixFirstCycleEditable} />
                                    );
                                  }
                                  if (q.type === 'long_text' && !isExplanationField) {
                                    return (
                                      <QuestionRenderer key={q.id} question={q} value={(val as string) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string)} disabled={!appendixFirstCycleEditable} error={errors[`q-${q.id}`]} highlightAsFill={appendixFirstCycleEditable} />
                                    );
                                  }
                                  if (q.type === 'signature') {
                                    const sigVal = val;
                                    const sigObj = sigVal && typeof sigVal === 'object' && !Array.isArray(sigVal) ? (sigVal as Record<string, unknown>) : null;
                                    const dateVal = sigObj ? String(sigObj.date ?? sigObj.signedAtDate ?? '') : '';
                                    const imgVal = sigObj?.signature ?? sigObj?.imageDataUrl ?? (typeof sigVal === 'string' ? sigVal : null);
                                    return (
                                      <div key={q.id} className="flex items-center gap-4 flex-wrap pt-2">
                                        <div className="flex-1 min-w-[200px]">
                                          <div className="text-sm font-semibold text-gray-700 mb-1">{q.label}</div>
                                          <SignatureField value={(imgVal as string | null) ?? null} onChange={(v) => { const img = typeof v === 'string' ? v : null; const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>; handleAnswerChange(q.id, null, (img != null ? { ...base, signature: img } : { ...base, signature: null }) as string | number | boolean | Record<string, unknown> | string[]); }} disabled={!appendixFirstCycleEditable} highlight={(role === 'student' || role === 'trainer') && appendixFirstCycleEditable} suggestionFrom={raSigSuggestion} onSuggestionClick={raSigSuggestion && appendixFirstCycleEditable ? () => { const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>; handleAnswerChange(q.id, null, { ...base, signature: raSigSuggestion, date: raDateSuggestion } as string | number | boolean | Record<string, unknown> | string[], true); } : undefined} />
                                        </div>
                                        <div className="flex items-center gap-2 min-w-[140px]">
                                          <span className="text-sm font-semibold text-gray-700 shrink-0">Date:</span>
                                          <DatePicker value={dateVal} onChange={(newDate) => { const base = sigObj || (typeof sigVal === 'string' ? { signature: sigVal } : {}); handleAnswerChange(q.id, null, { ...base, date: newDate } as string | number | boolean | Record<string, unknown> | string[]); }} disabled={!appendixFirstCycleEditable} highlight={(role === 'student' || role === 'trainer') && appendixFirstCycleEditable} compact placement="above" className="flex-1 min-w-0" />
                                        </div>
                                      </div>
                                    );
                                  }
                                  if (q.type === 'yes_no') {
                                    return (
                                      <QuestionRenderer key={q.id} question={q} value={(val as string | number | boolean) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean)} disabled={!appendixFirstCycleEditable} error={errors[`q-${q.id}`]} highlightAsFill={appendixFirstCycleEditable} />
                                    );
                                  }
                                  return null;
                                }
                                if (q.type === 'yes_no') {
                                  return (
                                    <QuestionRenderer key={q.id} question={q} value={(val as string | number | boolean) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean)} disabled={!editable} error={errors[`q-${q.id}`]} highlightAsFill={editable} />
                                  );
                                }
                                if (q.code === 'reasonable_adjustment.task') {
                                  return (
                                    <QuestionRenderer key={q.id} question={q} value={(val as string) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string)} disabled={!editable} error={errors[`q-${q.id}`]} highlightAsFill={editable} />
                                  );
                                }
                                if (q.type === 'long_text') {
                                  return (
                                    <QuestionRenderer key={q.id} question={q} value={(val as string) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string)} disabled={!editable} error={errors[`q-${q.id}`]} highlightAsFill={editable} />
                                  );
                                }
                                if (q.type === 'signature') {
                                  const sigVal = val;
                                  const sigObj = sigVal && typeof sigVal === 'object' && !Array.isArray(sigVal) ? (sigVal as Record<string, unknown>) : null;
                                  const dateVal = sigObj ? String(sigObj.date ?? sigObj.signedAtDate ?? '') : '';
                                  const imgVal = sigObj?.signature ?? sigObj?.imageDataUrl ?? (typeof sigVal === 'string' ? sigVal : null);
                                  return (
                                    <div key={q.id} className="flex items-center gap-4 flex-wrap pt-2">
                                      <div className="flex-1 min-w-[200px]">
                                        <div className="text-sm font-semibold text-gray-700 mb-1">{q.label}</div>
                                        <SignatureField
                                          value={(imgVal as string | null) ?? null}
                                          onChange={(v) => {
                                            const img = typeof v === 'string' ? v : null;
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            const merged = img != null ? { ...base, signature: img } : { ...base, signature: null };
                                            handleAnswerChange(q.id, null, merged as string | number | boolean | Record<string, unknown> | string[]);
                                          }}
                                          disabled={!editable}
                                          highlight={(role === 'student' || role === 'trainer') && editable}
                                          suggestionFrom={raSigSuggestion}
                                          onSuggestionClick={raSigSuggestion && editable ? () => {
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            handleAnswerChange(q.id, null, { ...base, signature: raSigSuggestion, date: raDateSuggestion } as string | number | boolean | Record<string, unknown> | string[], true);
                                          } : undefined}
                                        />
                                      </div>
                                      <div className="flex items-center gap-2 min-w-[140px]">
                                        <span className="text-sm font-semibold text-gray-700 shrink-0">Date:</span>
                                        <DatePicker
                                          value={dateVal}
                                          onChange={(newDate) => {
                                            const base = sigObj || (typeof sigVal === 'string' ? { signature: sigVal } : {});
                                            handleAnswerChange(q.id, null, { ...base, date: newDate } as string | number | boolean | Record<string, unknown> | string[]);
                                          }}
                                          disabled={!editable}
                                          highlight={(role === 'student' || role === 'trainer') && editable}
                                          compact
                                          placement="above"
                                          className="flex-1 min-w-0"
                                        />
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              })}
                          </div>
                        </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'assessment_tasks' ? (
                        (() => {
                          const taskQ = section.questions.find((q) => q.type === 'grid_table' && q.rows.length > 0);
                          if (!taskQ) return null;
                          return (
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse border border-black text-sm">
                                <thead>
                                  <tr>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-3 text-left border border-black">Evidence number</th>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-3 text-left border border-black">Assessment method/ Type of evidence</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {taskQ.rows.map((row, i) => (
                                    <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F0F4FA]'}>
                                      <td className="p-3 font-semibold border border-black">{row.row_label}</td>
                                      <td className="p-3 border border-black whitespace-pre-line">{row.row_help || ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()
                      ) : section.questions.some((q) => q.code === 'written.evidence.checklist') ? (
                        (() => {
                          const checklistQ = section.questions.find((q) => q.code === 'written.evidence.checklist' && q.type === 'single_choice' && q.rows.length > 0);
                          if (!checklistQ) return null;
                          const re = (checklistQ.role_editability as Record<string, boolean>) || {};
                          const editable = isRoleEditable(re, role) && canRoleEditCurrentWorkflow;
                          return (
                            <div className="overflow-x-auto">
                              <table className="w-full border-collapse border border-black text-sm">
                                <thead>
                                  <tr>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black w-[48px]" rowSpan={2}></th>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-2 text-left border border-black" rowSpan={2}>Written Evidence</th>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black" colSpan={2}>Submitted</th>
                                  </tr>
                                  <tr>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black w-[70px]">Yes</th>
                                    <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black w-[70px]">No</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {checklistQ.rows.map((row, idx) => {
                                    const key = getAnswerKey(checklistQ.id, row.id);
                                    const raw = answers[key];
                                    const val = typeof raw === 'string' ? raw : '';
                                    const yes = val === 'yes';
                                    const no = val === 'no';
                                    return (
                                      <tr key={row.id}>
                                        <td className="p-2 text-center border border-black">{idx + 1}</td>
                                        <td className="p-2 border border-black">{row.row_label}</td>
                                        <td className="p-2 text-center border border-black">
                                          <input
                                            type="radio"
                                            name={`written-check-${row.id}`}
                                            checked={yes}
                                            onChange={() => handleAnswerChange(checklistQ.id, row.id, yes ? '' : 'yes')}
                                            disabled={!editable}
                                            className="w-4 h-4 accent-black"
                                          />
                                        </td>
                                        <td className="p-2 text-center border border-black">
                                          <input
                                            type="radio"
                                            name={`written-check-${row.id}`}
                                            checked={no}
                                            onChange={() => handleAnswerChange(checklistQ.id, row.id, no ? '' : 'no')}
                                            disabled={!editable}
                                            className="w-4 h-4 accent-black"
                                          />
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'task_marking_checklist' ? (
                        (() => {
                          const evidenceQ = section.questions.find((q) => q.code === 'assessment.marking.evidence_outcome' && q.type === 'single_choice' && (q.rows?.length ?? 0) > 0);
                          const perfQ = section.questions.find((q) => q.code === 'assessment.marking.performance_outcome' && q.type === 'single_choice' && (q.rows?.length ?? 0) > 0);
                          if (!evidenceQ && !perfQ) return null;
                          const re = { student: false, trainer: true, office: true };
                          const editable = isRoleEditable(re, role) && canRoleEditCurrentWorkflow;
                          const renderChecklistTable = (checklistQ: typeof evidenceQ, title: string, questionText: string) => {
                            if (!checklistQ || !checklistQ.rows?.length) return null;
                            return (
                              <div key={checklistQ.id} className="mt-6 overflow-x-auto">
                                <div className="bg-[#5E5E5E] text-white font-bold px-4 py-2">{title}</div>
                                <p className="text-sm text-gray-700 py-2">{questionText}</p>
                                <table className="w-full border-collapse border border-black text-sm">
                                  <thead>
                                    <tr>
                                      <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black w-[48px]" rowSpan={2}></th>
                                      <th className="bg-[#5E5E5E] text-white font-bold p-2 text-left border border-black" rowSpan={2}>Criteria</th>
                                      <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black" colSpan={2}>SATISFACTORY</th>
                                    </tr>
                                    <tr>
                                      <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black w-[70px]">Yes</th>
                                      <th className="bg-[#5E5E5E] text-white font-bold p-2 text-center border border-black w-[70px]">No</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {checklistQ.rows.map((row, idx) => {
                                      const key = getAnswerKey(checklistQ.id, row.id);
                                      const raw = answers[key];
                                      const val = typeof raw === 'string' ? raw : '';
                                      const yes = val === 'yes';
                                      const no = val === 'no';
                                      return (
                                        <tr key={row.id}>
                                          <td className="p-2 text-center border border-black">{idx + 1}</td>
                                          <td className="p-2 border border-black">{row.row_label}</td>
                                          <td className="p-2 text-center border border-black">
                                            <input type="radio" name={`marking-${checklistQ.id}-${row.id}`} checked={yes} onChange={() => handleAnswerChange(checklistQ.id, row.id, yes ? '' : 'yes')} disabled={!editable} className="w-4 h-4 accent-black" />
                                          </td>
                                          <td className="p-2 text-center border border-black">
                                            <input type="radio" name={`marking-${checklistQ.id}-${row.id}`} checked={no} onChange={() => handleAnswerChange(checklistQ.id, row.id, no ? '' : 'no')} disabled={!editable} className="w-4 h-4 accent-black" />
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            );
                          };
                          return (
                            <div className="border border-gray-300 rounded-lg overflow-hidden bg-white">
                              <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">ASSESSMENT MARKING CHECKLIST</div>
                              <div className="p-4 space-y-4">
                                {evidenceQ && renderChecklistTable(evidenceQ, 'EVIDENCE OUTCOME', 'Did the candidate complete and submit the following while being observed?')}
                                {perfQ && renderChecklistTable(perfQ, 'PERFORMANCE OUTCOME', 'Did the candidate provide answers to the following questions with the required length and breadth consistently applying knowledge of vocational environment?')}
                              </div>
                            </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'assessment_submission' ? (
                        <div className="border border-black p-4 bg-white">
                          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                            {section.questions
                              .filter((q) => isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                              .map((q) =>
                                q.type === 'multi_choice' ? (
                                  <React.Fragment key={q.id}>
                                    {q.options?.map((opt) => {
                                      const isLms = /lms|learning management/i.test(opt.label);
                                      const isOther = opt.value === 'other';
                                      const spanFull = isLms || isOther;
                                      const rawVal = answers[getAnswerKey(q.id, null)];
                                      const currentArr = Array.isArray(rawVal) ? rawVal : (typeof rawVal === 'string' ? rawVal.split(',').map((s) => s.trim()).filter(Boolean) : []);
                                      const selected = currentArr.includes(opt.value);
                                      const submissionEditable = section.pdf_render_mode === 'assessment_submission' || isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role);
                                      return (
                                        <label
                                          key={opt.id}
                                          className={`flex items-center gap-2 cursor-pointer ${spanFull ? 'col-span-2' : ''} ${!submissionEditable ? 'opacity-60 cursor-not-allowed' : ''}`}
                                        >
                                          <input
                                            type="checkbox"
                                            checked={selected}
                                            onChange={() => {
                                              const next = selected
                                                ? currentArr.filter((v) => v !== opt.value)
                                                : [...currentArr, opt.value];
                                              handleAnswerChange(q.id, null, next);
                                            }}
                                            disabled={!submissionEditable}
                                            className="w-[18px] h-[18px] flex-shrink-0 cursor-pointer accent-black"
                                          />
                                          <span className="text-gray-700">{opt.label}</span>
                                          {isOther && (
                                            <span className="flex-1 border-b border-gray-600 min-w-[120px] min-h-[18px]" />
                                          )}
                                        </label>
                                      );
                                    })}
                                  </React.Fragment>
                                ) : q.type === 'short_text' ? (
                                  <div key={q.id} className="col-span-2 mt-2 text-center">
                                    <input
                                      type="text"
                                      value={(answers[getAnswerKey(q.id, null)] as string) ?? ''}
                                      onChange={(e) => handleAnswerChange(q.id, null, e.target.value)}
                                      disabled={!(section.pdf_render_mode === 'assessment_submission' || isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role))}
                                      className="w-full max-w-[300px] mx-auto border-0 border-b border-gray-600 bg-transparent px-2 py-1 text-center focus:outline-none focus:ring-0"
                                      placeholder=""
                                    />
                                    <div className="text-xs italic text-gray-500 mt-1">(Please describe here)</div>
                                  </div>
                                ) : null
                              )}
                          </div>
                        </div>
                      ) : section.pdf_render_mode === 'task_instructions' ? (
                        (() => {
                          const taskRow = (section as { taskRow?: { row_label: string; row_help: string | null; row_meta?: { instructions?: Record<string, string | string[]> } } }).taskRow;
                          const instr = taskRow?.row_meta?.instructions;
                          if (!instr) return <div className="text-gray-500 italic">No instructions configured for this task.</div>;
                          const customBlocks = Array.isArray((instr as { blocks?: unknown[] }).blocks)
                            ? ((instr as { blocks?: Array<{ id?: string; type?: string; heading?: string; content?: string; columnHeaders?: string[]; rows?: Array<{ heading?: string; content?: string; cells?: string[] }> }> }).blocks || [])
                            : [];
                          const sanitizeInstructionHtml = (html: string) => {
                            // Normalize HTML that may contain hidden word-break hints (soft hyphens, zero-width spaces, <wbr>, etc.)
                            // so words wrap cleanly like the PDF output.
                            return String(html || '')
                              .replace(/\u00ad/g, '') // soft hyphen char
                              .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '') // zero-width spaces/joiners
                              .replace(/&shy;/gi, '') // soft hyphen entity
                              .replace(/&ZeroWidthSpace;|&#8203;|&#x200B;/gi, '') // zero-width space entities
                              .replace(/<wbr\s*\/?>/gi, '') // word break tag
                              .replace(/-\s*<br\s*\/?>/gi, '') // hyphen + line break
                              .replace(/-\s*\r?\n\s*/g, '') // hyphen + newline
                              // Remove explicit breaks inside a word, but only when between letters.
                              .replace(/([A-Za-z])\s*<br\s*\/?>\s*([A-Za-z])/gi, '$1$2')
                              .replace(/([A-Za-z])\s*\r?\n\s*([A-Za-z])/g, '$1$2');
                          };
                          if (customBlocks.length > 0) {
                            const instrTyped = instr as { assessment_type?: string };
                            return (
                              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                                <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                                  Student Instructions: {taskRow?.row_label || section.title}
                                </div>
                                <div className="p-4 space-y-4">
                                  {instrTyped.assessment_type && (
                                    <div>
                                      <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t">Assessment type</div>
                                      <div className="border border-gray-200 border-t-0 rounded-b p-3 bg-gray-50 prose prose-sm max-w-none whitespace-pre-line">{instrTyped.assessment_type}</div>
                                    </div>
                                  )}
                                  {customBlocks.map((b, idx) => (
                                    <div key={String(b.id || idx)}>
                                      {b.type === 'table' && !!String(b.heading || '').trim() && (
                                        <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t">{String(b.heading)}</div>
                                      )}
                                      {b.type === 'table' ? (
                                        <div className={`border border-gray-200 ${String(b.heading || '').trim() ? 'border-t-0 rounded-b' : 'rounded'} overflow-x-hidden`}>
                                          <table className="w-full table-fixed border-collapse text-sm">
                                            {Array.isArray(b.columnHeaders) && b.columnHeaders.length > 0 && (
                                              <thead>
                                                <tr className="bg-gray-200">
                                                  {b.columnHeaders.map((h, hi) => (
                                                    <th key={hi} className="border border-gray-300 p-2 text-left font-semibold text-gray-700 whitespace-normal break-normal align-top">
                                                      {h}
                                                    </th>
                                                  ))}
                                                </tr>
                                              </thead>
                                            )}
                                            <tbody>
                                              {(Array.isArray(b.rows) ? b.rows : []).map((r, ri) => {
                                                const cells = r.cells;
                                                const isMultiCol = Array.isArray(cells) && cells.length > 0;
                                                return (
                                                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                                    {isMultiCol ? (
                                                      cells.map((cell, ci) => (
                                                        <td key={ci} className="border border-gray-300 p-2 whitespace-normal break-normal align-top">
                                                          <div className="[overflow-wrap:break-word]">
                                                            <div lang="en" className="prose prose-sm max-w-none whitespace-normal break-normal" dangerouslySetInnerHTML={{ __html: normalizeRichTextForPage(sanitizeInstructionHtml(String(cell || '')).replace(/\n/g, '<br/>')) }} />
                                                          </div>
                                                        </td>
                                                      ))
                                                    ) : (
                                                      <>
                                                        <td className="border border-gray-300 p-2 align-top font-semibold w-[24%] whitespace-normal break-normal">{String(r.heading || '')}</td>
                                                        <td className="border border-gray-300 border-r p-2 align-top w-[76%] whitespace-normal break-normal">
                                                          <div className="[overflow-wrap:break-word]">
                                                            <div lang="en" className="prose prose-sm max-w-none whitespace-normal break-normal" dangerouslySetInnerHTML={{ __html: normalizeRichTextForPage(sanitizeInstructionHtml(String(r.content || ''))) }} />
                                                          </div>
                                                        </td>
                                                      </>
                                                    )}
                                                  </tr>
                                                );
                                              })}
                                            </tbody>
                                          </table>
                                        </div>
                                      ) : (
                                        <div className="overflow-x-hidden">
                                          <div
                                            lang="en"
                                            className="prose prose-sm max-w-none whitespace-normal break-normal [word-break:normal] [hyphens:none] [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_th]:whitespace-normal [&_th]:break-normal [&_th]:align-top [&_th]:[word-break:normal] [&_th]:[hyphens:none] [&_td]:whitespace-normal [&_td]:break-normal [&_td]:align-top [&_td]:[word-break:normal] [&_td]:[hyphens:none] [&_td>div]:[overflow-wrap:break-word] [&_td>p]:[overflow-wrap:break-word] [&_td>span]:[overflow-wrap:break-word]"
                                            dangerouslySetInnerHTML={{ __html: normalizeRichTextForPage(sanitizeInstructionHtml(String(b.content || ''))) }}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          }
                          const escapeAndNlToBr = (s: string) =>
                            String(s || '')
                              .replace(/&/g, '&amp;')
                              .replace(/</g, '&lt;')
                              .replace(/>/g, '&gt;')
                              .replace(/\n/g, '<br/>');
                          const blocks: { title: string; content: string }[] = [
                            { title: 'Assessment type', content: escapeAndNlToBr(String(instr.assessment_type || '')) },
                            { title: 'Instructions provided to the student:', content: String(instr.task_description || '') },
                            { title: 'Applicable conditions:', content: String(instr.applicable_conditions || '') },
                            { title: 'Resubmissions and reattempts:', content: String(instr.resubmissions || '') },
                            { title: 'Location:', content: String(instr.location_intro || '') + (Array.isArray(instr.location_options) ? '<ul><li>' + instr.location_options.join('</li><li>') + '</li></ul>' : '') + String(instr.location_note || '') },
                            { title: 'Instructions for answering the written questions:', content: String(instr.answering_instructions || '') },
                            { title: 'Purpose of the assessment', content: String(instr.purpose_intro || '') + String(instr.purpose_bullets || '') },
                            { title: 'Task instructions', content: String(instr.task_instructions || '') },
                          ];
                          return (
                            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                              <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                                Student Instructions: {taskRow?.row_label || section.title}
                              </div>
                              <div className="p-4 space-y-4">
                                {blocks.filter((b) => b.content.replace(/<[^>]*>/g, '').trim()).map((b, i) => (
                                  <div key={i}>
                                    <div className="bg-gray-600 text-white font-semibold text-sm px-3 py-2 rounded-t">{b.title}</div>
                                    <div className="border border-gray-200 border-t-0 rounded-b p-3 bg-gray-50">
                                      <div className="overflow-x-hidden">
                                        <div
                                          lang="en"
                                          className="prose prose-sm max-w-none whitespace-normal break-normal [word-break:normal] [hyphens:none] [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_th]:whitespace-normal [&_th]:break-normal [&_th]:align-top [&_th]:[word-break:normal] [&_th]:[hyphens:none] [&_td]:whitespace-normal [&_td]:break-normal [&_td]:align-top [&_td]:[word-break:normal] [&_td]:[hyphens:none] [&_td>div]:[overflow-wrap:break-word] [&_td>p]:[overflow-wrap:break-word] [&_td>span]:[overflow-wrap:break-word]"
                                          dangerouslySetInnerHTML={{ __html: normalizeRichTextForPage(sanitizeInstructionHtml(b.content)) }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'task_questions' ? (
                        (() => {
                          const taskRowsOrderedForQuestions: { id: number }[] = [];
                          for (const step of template?.steps || []) {
                            for (const sec of step.sections) {
                              if (sec.pdf_render_mode === 'assessment_tasks') {
                                const taskQ = sec.questions.find((q) => q.type === 'grid_table' && q.rows.length > 0);
                                if (taskQ) for (const r of taskQ.rows) taskRowsOrderedForQuestions.push({ id: r.id });
                              }
                            }
                          }
                          const taskRowId = (section as { assessment_task_row_id?: number | null }).assessment_task_row_id;
                          const assessmentTaskIndex = taskRowId ? taskRowsOrderedForQuestions.findIndex((r) => r.id === taskRowId) + 1 : 1;
                          const isAssessment2Plus = assessmentTaskIndex >= 2;
                          const taskQNumbers = getTaskQuestionDisplayNumbers(section.questions);

                          if (isAssessment2Plus) {
                            return (
                              <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                                <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                                  {section.title}
                                </div>
                                <div className="bg-[#6b7280] text-white text-sm px-4 py-2">
                                  Provide your response to each question in the box below.
                                </div>
                                <div className="p-4 space-y-6">
                                  {section.questions
                                    .filter((q) => q.type !== 'instruction_block' && q.type !== 'page_break' && !(q.pdf_meta as Record<string, unknown>)?.isAdditionalBlockOf && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                                    .map((q) => {
                                      const re = (q.role_editability as Record<string, boolean>) || {};
                                      const baseEditable = isRoleEditable(re, role) && canRoleEditCurrentWorkflow;
                                      const editable = baseEditable && !isQuestionReadOnlyByTrainer(q.id);
                                      const trainerEditable = role === 'trainer' || role === 'office';
                                      const pm = (q.pdf_meta as Record<string, unknown>) || {};
                                      const textAboveHeader = String(pm.textAboveHeader ?? '').trim();
                                      const legacyAb = pm.additionalBlock as Record<string, unknown> | undefined;
                                      const contentBlocks: Array<{ type: string; content?: string; questionId?: number; headerText?: string; imageUrl?: string; imageLayout?: string; imageWidthPercent?: number }> = Array.isArray(pm.contentBlocks)
                                        ? (pm.contentBlocks as Array<{ type: string; content?: string; questionId?: number; headerText?: string; imageUrl?: string; imageLayout?: string; imageWidthPercent?: number }>)
                                        : legacyAb ? [{ type: String(legacyAb.type ?? 'instruction_block'), content: legacyAb.content as string | undefined, questionId: legacyAb.questionId as number | undefined }] : [];
                                      const wrapWithHeader = (key: string, headerText: string | undefined, content: React.ReactNode) => (
                                        <div key={key} className="mt-3">
                                          {headerText && <div className="font-bold text-gray-900 mb-2">{headerText}</div>}
                                          {content}
                                        </div>
                                      );
                                      const renderBlock = (block: { type: string; content?: string; questionId?: number; headerText?: string; imageUrl?: string; imageLayout?: string; imageWidthPercent?: number }, key: string) => {
                                        if (block.type === 'instruction_block' && (block.content || (block as { imageUrl?: string }).imageUrl)) {
                                            const content = block.content ? (
                                              <div className="overflow-x-hidden">
                                                <div
                                                  className="text-sm text-gray-700 prose prose-sm max-w-none whitespace-normal break-normal [word-break:normal] [hyphens:none] [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_th]:whitespace-normal [&_th]:break-normal [&_th]:align-top [&_th]:[word-break:normal] [&_th]:[hyphens:none] [&_td]:whitespace-normal [&_td]:break-normal [&_td]:align-top [&_td]:[word-break:normal] [&_td]:[hyphens:none] [&_td>div]:[overflow-wrap:break-word] [&_td>p]:[overflow-wrap:break-word] [&_td>span]:[overflow-wrap:break-word]"
                                                  dangerouslySetInnerHTML={{ __html: normalizeRichTextForPage(sanitizeInstructionHtml(String(block.content))) }}
                                                />
                                              </div>
                                            ) : null;
                                          const imgUrl = (block as { imageUrl?: string }).imageUrl;
                                          const layout = (block as { imageLayout?: string }).imageLayout || 'side_by_side';
                                          const pct = Math.max(20, Math.min(80, (block as { imageWidthPercent?: number }).imageWidthPercent || 50));
                                          const imgEl = imgUrl ? <img src={imgUrl} alt="" className="max-w-full h-auto object-contain rounded border border-gray-200" style={{ maxHeight: 280 }} /> : null;
                                          let blockContent: React.ReactNode;
                                          if (!imgEl) blockContent = content;
                                          else if (layout === 'above') blockContent = <div><div className="mb-2">{imgEl}</div>{content}</div>;
                                          else if (layout === 'below') blockContent = <div>{content}<div className="mt-2">{imgEl}</div></div>;
                                          else blockContent = <div className="flex gap-4 items-start"><div className="flex-1 min-w-0">{content}</div><div style={{ width: `${pct}%`, flexShrink: 0 }}>{imgEl}</div></div>;
                                          return wrapWithHeader(key, block.headerText, blockContent);
                                        }
                                        const childQ = block.questionId ? section.questions.find((x) => x.id === block.questionId) : null;
                                        if (!childQ) return null;
                                        if (block.type === 'grid_table' && childQ.rows?.length) {
                                          const merged: Record<string, string> = {};
                                          for (const r of childQ.rows) {
                                            const v = answers[getAnswerKey(childQ.id, r.id)];
                                            if (v && typeof v === 'object') Object.assign(merged, v as Record<string, string>);
                                          }
                                          const onGridChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                                            const o = v as Record<string, string>;
                                            if (!o || typeof o !== 'object') return;
                                            const byRow = new Map<number, Record<string, string>>();
                                            for (const [k, val] of Object.entries(o)) {
                                              const match = /^r(\d+)_c/.exec(k);
                                              if (match) {
                                                const rowId = Number(match[1]);
                                                if (!byRow.has(rowId)) byRow.set(rowId, {});
                                                byRow.get(rowId)![k] = String(val);
                                              }
                                            }
                                            for (const [rowId, rowData] of byRow.entries()) {
                                              handleAnswerChange(childQ.id, rowId, rowData);
                                            }
                                          };
                                          const childSat = trainerAssessments[childQ.id];
                                          const childSatYes = childSat === 'yes';
                                          const childSatNo = childSat === 'no';
                                          return wrapWithHeader(key, block.headerText, (
                                            <div>
                                              <div className="mb-3 py-2 px-3 rounded bg-gray-50 border-b border-gray-200 flex items-center justify-end gap-2">
                                                <span className="text-sm font-semibold text-gray-700">Satisfactory response:</span>
                                                <button
                                                  type="button"
                                                  onClick={() => trainerEditable && handleTrainerAssessmentChange(childQ.id, 'yes')}
                                                  disabled={!trainerEditable}
                                                  className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                                                    childSatYes
                                                      ? 'bg-emerald-100 border-emerald-600 text-emerald-900'
                                                      : 'border-gray-300 text-gray-600 hover:border-gray-500 hover:text-gray-800'
                                                  }`}
                                                >
                                                  Yes
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => trainerEditable && handleTrainerAssessmentChange(childQ.id, 'no')}
                                                  disabled={!trainerEditable}
                                                  className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                                                    childSatNo
                                                      ? 'bg-rose-100 border-rose-600 text-rose-900'
                                                      : 'border-gray-300 text-gray-600 hover:border-gray-500 hover:text-gray-800'
                                                  }`}
                                                >
                                                  No
                                                </button>
                                              </div>
                                              <QuestionRenderer
                                                question={childQ}
                                                value={Object.keys(merged).length ? merged : null}
                                                onChange={onGridChange}
                                                disabled={!editable}
                                                error={errors[`q-${childQ.id}`]}
                                                highlightAsFill={editable}
                                                showRowAssessmentColumn={false}
                                                studentResubmissionReadOnlyForSatisfactoryRows={isResubmissionAfterTrainer}
                                              />
                                            </div>
                                          ));
                                        }
                                        if (block.type === 'short_text' || block.type === 'long_text') {
                                          const val = answers[getAnswerKey(childQ.id, null)] as string | undefined;
                                          return wrapWithHeader(key, block.headerText, <QuestionRenderer question={childQ} value={val ?? null} onChange={(v) => handleAnswerChange(childQ.id, null, v as string | number | boolean | Record<string, unknown> | string[])} disabled={!editable} error={errors[`q-${childQ.id}`]} highlightAsFill={editable} />);
                                        }
                                        return null;
                                      };
                                      return (
                                        <div key={q.id} className="border border-gray-200 rounded-lg overflow-hidden">
                                          <div className="bg-gray-100 font-semibold text-gray-800 px-4 py-2 border-b border-gray-200">
                                            {(() => {
                                              const qn = taskQNumbers.get(q.id);
                                              const inner = (() => {
                                                const qPm = (q.pdf_meta as Record<string, unknown>) || {};
                                                const imgUrl = qPm.imageUrl as string | undefined;
                                                const layout = (qPm.imageLayout as string) || 'side_by_side';
                                                const pct = Math.max(20, Math.min(80, (qPm.imageWidthPercent as number) || 50));
                                                const imgEl = imgUrl ? <img src={imgUrl} alt="" className="max-w-full h-auto object-contain rounded border border-gray-200" style={{ maxHeight: 280 }} /> : null;
                                                if (!imgEl) return <>{q.label}</>;
                                                if (layout === 'above') return <><div className="mb-2">{imgEl}</div><div>{q.label}</div></>;
                                                if (layout === 'below') return <><div>{q.label}</div><div className="mt-2">{imgEl}</div></>;
                                                return <div className="flex gap-4 items-start"><div className="flex-1 min-w-0">{q.label}</div><div style={{ width: `${pct}%`, flexShrink: 0 }}>{imgEl}</div></div>;
                                              })();
                                              return qn != null ? (
                                                <div className="flex gap-2 items-start">
                                                  <span className="font-semibold text-gray-900 shrink-0">Q{qn}:</span>
                                                  <div className="flex-1 min-w-0 font-semibold text-gray-800">{inner}</div>
                                                </div>
                                              ) : (
                                                inner
                                              );
                                            })()}
                                          </div>
                                          <div className="p-4">
                                            {textAboveHeader && <div className="font-bold text-gray-900 mb-2">{textAboveHeader}</div>}
                                            {q.type === 'grid_table' && q.rows.length > 0 ? (
                                              (() => {
                                                const merged: Record<string, string> = {};
                                                for (const r of q.rows) {
                                                  const v = answers[getAnswerKey(q.id, r.id)];
                                                  if (v && typeof v === 'object') Object.assign(merged, v as Record<string, string>);
                                                }
                                                const onGridChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                                                  const o = v as Record<string, string>;
                                                  if (!o || typeof o !== 'object') return;
                                                  const byRow = new Map<number, Record<string, string>>();
                                                  for (const [k, val] of Object.entries(o)) {
                                                    const match = /^r(\d+)_c/.exec(k);
                                                    if (match) {
                                                      const rowId = Number(match[1]);
                                                      if (!byRow.has(rowId)) byRow.set(rowId, {});
                                                      byRow.get(rowId)![k] = String(val);
                                                    }
                                                  }
                                                  for (const [rowId, rowData] of byRow.entries()) {
                                                    handleAnswerChange(q.id, rowId, rowData);
                                                  }
                                                };
                                                const satQ = trainerAssessments[q.id];
                                                const satQYes = satQ === 'yes';
                                                const satQNo = satQ === 'no';
                                                return (
                                                  <div>
                                                    <div className="mb-3 py-2 px-3 rounded bg-gray-50 border-b border-gray-200 flex items-center justify-end gap-2">
                                                      <span className="text-sm font-semibold text-gray-700">Satisfactory response:</span>
                                                      <button
                                                        type="button"
                                                        onClick={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'yes')}
                                                        disabled={!trainerEditable}
                                                        className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                                                          satQYes
                                                            ? 'bg-emerald-100 border-emerald-600 text-emerald-900'
                                                            : 'border-gray-300 text-gray-600 hover:border-gray-500 hover:text-gray-800'
                                                        }`}
                                                      >
                                                        Yes
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'no')}
                                                        disabled={!trainerEditable}
                                                        className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                                                          satQNo
                                                            ? 'bg-rose-100 border-rose-600 text-rose-900'
                                                            : 'border-gray-300 text-gray-600 hover:border-gray-500 hover:text-gray-800'
                                                        }`}
                                                      >
                                                        No
                                                      </button>
                                                    </div>
                                                    <QuestionRenderer
                                                      question={q}
                                                      value={Object.keys(merged).length ? merged : null}
                                                      onChange={onGridChange}
                                                      disabled={!editable}
                                                      error={errors[`q-${q.id}`]}
                                                      highlightAsFill={editable}
                                                      showRowAssessmentColumn={false}
                                                      studentResubmissionReadOnlyForSatisfactoryRows={isResubmissionAfterTrainer}
                                                      hideQuestionLabel
                                                    />
                                                  </div>
                                                );
                                              })()
                                            ) : (
                                              <div>
                                                <div className="mb-3 py-2 px-3 rounded bg-gray-50 border-b border-gray-200 flex items-center justify-end gap-2">
                                                  <span className="text-sm font-semibold text-gray-700">Satisfactory response:</span>
                                                  <button
                                                    type="button"
                                                    onClick={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'yes')}
                                                    disabled={!trainerEditable}
                                                    className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                                                      trainerAssessments[q.id] === 'yes'
                                                        ? 'bg-emerald-100 border-emerald-600 text-emerald-900'
                                                        : 'border-gray-300 text-gray-600 hover:border-gray-500 hover:text-gray-800'
                                                    }`}
                                                  >
                                                    Yes
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'no')}
                                                    disabled={!trainerEditable}
                                                    className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                                                      trainerAssessments[q.id] === 'no'
                                                        ? 'bg-rose-100 border-rose-600 text-rose-900'
                                                        : 'border-gray-300 text-gray-600 hover:border-gray-500 hover:text-gray-800'
                                                    }`}
                                                  >
                                                    No
                                                  </button>
                                                </div>
                                                <QuestionRenderer question={q} value={(answers[getAnswerKey(q.id, null)] as string | number | boolean | Record<string, unknown> | string[] | undefined) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean | Record<string, unknown> | string[])} disabled={!editable} error={errors[`q-${q.id}`]} highlightAsFill={editable} />
                                              </div>
                                            )}
                                            {contentBlocks.map((block, bi) => renderBlock(block, String(block.questionId ?? `block-${bi}`)))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            );
                          }

                          return (
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                          <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                            {section.title}
                          </div>
                          <div className="bg-[#6b7280] text-white text-sm px-4 py-2">
                            Provide your response to each question in the box below.
                          </div>
                          <div className="w-full overflow-x-auto">
                            <table className="w-full border-collapse text-sm table-fixed">
                              <thead>
                                <tr>
                                  <th className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300 text-left align-top" style={{ width: 'calc(100% - 9rem)' }}>
                                    Question
                                  </th>
                                  <th className="bg-gray-200 font-semibold text-gray-700 p-2 border border-gray-300 text-center align-top break-words" style={{ width: '9rem', minWidth: 0 }}>
                                    Satisfactory response
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {section.questions
                                  .filter((q) => q.type !== 'instruction_block' && q.type !== 'page_break' && !(q.pdf_meta as Record<string, unknown>)?.isAdditionalBlockOf && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                                  .map((q, qIdx) => {
                                    const re = (q.role_editability as Record<string, boolean>) || {};
                                    const baseEditable = isRoleEditable(re, role) && canRoleEditCurrentWorkflow;
                                    const editable = baseEditable && !isQuestionReadOnlyByTrainer(q.id);
                                    const trainerEditable = role === 'trainer' || role === 'office';
                                    const sat = trainerAssessments[q.id];
                                    const satYes = sat === 'yes';
                                    const satNo = sat === 'no';
                                    return (
                                      <tr key={q.id} className={qIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                                        <td className="p-3 border border-gray-300 align-top">
                                          {(() => {
                                            const pm = (q.pdf_meta as Record<string, unknown>) || {};
                                            const textAboveHeader = String(pm.textAboveHeader ?? '').trim();
                                            const legacyAb = pm.additionalBlock as Record<string, unknown> | undefined;
                                            const contentBlocks: Array<{ type: string; content?: string; questionId?: number; headerText?: string; imageUrl?: string; imageLayout?: string; imageWidthPercent?: number }> = Array.isArray(pm.contentBlocks)
                                              ? (pm.contentBlocks as Array<{ type: string; content?: string; questionId?: number; headerText?: string; imageUrl?: string; imageLayout?: string; imageWidthPercent?: number }>)
                                              : legacyAb ? [{
                                                  type: String(legacyAb.type ?? 'instruction_block'),
                                                  content: legacyAb.content as string | undefined,
                                                  questionId: legacyAb.questionId as number | undefined,
                                                }] : [];
                                            const wrapWithHeader = (key: string, headerText: string | undefined, content: React.ReactNode) => (
                                              <div key={key} className="mt-3">
                                                {headerText && <div className="font-bold text-gray-900 mb-2">{headerText}</div>}
                                                {content}
                                              </div>
                                            );
                                            const renderBlock = (block: { type: string; content?: string; questionId?: number; headerText?: string; imageUrl?: string; imageLayout?: string; imageWidthPercent?: number }, key: string) => {
                                              if (block.type === 'instruction_block' && (block.content || block.imageUrl)) {
                                                const content = block.content ? (
                                                  <div className="overflow-x-auto">
                                                    <div
                                                      className="text-sm text-gray-700 prose prose-sm max-w-none whitespace-normal overflow-visible hyphens-none [&_table]:w-full [&_table]:max-w-full [&_table]:table-fixed [&_th]:break-keep [&_th]:whitespace-normal [&_th]:align-top [&_th]:hyphens-none [&_td]:break-keep [&_td]:whitespace-normal [&_td]:align-top [&_td]:hyphens-none [&_td]:min-w-0 [&_td>*]:min-w-0"
                                                      dangerouslySetInnerHTML={{ __html: normalizeRichTextForPage(sanitizeInstructionHtml(String(block.content))) }}
                                                    />
                                                  </div>
                                                ) : null;
                                                const imgUrl = block.imageUrl;
                                                const layout = block.imageLayout || 'side_by_side';
                                                const pct = Math.max(20, Math.min(80, block.imageWidthPercent || 50));
                                                const imgEl = imgUrl ? <img src={imgUrl} alt="" className="max-w-full h-auto object-contain rounded border border-gray-200" style={{ maxHeight: 280 }} /> : null;
                                                let blockContent: React.ReactNode;
                                                if (!imgEl) blockContent = content;
                                                else if (layout === 'above') blockContent = <div><div className="mb-2">{imgEl}</div>{content}</div>;
                                                else if (layout === 'below') blockContent = <div>{content}<div className="mt-2">{imgEl}</div></div>;
                                                else blockContent = <div className="flex gap-4 items-start"><div className="flex-1 min-w-0">{content}</div><div style={{ width: `${pct}%`, flexShrink: 0 }}>{imgEl}</div></div>;
                                                return wrapWithHeader(key, block.headerText, blockContent);
                                              }
                                              const childQ = block.questionId ? section.questions.find((x) => x.id === block.questionId) : null;
                                              if (!childQ) return null;
                                              if (block.type === 'grid_table' && childQ.rows?.length) {
                                                const merged: Record<string, string> = {};
                                                for (const r of childQ.rows) {
                                                  const v = answers[getAnswerKey(childQ.id, r.id)];
                                                  if (v && typeof v === 'object') Object.assign(merged, v as Record<string, string>);
                                                }
                                                const onGridChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                                                  const o = v as Record<string, string>;
                                                  if (!o || typeof o !== 'object') return;
                                                  const byRow = new Map<number, Record<string, string>>();
                                                  for (const [k, val] of Object.entries(o)) {
                                                    const match = /^r(\d+)_c/.exec(k);
                                                    if (match) {
                                                      const rowId = Number(match[1]);
                                                      if (!byRow.has(rowId)) byRow.set(rowId, {});
                                                      byRow.get(rowId)![k] = String(val);
                                                    }
                                                  }
                                                  for (const [rowId, rowData] of byRow.entries()) {
                                                    handleAnswerChange(childQ.id, rowId, rowData);
                                                  }
                                                };
                                                return wrapWithHeader(key, block.headerText, <QuestionRenderer question={childQ} value={Object.keys(merged).length ? merged : null} onChange={onGridChange} disabled={!editable} error={errors[`q-${childQ.id}`]} studentResubmissionReadOnlyForSatisfactoryRows={isResubmissionAfterTrainer} taskQuestionDisplayNumber={taskQNumbers.get(childQ.id)} highlightAsFill={editable} />);
                                              }
                                              if (block.type === 'short_text' || block.type === 'long_text') {
                                                const val = answers[getAnswerKey(childQ.id, null)] as string | undefined;
                                                return wrapWithHeader(key, block.headerText, <QuestionRenderer question={childQ} value={val ?? null} onChange={(v) => handleAnswerChange(childQ.id, null, v as string | number | boolean | Record<string, unknown> | string[])} disabled={!editable} error={errors[`q-${childQ.id}`]} taskQuestionDisplayNumber={taskQNumbers.get(childQ.id)} highlightAsFill={editable} />);
                                              }
                                              return null;
                                            };
                                            return (
                                              <div className="space-y-3">
                                                {textAboveHeader && <div className="font-bold text-gray-900">{textAboveHeader}</div>}
                                                {q.type === 'grid_table' && q.rows.length > 0 ? (
                                                  (() => {
                                                    const merged: Record<string, string> = {};
                                                    for (const r of q.rows) {
                                                      const v = answers[getAnswerKey(q.id, r.id)];
                                                      if (v && typeof v === 'object') Object.assign(merged, v as Record<string, string>);
                                                    }
                                                    const onGridChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                                                      const byRow = new Map<number, Record<string, string>>();
                                                      const o = v as Record<string, string>;
                                                      if (!o || typeof o !== 'object') return;
                                                      for (const [k, val] of Object.entries(o)) {
                                                        const match = /^r(\d+)_c/.exec(k);
                                                        if (match) {
                                                          const rowId = Number(match[1]);
                                                          if (!byRow.has(rowId)) byRow.set(rowId, {});
                                                          byRow.get(rowId)![k] = String(val);
                                                        }
                                                      }
                                                      for (const [rowId, rowData] of byRow.entries()) {
                                                        handleAnswerChange(q.id, rowId, rowData);
                                                      }
                                                    };
                                                    return <QuestionRenderer question={q} value={Object.keys(merged).length ? merged : null} onChange={onGridChange} disabled={!editable} error={errors[`q-${q.id}`]} studentResubmissionReadOnlyForSatisfactoryRows={isResubmissionAfterTrainer} taskQuestionDisplayNumber={taskQNumbers.get(q.id)} highlightAsFill={editable} />;
                                                  })()
                                                ) : (
                                                  <QuestionRenderer question={q} value={(answers[getAnswerKey(q.id, null)] as string | number | boolean | Record<string, unknown> | string[] | undefined) ?? null} onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean | Record<string, unknown> | string[])} disabled={!editable} error={errors[`q-${q.id}`]} taskQuestionDisplayNumber={taskQNumbers.get(q.id)} highlightAsFill={editable} />
                                                )}
                                                {contentBlocks.map((block, bi) => renderBlock(block, String(block.questionId ?? `block-${bi}`)))}
                                              </div>
                                            );
                                          })()}
                                        </td>
                                        <td className="p-2 border border-gray-300 align-top" style={{ width: '9.5rem' }}>
                                          <div className="flex flex-row items-center justify-center gap-3">
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`trainer-sat-${q.id}`}
                                                checked={satYes}
                                                onChange={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'yes')}
                                                disabled={!trainerEditable}
                                                className="w-4 h-4 border-gray-600"
                                              />
                                              <span>Yes</span>
                                            </label>
                                            <label className="flex items-center gap-1.5 cursor-pointer">
                                              <input
                                                type="radio"
                                                name={`trainer-sat-${q.id}`}
                                                checked={satNo}
                                                onChange={() => trainerEditable && handleTrainerAssessmentChange(q.id, 'no')}
                                                disabled={!trainerEditable}
                                                className="w-4 h-4 border-gray-600"
                                              />
                                              <span>No</span>
                                            </label>
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'task_results' ? (
                        (() => {
                          const rd = resultsData[section.id];
                          const trainerCanEdit = role === 'trainer' || role === 'office';
                          const studentCanEdit = role === 'student' || role === 'office';
                          const taskResultSectionIds = (template?.steps || []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                          const firstTaskSectionId = taskResultSectionIds[0];
                          const firstTaskData = firstTaskSectionId && firstTaskSectionId !== section.id ? resultsData[firstTaskSectionId] : null;
                          const raTrainerQForResults = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
                          const raValForResults = raTrainerQForResults ? answers[getAnswerKey(raTrainerQForResults.id, null)] : undefined;
                          const raSigObjForResults = raValForResults && typeof raValForResults === 'object' && !Array.isArray(raValForResults) ? (raValForResults as Record<string, unknown>) : null;
                          const raTrainerSigForResults = raSigObjForResults ? (String(raSigObjForResults.signature ?? raSigObjForResults.imageDataUrl ?? '') || null) : (typeof raValForResults === 'string' ? raValForResults : null);
                          const raTrainerDateForResults = raSigObjForResults ? String(raSigObjForResults.date ?? raSigObjForResults.signedAtDate ?? '') : '';
                          const trainerSuggestionSig = raTrainerSigForResults ?? firstTaskData?.trainer_signature ?? null;
                          const todayForResults = new Date().toISOString().split('T')[0];
                          const trainerSuggestionDate = raTrainerDateForResults || (firstTaskData?.trainer_date ?? todayForResults);
                          const studentDeclQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.declarationSignature');
                          const studentDeclVal = studentDeclQ ? answers[getAnswerKey(studentDeclQ.id, null)] : undefined;
                          const studentDeclSigObj = studentDeclVal && typeof studentDeclVal === 'object' && !Array.isArray(studentDeclVal) ? (studentDeclVal as Record<string, unknown>) : null;
                          const studentDeclSig = studentDeclSigObj ? (String(studentDeclSigObj.signature ?? studentDeclSigObj.imageDataUrl ?? '') || null) : (typeof studentDeclVal === 'string' ? studentDeclVal : null);
                          const minFirstAttempt = getResultsMinFirstAttemptDate(assessmentSummary);
                          const minSecondAttempt = getResultsMinSecondAttemptDate(rd, assessmentSummary);
                          const minThirdAttempt = getResultsMinThirdAttemptDate(rd, assessmentSummary);
                          const minTrainerDate = maxIsoDate(rd?.first_attempt_date);
                          const firstAttemptComplete =
                            rowAnswerHasContent(rd?.first_attempt_satisfactory ?? undefined) && rowAnswerHasContent(rd?.first_attempt_date ?? undefined);
                          const secondOrThirdHasData = !!(rd?.second_attempt_date || rd?.second_attempt_satisfactory || rd?.third_attempt_date || rd?.third_attempt_satisfactory);
                          const thirdAttemptHasData = !!(rd?.third_attempt_date || rd?.third_attempt_satisfactory);
                          const secondAttemptComplete =
                            rowAnswerHasContent(rd?.second_attempt_satisfactory ?? undefined) && rowAnswerHasContent(rd?.second_attempt_date ?? undefined);
                          // Match assessment summary: cycle 1 edits attempt 1 only; cycle 2+ locks attempt 1 and edits attempt 2, etc.
                          const firstAttemptEditable = trainerCanEdit && submissionCount < 2 && !secondOrThirdHasData;
                          const secondAttemptUnlockedByResubmission = submissionCount >= 2;
                          const thirdAttemptUnlockedByResubmission = submissionCount >= 3;
                          const secondAttemptEditable =
                            trainerCanEdit &&
                            firstAttemptComplete &&
                            secondAttemptUnlockedByResubmission &&
                            !thirdAttemptHasData;
                          const thirdAttemptEditable =
                            trainerCanEdit && secondAttemptComplete && thirdAttemptUnlockedByResubmission;
                          /** Footer trainer sign-off belongs to the first assessment cycle; lock when attempt 1 column is locked. */
                          const trainerFooterEditable = trainerCanEdit && firstAttemptEditable;
                          const studentSuggestionSig = studentDeclSig ?? firstTaskData?.student_signature ?? null;
                          const studentNameQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
                          const trainerNameQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.fullName');
                          const suggestedStudentName = !rd?.student_name && studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '') : null;
                          const suggestedTrainerName = !rd?.trainer_name && trainerNameQ ? String(answers[getAnswerKey(trainerNameQ.id, null)] ?? '') : null;
                          return (
                        <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                          <div className="bg-[#5E5E5E] text-white font-bold px-4 py-3">
                            {((section as { taskRow?: { row_label: string } }).taskRow?.row_label || section.title) + ' – Results Sheet'}
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-sm">
                              <tbody>
                                <tr>
                                  <td className="w-1/4 bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300 align-top" rowSpan={3}>
                                    Outcome
                                  </td>
                                  <td className="bg-white p-3 border border-gray-300 align-top">
                                    <div className="font-semibold mb-2">First attempt:</div>
                                    <div className="mb-2">Outcome (make sure to tick the correct checkbox):</div>
                                    <div className="flex gap-4 mb-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-first`}
                                          checked={rd?.first_attempt_satisfactory === 's'}
                                          onChange={() => firstAttemptEditable && handleResultsDataChange(section.id, 'first_attempt_satisfactory', 's')}
                                          disabled={!firstAttemptEditable}
                                          className="w-4 h-4"
                                        />
                                        <span>Satisfactory (S)</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-first`}
                                          checked={rd?.first_attempt_satisfactory === 'ns'}
                                          onChange={() => firstAttemptEditable && handleResultsDataChange(section.id, 'first_attempt_satisfactory', 'ns')}
                                          disabled={!firstAttemptEditable}
                                          className="w-4 h-4"
                                        />
                                        <span>Not Satisfactory (NS)</span>
                                      </label>
                                    </div>
                                    <div className="mb-2"><span className="font-medium">Date:</span>{' '}
                                      <DatePicker
                                        value={rd?.first_attempt_date ?? ''}
                                        onChange={(v) => handleResultsDataChange(section.id, 'first_attempt_date', v || null)}
                                        disabled={!firstAttemptEditable}
                                        compact
                                        placement="above"
                                        className="inline-block min-w-[120px]"
                                        minDate={minFirstAttempt}
                                      />
                                    </div>
                                    <div><span className="font-medium">Feedback:</span>
                                      <textarea
                                        value={rd?.first_attempt_feedback ?? ''}
                                        onChange={(e) => handleResultsDataChange(section.id, 'first_attempt_feedback', e.target.value || null)}
                                        disabled={!firstAttemptEditable}
                                        className="block w-full border border-gray-300 min-h-[60px] p-2 mt-1 bg-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                      />
                                    </div>
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-white p-3 border border-gray-300 align-top">
                                    <div className="font-semibold mb-2">Second attempt:</div>
                                    <div className="mb-2">Outcome (make sure to tick the correct checkbox):</div>
                                    <div className="flex gap-4 mb-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-second`}
                                          checked={rd?.second_attempt_satisfactory === 's'}
                                          onChange={() => secondAttemptEditable && handleResultsDataChange(section.id, 'second_attempt_satisfactory', 's')}
                                          disabled={!secondAttemptEditable}
                                          className="w-4 h-4"
                                        />
                                        <span>Satisfactory (S)</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-second`}
                                          checked={rd?.second_attempt_satisfactory === 'ns'}
                                          onChange={() => secondAttemptEditable && handleResultsDataChange(section.id, 'second_attempt_satisfactory', 'ns')}
                                          disabled={!secondAttemptEditable}
                                          className="w-4 h-4"
                                        />
                                        <span>Not Satisfactory (NS)</span>
                                      </label>
                                    </div>
                                    <div className="mb-2"><span className="font-medium">Date:</span>{' '}
                                      <DatePicker
                                        value={rd?.second_attempt_date ?? ''}
                                        onChange={(v) => handleResultsDataChange(section.id, 'second_attempt_date', v || null)}
                                        disabled={!secondAttemptEditable}
                                        compact
                                        placement="above"
                                        className="inline-block min-w-[120px]"
                                        minDate={minSecondAttempt || undefined}
                                      />
                                    </div>
                                    <div><span className="font-medium">Feedback:</span>
                                      <textarea
                                        value={rd?.second_attempt_feedback ?? ''}
                                        onChange={(e) => handleResultsDataChange(section.id, 'second_attempt_feedback', e.target.value || null)}
                                        disabled={!secondAttemptEditable}
                                        className="block w-full border border-gray-300 min-h-[60px] p-2 mt-1 bg-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                      />
                                    </div>
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-white p-3 border border-gray-300 align-top">
                                    <div className="font-semibold mb-2">Third attempt:</div>
                                    <div className="mb-2">Outcome (make sure to tick the correct checkbox):</div>
                                    <div className="flex gap-4 mb-2">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-third`}
                                          checked={rd?.third_attempt_satisfactory === 's'}
                                          onChange={() => thirdAttemptEditable && handleResultsDataChange(section.id, 'third_attempt_satisfactory', 's')}
                                          disabled={!thirdAttemptEditable}
                                          className="w-4 h-4"
                                        />
                                        <span>Satisfactory (S)</span>
                                      </label>
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="radio"
                                          name={`results-${section.id}-third`}
                                          checked={rd?.third_attempt_satisfactory === 'ns'}
                                          onChange={() => thirdAttemptEditable && handleResultsDataChange(section.id, 'third_attempt_satisfactory', 'ns')}
                                          disabled={!thirdAttemptEditable}
                                          className="w-4 h-4"
                                        />
                                        <span>Not Satisfactory (NS)</span>
                                      </label>
                                    </div>
                                    <div className="mb-2"><span className="font-medium">Date:</span>{' '}
                                      <DatePicker
                                        value={rd?.third_attempt_date ?? ''}
                                        onChange={(v) => handleResultsDataChange(section.id, 'third_attempt_date', v || null)}
                                        disabled={!thirdAttemptEditable}
                                        compact
                                        placement="above"
                                        className="inline-block min-w-[120px]"
                                        minDate={minThirdAttempt || undefined}
                                      />
                                    </div>
                                    <div><span className="font-medium">Feedback:</span>
                                      <textarea
                                        value={rd?.third_attempt_feedback ?? ''}
                                        onChange={(e) => handleResultsDataChange(section.id, 'third_attempt_feedback', e.target.value || null)}
                                        disabled={!thirdAttemptEditable}
                                        className="block w-full border border-gray-300 min-h-[60px] p-2 mt-1 bg-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                      />
                                    </div>
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300 align-top">
                                    Student Declaration
                                  </td>
                                  <td className="bg-white p-3 pb-2 border border-gray-300 align-top">
                                    <ul className="list-disc pl-5 space-y-1 text-sm mb-2">
                                      <li>I declare that the answers I have provided are my own work.</li>
                                      <li>I have kept a copy of all relevant notes and reference material.</li>
                                      <li>I have provided references for all sources where the information is not my own.</li>
                                      <li>For the purposes of assessment, I give the trainer/assessor permission to:
                                        <ul className="list-disc pl-5 mt-1 space-y-1">
                                          <li>i. Reproduce this assessment and provide a copy to another member of the RTO for the purposes of assessment.</li>
                                          <li>ii. Take steps to authenticate the assessment, including conducting a plagiarism check.</li>
                                        </ul>
                                      </li>
                                    </ul>
                                    <p className="mt-3 font-semibold text-sm">I understand that if I disagree with the assessment outcome, I can appeal the assessment process, and either re-submit additional evidence undertake gap training and or have my submission re-assessed.</p>
                                    <p className="font-semibold text-sm">All appeal options have been explained to me.</p>
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Student Name</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <input
                                      type="text"
                                      value={rd?.student_name ?? ''}
                                      onChange={(e) => handleResultsDataChange(section.id, 'student_name', e.target.value || null)}
                                      disabled={!studentCanEdit}
                                      placeholder="Enter student name"
                                      className={`w-full border-b border-gray-400 min-h-[18px] px-1 py-0.5 text-sm ${
                                        studentCanEdit ? 'bg-blue-50/70' : 'bg-transparent'
                                      } focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed`}
                                    />
                                    {suggestedStudentName && !rd?.student_name && studentCanEdit && (
                                      <button type="button" onClick={() => handleResultsDataChange(section.id, 'student_name', suggestedStudentName)} className="text-xs text-blue-600 hover:underline mt-0.5">Use {suggestedStudentName}</button>
                                    )}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Student Signature</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <SignatureField
                                      value={rd?.student_signature ?? null}
                                      onChange={(v) => handleResultsDataChange(section.id, 'student_signature', v)}
                                      disabled={!studentCanEdit}
                                      highlight={studentCanEdit}
                                      suggestionFrom={studentSuggestionSig}
                                      onSuggestionClick={studentSuggestionSig ? () => handleResultsDataChange(section.id, 'student_signature', studentSuggestionSig) : undefined}
                                    />
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Trainer/Assessor Name</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <input
                                      type="text"
                                      value={rd?.trainer_name ?? ''}
                                      onChange={(e) => handleResultsDataChange(section.id, 'trainer_name', e.target.value || null)}
                                      disabled={!trainerFooterEditable}
                                      placeholder="Enter trainer name"
                                      className={`w-full border-b border-gray-400 min-h-[18px] px-1 py-0.5 text-sm ${
                                        trainerFooterEditable ? 'bg-blue-50/70' : 'bg-transparent'
                                      } focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed`}
                                    />
                                    {suggestedTrainerName && !rd?.trainer_name && trainerFooterEditable && (
                                      <button type="button" onClick={() => handleResultsDataChange(section.id, 'trainer_name', suggestedTrainerName)} className="text-xs text-blue-600 hover:underline mt-0.5">Use {suggestedTrainerName}</button>
                                    )}
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Trainer/Assessor Signature</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <SignatureField
                                      value={rd?.trainer_signature ?? null}
                                      onChange={(v) => handleResultsDataChange(section.id, 'trainer_signature', v)}
                                      disabled={!trainerFooterEditable}
                                      highlight={trainerFooterEditable}
                                      suggestionFrom={trainerSuggestionSig}
                                      onSuggestionClick={
                                        trainerFooterEditable && trainerSuggestionSig
                                          ? () => {
                                              handleResultsDataChange(section.id, 'trainer_signature', trainerSuggestionSig);
                                              handleResultsDataChange(section.id, 'trainer_date', trainerSuggestionDate || null);
                                            }
                                          : undefined
                                      }
                                    />
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-gray-200 font-semibold text-gray-700 p-3 border border-gray-300">Date</td>
                                  <td className="bg-white p-3 border border-gray-300">
                                    <DatePicker
                                      value={rd?.trainer_date ?? ''}
                                      onChange={(v) => handleResultsDataChange(section.id, 'trainer_date', v || null)}
                                      disabled={!trainerFooterEditable}
                                      highlight={trainerFooterEditable}
                                      compact
                                      placement="above"
                                      className="min-w-[120px]"
                                      minDate={trainerFooterEditable ? minTrainerDate || undefined : undefined}
                                    />
                                  </td>
                                </tr>
                                <tr>
                                  <td className="bg-[#f5f0e6] font-semibold italic text-gray-700 p-3 border border-gray-300">Office Use Only</td>
                                  <td className="bg-white p-3 border border-gray-300 text-sm">
                                    The outcome of this assessment has been entered into the Student Management System on{' '}
                                    <DatePicker
                                      value={resultsOffice[section.id]?.entered_date ?? ''}
                                      onChange={(v) => handleResultsOfficeChange(section.id, 'entered_date', v || null)}
                                      disabled={role !== 'office'}
                                      compact
                                      placement="above"
                                      className="inline-block min-w-[120px]"
                                    />{' '}
                                    (insert date) by{' '}
                                    <input
                                      type="text"
                                      value={resultsOffice[section.id]?.entered_by ?? ''}
                                      onChange={(e) => handleResultsOfficeChange(section.id, 'entered_by', e.target.value || null)}
                                      disabled={role !== 'office'}
                                      placeholder="Name"
                                      className="inline-block border-b border-gray-400 min-w-[140px] px-1 py-0.5 text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                    />{' '}
                                    (insert Name)
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'assessment_summary' ? (
                        (() => {
                          const sum = assessmentSummary || ({} as import('../lib/formEngine').AssessmentSummaryDataEntry);
                          const trainerCanEdit = role === 'trainer' || role === 'office';
                          const studentCanEdit = role === 'student' || role === 'office';
                          const officeCanEdit = role === 'office';
                          const taskRowsOrdered: { id: number; row_label: string }[] = [];
                          const taskRowToSectionId = new Map<number, number>();
                          for (const step of template?.steps || []) {
                            for (const sec of step.sections) {
                              if (sec.pdf_render_mode === 'assessment_tasks') {
                                const taskQ = sec.questions.find((q) => q.type === 'grid_table' && q.rows.length > 0);
                                if (taskQ) for (const r of taskQ.rows) taskRowsOrdered.push({ id: r.id, row_label: r.row_label });
                              }
                              if (sec.pdf_render_mode === 'task_results' && (sec as { assessment_task_row_id?: number }).assessment_task_row_id) {
                                taskRowToSectionId.set((sec as { assessment_task_row_id: number }).assessment_task_row_id, sec.id);
                              }
                            }
                          }
                          const taskResultSectionIds = (template?.steps || []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                          const firstTaskSectionId = taskResultSectionIds[0];
                          const firstTaskRd = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                          const todayIso = new Date().toISOString().split('T')[0];
                          const raTrainerQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'trainer.reasonableAdjustmentSignature');
                          const raVal = raTrainerQ ? answers[getAnswerKey(raTrainerQ.id, null)] : undefined;
                          const raSigObj = raVal && typeof raVal === 'object' && !Array.isArray(raVal) ? (raVal as Record<string, unknown>) : null;
                          const raTrainerSig = raSigObj ? (String(raSigObj.signature ?? raSigObj.imageDataUrl ?? '') || null) : (typeof raVal === 'string' ? raVal : null);
                          const raTrainerDate = raSigObj ? String(raSigObj.date ?? raSigObj.signedAtDate ?? '') : '';
                          const trainerRefSig = raTrainerSig ?? firstTaskRd?.trainer_signature ?? undefined;
                          const trainerRefDate = raTrainerSig ? (raTrainerDate || firstTaskRd?.trainer_date || todayIso) : (firstTaskRd?.trainer_date || todayIso);
                          const studentDeclQForSum = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.declarationSignature');
                          const studentDeclValForSum = studentDeclQForSum ? answers[getAnswerKey(studentDeclQForSum.id, null)] : undefined;
                          const studentDeclSigObjForSum = studentDeclValForSum && typeof studentDeclValForSum === 'object' && !Array.isArray(studentDeclValForSum) ? (studentDeclValForSum as Record<string, unknown>) : null;
                          const studentDeclSigForSum = studentDeclSigObjForSum ? (String(studentDeclSigObjForSum.signature ?? studentDeclSigObjForSum.imageDataUrl ?? '') || null) : (typeof studentDeclValForSum === 'string' ? studentDeclValForSum : null);
                          const studentDeclDateForSum = studentDeclSigObjForSum ? String(studentDeclSigObjForSum.date ?? studentDeclSigObjForSum.signedAtDate ?? '') : '';
                          const studentRefSig = studentDeclSigForSum ?? firstTaskRd?.student_signature ?? undefined;
                          const studentRefDate = studentDeclSigForSum ? (studentDeclDateForSum || todayIso) : todayIso;
                          const {
                            minStudentDate1,
                            minTrainerDate1,
                            minStudentDate2,
                            minTrainerDate2,
                            minStudentDate3,
                            minTrainerDate3,
                          } = getAssessmentSummaryDateChainMins(sum);
                          const sumFirstComplete =
                            rowAnswerHasContent(firstTaskRd?.first_attempt_satisfactory ?? undefined) &&
                            rowAnswerHasContent(firstTaskRd?.first_attempt_date ?? undefined);
                          const sumSecondOrThirdHasData = !!(firstTaskRd?.second_attempt_date || firstTaskRd?.second_attempt_satisfactory || firstTaskRd?.third_attempt_date || firstTaskRd?.third_attempt_satisfactory);
                          const sumThirdHasData = !!(firstTaskRd?.third_attempt_date || firstTaskRd?.third_attempt_satisfactory);
                          const sumSecondComplete =
                            rowAnswerHasContent(firstTaskRd?.second_attempt_satisfactory ?? undefined) &&
                            rowAnswerHasContent(firstTaskRd?.second_attempt_date ?? undefined);
                          const sumFirstEditable = !sumSecondOrThirdHasData && submissionCount < 2;
                          const sumSecondEditable = sumFirstComplete && !sumThirdHasData && submissionCount >= 2;
                          const sumThirdEditable = sumSecondComplete && submissionCount >= 3;
                          const studentNameQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.fullName');
                          const studentIdQ = template?.steps?.flatMap((st) => st.sections).flatMap((s) => s.questions).find((q) => q.code === 'student.id');
                          const studentName = studentNameQ ? String(answers[getAnswerKey(studentNameQ.id, null)] ?? '') : '';
                          const studentId = studentIdQ ? String(answers[getAnswerKey(studentIdQ.id, null)] ?? '') : '';
                          const unitCode = String(template?.form?.unit_code ?? '');
                          const unitName = String(template?.form?.unit_name ?? '');
                          const unitCodeName = [unitCode, unitName].filter(Boolean).join(' ');
                          return (
                            <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                              <div className="bg-[#374151] text-white font-bold text-center px-4 py-4 text-lg">
                                ASSESSMENT SUMMARY SHEET
                              </div>
                              <div className="bg-[#6b7280] text-white text-sm px-4 py-3 space-y-1">
                                <p className="font-medium">This form is to be completed by the assessor and used as a final record of student competency.</p>
                                <p className="text-sm">All student submissions including any associated checklists (outlined below) are to be attached to this cover sheet before placing on the student&apos;s file.</p>
                                <p className="text-sm">Student results are not to be entered onto the Student Database unless all relevant paperwork is completed and attached to this form.</p>
                              </div>
                              <div className="p-4 space-y-4">
                                <table className="w-full border-collapse border border-gray-400 text-xs">
                                  <tbody>
                                    <tr><td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 w-1/4 text-xs">Student Name:</td><td className="border border-gray-400 p-1.5 text-xs">{studentName || '—'}</td></tr>
                                    <tr><td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Student ID:</td><td className="border border-gray-400 p-1.5 text-xs">{studentId || '—'}</td></tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Start date:</td>
                                      <td className="border border-gray-400 p-1.5">
                                        <DatePicker value={sum.start_date ?? ''} onChange={(v) => handleAssessmentSummaryChange('start_date', v || null)} disabled={!trainerCanEdit} compact placement="above" className="max-w-[120px]" />
                                      </td>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-right text-xs">End Date:</td>
                                      <td className="border border-gray-400 p-1.5">
                                        <DatePicker
                                          value={sum.end_date ?? ''}
                                          onChange={(v) => {
                                            const start = String(sum.start_date ?? '').trim();
                                            const next = String(v ?? '').trim();
                                            // Clamp: End Date cannot be earlier than Start Date.
                                            if (start && next && isCalendarBefore(next, start)) {
                                              handleAssessmentSummaryChange('end_date', start);
                                              return;
                                            }
                                            handleAssessmentSummaryChange('end_date', v || null);
                                          }}
                                          disabled={!trainerCanEdit}
                                          compact
                                          placement="above"
                                          className="max-w-[120px]"
                                          minDate={sum.start_date ?? undefined}
                                        />
                                      </td>
                                    </tr>
                                    <tr><td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Unit Code & Name:</td><td className="border border-gray-400 p-1.5 text-xs" colSpan={3}>{unitCodeName || '—'}</td></tr>
                                  </tbody>
                                </table>
                                <div className="bg-gray-200 font-semibold text-gray-700 px-4 py-1.5 text-xs">Please attach the following evidence to this form</div>
                                <table className="w-full border-collapse border border-gray-400 text-xs">
                                  <thead>
                                    <tr><th className="border border-gray-400 bg-gray-200 p-1.5 text-left w-1/4 text-xs"></th><th colSpan={3} className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">Result</th></tr>
                                    <tr><th className="border border-gray-400 bg-gray-200 p-1.5"></th><th className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">1st Attempt</th><th className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">2nd Attempt</th><th className="border border-gray-400 bg-[#5E5E5E] text-white font-bold p-1.5 text-center text-xs">3rd Attempt</th></tr>
                                  </thead>
                                  <tbody>
                                    {taskRowsOrdered.length === 0 ? (
                                      <tr>
                                        <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Assessment Task 1</td>
                                        <td className="border border-gray-400 p-1.5 text-center">
                                          <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">—</span><span className="text-[10px]">Date: —</span></div>
                                        </td>
                                        <td className="border border-gray-400 p-1.5 text-center">
                                          <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">—</span><span className="text-[10px]">Date: —</span></div>
                                        </td>
                                        <td className="border border-gray-400 p-1.5 text-center">
                                          <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">—</span><span className="text-[10px]">Date: —</span></div>
                                        </td>
                                      </tr>
                                    ) : (
                                      taskRowsOrdered.map((tr) => {
                                        const secId = taskRowToSectionId.get(tr.id);
                                        const rd = secId ? resultsData[secId] : null;
                                        return (
                                          <tr key={tr.id}>
                                            <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">{tr.row_label}</td>
                                            <td className="border border-gray-400 p-1.5 text-center">
                                              <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">{rd?.first_attempt_satisfactory === 's' ? '✓ Satisfactory' : rd?.first_attempt_satisfactory === 'ns' ? '✓ Not Satisfactory' : '—'}</span><span className="text-[10px]">Date: {rd?.first_attempt_date ?? '—'}</span></div>
                                            </td>
                                            <td className="border border-gray-400 p-1.5 text-center">
                                              <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">{rd?.second_attempt_satisfactory === 's' ? '✓ Satisfactory' : rd?.second_attempt_satisfactory === 'ns' ? '✓ Not Satisfactory' : '—'}</span><span className="text-[10px]">Date: {rd?.second_attempt_date ?? '—'}</span></div>
                                            </td>
                                            <td className="border border-gray-400 p-1.5 text-center">
                                              <div className="flex flex-col gap-0.5 items-center"><span className="text-[10px]">{rd?.third_attempt_satisfactory === 's' ? '✓ Satisfactory' : rd?.third_attempt_satisfactory === 'ns' ? '✓ Not Satisfactory' : '—'}</span><span className="text-[10px]">Date: {rd?.third_attempt_date ?? '—'}</span></div>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    )}
                                    <tr className="border-t-2 border-gray-500">
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Final Assessment result for this unit</td>
                                      <td className="border border-gray-400 p-1.5">
                                        <div className="flex flex-col gap-0.5">
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-1" checked={sum.final_attempt_1_result === 'competent'} onChange={() => trainerCanEdit && sumFirstEditable && handleAssessmentSummaryChange('final_attempt_1_result', 'competent')} disabled={!trainerCanEdit || !sumFirstEditable} className="w-3.5 h-3.5" /> Competent</label>
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-1" checked={sum.final_attempt_1_result === 'not_yet_competent'} onChange={() => trainerCanEdit && sumFirstEditable && handleAssessmentSummaryChange('final_attempt_1_result', 'not_yet_competent')} disabled={!trainerCanEdit || !sumFirstEditable} className="w-3.5 h-3.5" /> Not Yet Competent</label>
                                        </div>
                                      </td>
                                      <td className="border border-gray-400 p-1.5">
                                        <div className="flex flex-col gap-0.5">
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-2" checked={sum.final_attempt_2_result === 'competent'} onChange={() => trainerCanEdit && sumSecondEditable && handleAssessmentSummaryChange('final_attempt_2_result', 'competent')} disabled={!trainerCanEdit || !sumSecondEditable} className="w-3.5 h-3.5" /> Competent</label>
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-2" checked={sum.final_attempt_2_result === 'not_yet_competent'} onChange={() => trainerCanEdit && sumSecondEditable && handleAssessmentSummaryChange('final_attempt_2_result', 'not_yet_competent')} disabled={!trainerCanEdit || !sumSecondEditable} className="w-3.5 h-3.5" /> Not Yet Competent</label>
                                        </div>
                                      </td>
                                      <td className="border border-gray-400 p-1.5">
                                        <div className="flex flex-col gap-0.5">
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-3" checked={sum.final_attempt_3_result === 'competent'} onChange={() => trainerCanEdit && sumThirdEditable && handleAssessmentSummaryChange('final_attempt_3_result', 'competent')} disabled={!trainerCanEdit || !sumThirdEditable} className="w-3.5 h-3.5" /> Competent</label>
                                          <label className="flex items-center gap-1.5 cursor-pointer text-[10px]"><input type="radio" name="final-3" checked={sum.final_attempt_3_result === 'not_yet_competent'} onChange={() => trainerCanEdit && sumThirdEditable && handleAssessmentSummaryChange('final_attempt_3_result', 'not_yet_competent')} disabled={!trainerCanEdit || !sumThirdEditable} className="w-3.5 h-3.5" /> Not Yet Competent</label>
                                        </div>
                                      </td>
                                    </tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Trainer/Assessor Signature</td>
                                      <td colSpan={3} className="border border-gray-400 p-1.5">
                                        <p className="text-[10px] text-gray-600 mb-1.5">I declare that I have conducted a fair, valid, reliable, and flexible assessment with this student, and I have provided appropriate feedback</p>
                                        <div className="grid grid-cols-3 gap-4">
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.trainer_sig_1 ?? null} onChange={(v) => { handleAssessmentSummaryChange('trainer_sig_1', v); const cur = String(sum.trainer_date_1 ?? '').trim(); if (!cur || (minTrainerDate1 && isCalendarBefore(cur, minTrainerDate1))) handleAssessmentSummaryChange('trainer_date_1', minTrainerDate1 ?? null); }} disabled={!trainerCanEdit || !sumFirstEditable} className="mt-0.5" highlight={role === 'trainer' && sumFirstEditable} suggestionFrom={trainerRefSig} onSuggestionClick={trainerRefSig ? () => { handleAssessmentSummaryChange('trainer_sig_1', trainerRefSig); const next = maxIsoDate(trainerRefDate, minTrainerDate1) ?? minTrainerDate1 ?? trainerRefDate; handleAssessmentSummaryChange('trainer_date_1', next || null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.trainer_sig_2 ?? null} onChange={(v) => { handleAssessmentSummaryChange('trainer_sig_2', v); const cur = String(sum.trainer_date_2 ?? '').trim(); if (!cur || (minTrainerDate2 && isCalendarBefore(cur, minTrainerDate2))) handleAssessmentSummaryChange('trainer_date_2', minTrainerDate2 ?? null); }} disabled={!trainerCanEdit || !sumSecondEditable} className="mt-0.5" highlight={role === 'trainer' && sumSecondEditable} suggestionFrom={sumSecondEditable ? (sum.trainer_sig_1 ?? undefined) : undefined} onSuggestionClick={sumSecondEditable && sum.trainer_sig_1 ? () => { handleAssessmentSummaryChange('trainer_sig_2', sum.trainer_sig_1); const next = maxIsoDate(sum.trainer_date_1, sum.student_date_2, minTrainerDate2) ?? minTrainerDate2 ?? sum.trainer_date_1 ?? sum.student_date_2; handleAssessmentSummaryChange('trainer_date_2', next || null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.trainer_sig_3 ?? null} onChange={(v) => { handleAssessmentSummaryChange('trainer_sig_3', v); const cur = String(sum.trainer_date_3 ?? '').trim(); if (!cur || (minTrainerDate3 && isCalendarBefore(cur, minTrainerDate3))) handleAssessmentSummaryChange('trainer_date_3', minTrainerDate3 ?? null); }} disabled={!trainerCanEdit || !sumThirdEditable} className="mt-0.5" highlight={role === 'trainer' && sumThirdEditable} suggestionFrom={sumThirdEditable ? (sum.trainer_sig_1 ?? undefined) : undefined} onSuggestionClick={sumThirdEditable && sum.trainer_sig_1 ? () => { handleAssessmentSummaryChange('trainer_sig_3', sum.trainer_sig_1); const next = maxIsoDate(sum.trainer_date_2, sum.student_date_3, minTrainerDate3) ?? minTrainerDate3 ?? sum.trainer_date_2 ?? sum.student_date_3; handleAssessmentSummaryChange('trainer_date_3', next || null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.trainer_date_1 ?? ''} onChange={(v) => handleAssessmentSummaryChange('trainer_date_1', clampIsoToMin(v || null, minTrainerDate1))} disabled={!trainerCanEdit || !sumFirstEditable} highlight={role === 'trainer' && sumFirstEditable} compact placement="above" className="w-full" minDate={minTrainerDate1} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.trainer_date_2 ?? ''} onChange={(v) => handleAssessmentSummaryChange('trainer_date_2', clampIsoToMin(v || null, minTrainerDate2))} disabled={!trainerCanEdit || !sumSecondEditable} highlight={role === 'trainer' && sumSecondEditable} compact placement="above" className="w-full" minDate={minTrainerDate2} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.trainer_date_3 ?? ''} onChange={(v) => handleAssessmentSummaryChange('trainer_date_3', clampIsoToMin(v || null, minTrainerDate3))} disabled={!trainerCanEdit || !sumThirdEditable} highlight={role === 'trainer' && sumThirdEditable} compact placement="above" className="w-full" minDate={minTrainerDate3} /></div>
                                        </div>
                                      </td>
                                    </tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Student:</td>
                                      <td colSpan={3} className="border border-gray-400 p-1.5">
                                        <p className="text-[10px] text-gray-600 mb-1.5">I declare that I have been assessed in this unit, and I have been advised of my result. I also am aware of my appeal rights.</p>
                                        <div className="grid grid-cols-3 gap-4">
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.student_sig_1 ?? null} onChange={(v) => { handleAssessmentSummaryChange('student_sig_1', v); const cur = String(sum.student_date_1 ?? '').trim(); if (!cur || (minStudentDate1 && isCalendarBefore(cur, minStudentDate1))) handleAssessmentSummaryChange('student_date_1', minStudentDate1 ?? null); }} disabled={!studentCanEdit || !sumFirstEditable} className="mt-0.5" highlight={role === 'student' && sumFirstEditable} suggestionFrom={studentRefSig} onSuggestionClick={studentRefSig ? () => { handleAssessmentSummaryChange('student_sig_1', studentRefSig); const next = maxIsoDate(studentRefDate, minStudentDate1) ?? minStudentDate1 ?? studentRefDate; handleAssessmentSummaryChange('student_date_1', next || null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.student_sig_2 ?? null} onChange={(v) => { handleAssessmentSummaryChange('student_sig_2', v); const cur = String(sum.student_date_2 ?? '').trim(); if (!cur || (minStudentDate2 && isCalendarBefore(cur, minStudentDate2))) handleAssessmentSummaryChange('student_date_2', minStudentDate2 ?? null); }} disabled={!studentCanEdit || !sumSecondEditable} className="mt-0.5" highlight={role === 'student' && sumSecondEditable} suggestionFrom={sumSecondEditable ? (sum.student_sig_1 ?? undefined) : undefined} onSuggestionClick={sumSecondEditable && sum.student_sig_1 ? () => { handleAssessmentSummaryChange('student_sig_2', sum.student_sig_1); const next = maxIsoDate(sum.student_date_1, minStudentDate2) ?? minStudentDate2 ?? sum.student_date_1; handleAssessmentSummaryChange('student_date_2', next || null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Signature:</span> <SignatureField value={sum.student_sig_3 ?? null} onChange={(v) => { handleAssessmentSummaryChange('student_sig_3', v); const cur = String(sum.student_date_3 ?? '').trim(); if (!cur || (minStudentDate3 && isCalendarBefore(cur, minStudentDate3))) handleAssessmentSummaryChange('student_date_3', minStudentDate3 ?? null); }} disabled={!studentCanEdit || !sumThirdEditable} className="mt-0.5" highlight={role === 'student' && sumThirdEditable} suggestionFrom={sumThirdEditable ? (sum.student_sig_1 ?? undefined) : undefined} onSuggestionClick={sumThirdEditable && sum.student_sig_1 ? () => { handleAssessmentSummaryChange('student_sig_3', sum.student_sig_1); const next = maxIsoDate(sum.student_date_2, minStudentDate3) ?? minStudentDate3 ?? sum.student_date_2; handleAssessmentSummaryChange('student_date_3', next || null); } : undefined} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.student_date_1 ?? ''} onChange={(v) => handleAssessmentSummaryChange('student_date_1', clampIsoToMin(v || null, minStudentDate1))} disabled={!studentCanEdit || !sumFirstEditable} highlight={role === 'student' && sumFirstEditable} compact placement="above" className="w-full" minDate={minStudentDate1} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.student_date_2 ?? ''} onChange={(v) => handleAssessmentSummaryChange('student_date_2', clampIsoToMin(v || null, minStudentDate2))} disabled={!studentCanEdit || !sumSecondEditable} highlight={role === 'student' && sumSecondEditable} compact placement="above" className="w-full" minDate={minStudentDate2} /></div>
                                          <div><span className="text-xs font-medium">Date:</span> <DatePicker value={sum.student_date_3 ?? ''} onChange={(v) => handleAssessmentSummaryChange('student_date_3', clampIsoToMin(v || null, minStudentDate3))} disabled={!studentCanEdit || !sumThirdEditable} highlight={role === 'student' && sumThirdEditable} compact placement="above" className="w-full" minDate={minStudentDate3} /></div>
                                        </div>
                                      </td>
                                    </tr>
                                    <tr>
                                      <td className="border border-gray-400 bg-gray-100 font-semibold p-1.5 text-xs">Student overall Feedback:</td>
                                      <td colSpan={3} className="border border-gray-400 p-1.5">
                                        <textarea
                                          value={sum.student_overall_feedback ?? ''}
                                          onChange={(e) => handleAssessmentSummaryChange('student_overall_feedback', e.target.value || null)}
                                          disabled={!trainerCanEdit}
                                          className={`w-full border border-gray-400 min-h-[60px] p-1.5 text-xs ${
                                            role === 'student' ? 'bg-blue-50/70' : ''
                                          }`}
                                        />
                                      </td>
                                    </tr>
                                    <tr>
                                      <td colSpan={2} className="border border-gray-400 bg-[#f5f0e6] font-semibold italic p-1.5 text-xs">Administrative use only - Entered onto Student Management Database</td>
                                      <td className="border border-gray-400 bg-[#f5f0e6] font-semibold italic p-1.5 text-xs">Initials</td>
                                      <td className="border border-gray-400 bg-[#f5f0e6] p-1.5">
                                        <input type="text" value={sum.admin_initials ?? ''} onChange={(e) => handleAssessmentSummaryChange('admin_initials', e.target.value || null)} disabled={!officeCanEdit} className="border-0 border-b border-gray-400 px-1 py-0.5 text-xs w-full max-w-[60px] bg-transparent disabled:bg-gray-100" />
                                      </td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })()
                      ) : section.pdf_render_mode === 'likert_table' ? (
                        <>
                          <SectionLikertTable
                            section={section}
                            getAnswer={(qId, rId) => {
                              const v = answers[getAnswerKey(qId, rId)];
                              return v != null ? String(v) : null;
                            }}
                            onChange={(qId, rId, val) => handleAnswerChange(qId, rId, val)}
                            disabled={!section.questions.some((q) =>
                              isRoleEditable((q.role_editability as Record<string, boolean>) || {}, role)
                            )}
                          />
                          {section.questions
                            .filter((q) => q.type !== 'likert_5' && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                            .map((q) => {
                              const re = (q.role_editability as Record<string, boolean>) || {};
                              const editable = isRoleEditable(re, role) && canRoleEditCurrentWorkflow;
                              const key = getAnswerKey(q.id, null);
                              const val = answers[key];
                              if (q.type === 'signature' && (q.code === 'student.declarationSignature' || String(q.code || '').startsWith('student.'))) {
                                const taskResultSectionIds = (template?.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                                const firstTaskSectionId = taskResultSectionIds[0];
                                const firstTaskRdForDecl = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                                const studentSigSuggestion = firstTaskRdForDecl?.student_signature ?? null;
                                const sigVal = val;
                                const sigObj = sigVal && typeof sigVal === 'object' && !Array.isArray(sigVal) ? (sigVal as Record<string, unknown>) : null;
                                const imgVal = sigObj?.signature ?? sigObj?.imageDataUrl ?? (typeof sigVal === 'string' ? sigVal : null);
                                const dateVal = sigObj ? String(sigObj.date ?? sigObj.signedAtDate ?? '') : '';
                                const todayIsoDecl = new Date().toISOString().split('T')[0];
                                const hasDateField = (q.pdf_meta as { showDateField?: boolean } | undefined)?.showDateField;
                                const minDeclDate = getStudentResubDeclarationMinDate(firstTaskRdForDecl, submissionCount);
                                // Declaration must only ever be set on the first attempt cycle.
                                // After attempt 1 is completed / resubmission begins, keep it read-only (historical).
                                const declarationLockedToFirstAttempt = q.code === 'student.declarationSignature' && submissionCount >= 2;
                                const effectiveEditable = editable && !declarationLockedToFirstAttempt;
                                return (
                                  <div key={q.id} className="space-y-2">
                                    <div className="text-sm font-semibold text-gray-700">{q.label}{q.required ? ' *' : ''}</div>
                                    <div className="flex items-center gap-4 flex-wrap">
                                      <div className="flex-1 min-w-[200px]">
                                        <SignatureField
                                          value={(imgVal as string | null) ?? null}
                                          onChange={(v) => {
                                            const img = typeof v === 'string' ? v : null;
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            const merged = img != null ? { ...base, signature: img } : { ...base, signature: null };
                                            handleAnswerChange(q.id, null, merged as string | number | boolean | Record<string, unknown> | string[]);
                                          }}
                                          disabled={!effectiveEditable}
                                          highlight={(role === 'student' || role === 'trainer') && editable}
                                          suggestionFrom={studentSigSuggestion}
                                          onSuggestionClick={studentSigSuggestion && effectiveEditable ? () => {
                                            const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                            const nextDate = minDeclDate && isCalendarBefore(todayIsoDecl, minDeclDate) ? minDeclDate : todayIsoDecl;
                                            handleAnswerChange(q.id, null, { ...base, signature: studentSigSuggestion, date: nextDate } as string | number | boolean | Record<string, unknown> | string[], true);
                                          } : undefined}
                                        />
                                      </div>
                                      {hasDateField && (
                                        <div className="flex items-center gap-2 min-w-[140px]">
                                          <span className="text-sm font-semibold text-gray-700 shrink-0">Date:</span>
                                          <DatePicker
                                            value={dateVal}
                                            onChange={(newDate) => {
                                              const base = sigObj || (typeof sigVal === 'string' ? { signature: sigVal } : {});
                                              const nextDate = minDeclDate && newDate && isCalendarBefore(newDate, minDeclDate) ? minDeclDate : newDate;
                                              handleAnswerChange(q.id, null, { ...base, date: nextDate } as string | number | boolean | Record<string, unknown> | string[]);
                                            }}
                                            disabled={!effectiveEditable}
                                            highlight={(role === 'student' || role === 'trainer') && editable}
                                            compact
                                            placement="above"
                                            className="flex-1 min-w-0"
                                            minDate={minDeclDate}
                                          />
                                        </div>
                                      )}
                                    </div>
                                    {errors[`q-${q.id}`] && <p className="text-sm text-red-600">{errors[`q-${q.id}`]}</p>}
                                  </div>
                                );
                              }
                              return (
                                <QuestionRenderer
                                  key={q.id}
                                  question={q}
                                  value={(val as string | number | boolean | Record<string, unknown> | string[]) ?? null}
                                  onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean | Record<string, unknown> | string[])}
                                  disabled={!editable}
                                  error={errors[`q-${q.id}`]}
                                  declarationStyle={section.pdf_render_mode === 'declarations'}
                                  highlightAsFill={editable}
                                />
                              );
                            })}
                        </>
                      ) : (
                        section.questions
                        .filter((q) => q.type !== 'instruction_block' && isRoleVisible((q.role_visibility as Record<string, boolean>) || {}, role))
                        .map((q) => {
                          const taskResultSectionIdsForEval = (template?.steps ?? [])
                            .flatMap((st) => st.sections)
                            .filter((s) => s.pdf_render_mode === 'task_results')
                            .map((s) => s.id);
                          const firstTaskRdForEvalDate = taskResultSectionIdsForEval[0]
                            ? resultsData[taskResultSectionIdsForEval[0]]
                            : null;
                          const minEvaluationDateIso =
                            firstTaskRdForEvalDate?.first_attempt_date != null &&
                            String(firstTaskRdForEvalDate.first_attempt_date).trim()
                              ? normalizeCalendarDateToIso(String(firstTaskRdForEvalDate.first_attempt_date)) ?? undefined
                              : undefined;
                          const re = (q.role_editability as Record<string, boolean>) || {};
                          const isQualUnitField = q.code === 'qualification.code' || q.code === 'qualification.name' || q.code === 'unit.code' || q.code === 'unit.name';
                          const isEvalUnitName = q.code === 'evaluation.unitName';
                          const isEvalTrainerName = q.code === 'evaluation.trainerName';
                          const isEvalEmployer = q.code === 'evaluation.employer';
                          const isEvalTrainingDates = q.code === 'evaluation.trainingDates';
                          const isEvalEvaluationDate = q.code === 'evaluation.evaluationDate';
                          const trainerCanEditHere = role === 'trainer' || role === 'office';
                          const editable = isQualUnitField || isEvalUnitName
                            ? false
                            : isEvalTrainerName || isEvalEmployer || isEvalTrainingDates || isEvalEvaluationDate
                              ? (trainerCanEditHere && canRoleEditCurrentWorkflow)
                              : (isRoleEditable(re, role) && canRoleEditCurrentWorkflow);
                          if (q.type === 'likert_5' && q.rows.length > 0) {
                            const val =
                              q.rows.length === 1
                                ? (answers[getAnswerKey(q.id, q.rows[0].id)] as string) ?? null
                                : (() => {
                                    const m: Record<string, string> = {};
                                    for (const r of q.rows) {
                                      const v = answers[getAnswerKey(q.id, r.id)];
                                      if (v != null) m[`row-${r.id}`] = String(v);
                                    }
                                    return Object.keys(m).length ? m : null;
                                  })();
                            const onLikertChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                              if (q.rows.length === 1) {
                                handleAnswerChange(q.id, q.rows[0].id, typeof v === 'string' ? v : String(v));
                              } else {
                                const o = v as Record<string, string>;
                                if (o && typeof o === 'object') {
                                  for (const r of q.rows) {
                                    const rv = o[`row-${r.id}`];
                                    if (rv != null) handleAnswerChange(q.id, r.id, rv);
                                  }
                                }
                              }
                            };
                            return (
                              <QuestionRenderer
                                key={q.id}
                                question={q}
                                value={val}
                                onChange={onLikertChange}
                                disabled={!editable}
                                error={errors[`q-${q.id}`]}
                                highlightAsFill={editable}
                              />
                            );
                          }
                          if (q.type === 'grid_table' && q.rows.length > 0) {
                            const merged: Record<string, string> = {};
                            for (const r of q.rows) {
                              const v = answers[getAnswerKey(q.id, r.id)];
                              if (v && typeof v === 'object') Object.assign(merged, v as Record<string, string>);
                            }
                            const onGridChange = (v: string | number | boolean | Record<string, unknown> | string[]) => {
                              const byRow = new Map<number, Record<string, string>>();
                              const o = v as Record<string, string>;
                              if (!o || typeof o !== 'object') return;
                              for (const [k, val] of Object.entries(o)) {
                                const match = /^r(\d+)_c/.exec(k);
                                if (match) {
                                  const rowId = Number(match[1]);
                                  if (!byRow.has(rowId)) byRow.set(rowId, {});
                                  byRow.get(rowId)![k] = String(val);
                                }
                              }
                              for (const [rowId, rowData] of byRow.entries()) {
                                handleAnswerChange(q.id, rowId, rowData);
                              }
                            };
                            return (
                              <QuestionRenderer
                                key={q.id}
                                question={q}
                                value={Object.keys(merged).length ? merged : null}
                                onChange={onGridChange}
                                disabled={!editable}
                                error={errors[`q-${q.id}`]}
                                highlightAsFill={editable}
                              />
                            );
                          }
                          const key = getAnswerKey(q.id, null);
                          let val = answers[key];
                          if (q.type === 'signature' && (q.code === 'student.declarationSignature' || String(q.code || '').startsWith('student.'))) {
                            const taskResultSectionIds = (template?.steps ?? []).flatMap((st) => st.sections).filter((s) => s.pdf_render_mode === 'task_results').map((s) => s.id);
                            const firstTaskSectionId = taskResultSectionIds[0];
                            const firstTaskRdForDecl = firstTaskSectionId ? resultsData[firstTaskSectionId] : null;
                            const studentSigSuggestion = firstTaskRdForDecl?.student_signature ?? null;
                            const sigVal = val;
                            const sigObj = sigVal && typeof sigVal === 'object' && !Array.isArray(sigVal) ? (sigVal as Record<string, unknown>) : null;
                            const imgVal = sigObj?.signature ?? sigObj?.imageDataUrl ?? (typeof sigVal === 'string' ? sigVal : null);
                            const dateVal = sigObj ? String(sigObj.date ?? sigObj.signedAtDate ?? '') : '';
                            const todayIsoDecl = new Date().toISOString().split('T')[0];
                            const hasDateField = (q.pdf_meta as { showDateField?: boolean } | undefined)?.showDateField;
                            const minDeclDate = getStudentResubDeclarationMinDate(firstTaskRdForDecl, submissionCount);
                            // Declaration must only ever be set on the first attempt cycle.
                            // After attempt 1 is completed / resubmission begins, keep it read-only (historical).
                            const declarationLockedToFirstAttempt = q.code === 'student.declarationSignature' && submissionCount >= 2;
                            const effectiveEditable = editable && !declarationLockedToFirstAttempt;
                            return (
                              <div key={q.id} className="space-y-2">
                                <div className="text-sm font-semibold text-gray-700">{q.label}{q.required ? ' *' : ''}</div>
                                <div className="flex items-center gap-4 flex-wrap">
                                  <div className="flex-1 min-w-[200px]">
                                    <SignatureField
                                      value={(imgVal as string | null) ?? null}
                                      onChange={(v) => {
                                        const img = typeof v === 'string' ? v : null;
                                        const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                        const merged = img != null ? { ...base, signature: img } : { ...base, signature: null };
                                        handleAnswerChange(q.id, null, merged as string | number | boolean | Record<string, unknown> | string[]);
                                      }}
                                      disabled={!effectiveEditable}
                                      suggestionFrom={studentSigSuggestion}
                                      onSuggestionClick={studentSigSuggestion && effectiveEditable ? () => {
                                        const base = (sigObj && typeof sigObj === 'object' ? { ...sigObj } : {}) as Record<string, unknown>;
                                        const nextDate = minDeclDate && isCalendarBefore(todayIsoDecl, minDeclDate) ? minDeclDate : todayIsoDecl;
                                        handleAnswerChange(q.id, null, { ...base, signature: studentSigSuggestion, date: nextDate } as string | number | boolean | Record<string, unknown> | string[], true);
                                      } : undefined}
                                    />
                                  </div>
                                  {hasDateField && (
                                    <div className="flex items-center gap-2 min-w-[140px]">
                                      <span className="text-sm font-semibold text-gray-700 shrink-0">Date:</span>
                                      <DatePicker
                                        value={dateVal}
                                        onChange={(newDate) => {
                                          const base = sigObj || (typeof sigVal === 'string' ? { signature: sigVal } : {});
                                          const nextDate = minDeclDate && newDate && isCalendarBefore(newDate, minDeclDate) ? minDeclDate : newDate;
                                          handleAnswerChange(q.id, null, { ...base, date: nextDate } as string | number | boolean | Record<string, unknown> | string[]);
                                        }}
                                        disabled={!effectiveEditable}
                                        compact
                                        placement="above"
                                        className="flex-1 min-w-0"
                                        minDate={minDeclDate}
                                      />
                                    </div>
                                  )}
                                </div>
                                {errors[`q-${q.id}`] && <p className="text-sm text-red-600">{errors[`q-${q.id}`]}</p>}
                              </div>
                            );
                          }
                          const formExt = template?.form as { qualification_code?: string | null; qualification_name?: string | null; unit_code?: string | null; unit_name?: string | null } | undefined;
                          if ((isQualUnitField || isEvalUnitName) && (val == null || val === '') && formExt) {
                            const fallback =
                              q.code === 'qualification.code' ? formExt.qualification_code
                              : q.code === 'qualification.name' ? formExt.qualification_name
                              : q.code === 'unit.code' ? formExt.unit_code
                              : q.code === 'unit.name' ? formExt.unit_name
                              : q.code === 'evaluation.unitName' ? [formExt.unit_code, formExt.unit_name].filter(Boolean).join(' ').trim() || null
                              : null;
                            val = fallback ?? '';
                          }
                          return (
                            <QuestionRenderer
                              key={q.id}
                              question={q}
                              value={(val as string | number | boolean | Record<string, unknown> | string[]) ?? null}
                              onChange={(v) => handleAnswerChange(q.id, null, v as string | number | boolean | Record<string, unknown> | string[])}
                              disabled={!editable}
                              error={errors[`q-${q.id}`]}
                              declarationStyle={section.pdf_render_mode === 'declarations'}
                              highlightAsFill={editable}
                              minDate={q.code === 'evaluation.evaluationDate' ? minEvaluationDateIso : undefined}
                            />
                          );
                        })
                      )}
                    </div>
                  </div>
                ))}
              </Card>
            );
          })()
            ) : null}

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setErrors({});
                  setCurrentStep((s) => Math.max(1, s - 1));
                }}
                disabled={currentStep <= 1}
              >
                Back
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (validateStep(currentStep)) {
                    setErrors({});
                    setCurrentStep((s) => Math.min(steps.length, s + 1));
                    formScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                disabled={currentStep >= steps.length}
              >
                Next
              </Button>
              {currentStep >= steps.length && role === 'student' && workflowStatus === 'draft' && (
                <Button variant="primary" onClick={handleFinalSubmitByRole} disabled={workflowSubmitting}>
                  Final Submit
                </Button>
              )}
              {currentStep >= steps.length && role === 'trainer' && workflowStatus === 'waiting_trainer' && (
                <Button variant="primary" onClick={handleFinalSubmitByRole} disabled={workflowSubmitting}>
                  Trainer Checked (Submit)
                </Button>
              )}
              {currentStep >= steps.length && role === 'office' && workflowStatus === 'waiting_office' && (
                <Button variant="primary" onClick={handleFinalSubmitByRole} disabled={workflowSubmitting}>
                  Office Checked
                </Button>
              )}
            </div>
          </form>

          {canViewPdfPreview && (
            <div className="lg:col-span-3">
              <div className="lg:sticky lg:top-3">
                <Card>
                  <h3 className="font-bold text-[var(--text)] mb-4">PDF Preview</h3>
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        window.open(`${PDF_BASE}/pdf/${id}?role=${role}&t=${pdfCacheBust}#toolbar=0`, '_blank', 'width=800,height=600');
                      }}
                    >
                      Preview PDF
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => {
                        setPdfLoading(true);
                        setPdfRefresh((r) => r + 1);
                      }}
                    >
                      Refresh PDF
                    </Button>
                    <a
                      href={`${PDF_BASE}/pdf/${id}?role=${role}&download=1&t=${pdfCacheBust}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <Button variant="outline" size="sm" className="w-full">
                        Download PDF
                      </Button>
                    </a>
                  </div>
                  <div className="mt-4 relative min-h-96 bg-gray-50 border border-[var(--border)] rounded-lg overflow-hidden">
                    {pdfLoading && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/90 z-10">
                        <Loader variant="spinner" size="lg" />
                        <p className="text-sm font-medium text-gray-600 animate-pulse">Loading PDF...</p>
                      </div>
                    )}
                    <iframe
                      key={pdfCacheBust}
                      src={`${PDF_BASE}/pdf/${id}?role=${role}&t=${pdfCacheBust}#toolbar=0`}
                      title="PDF Preview"
                      className="w-full h-96 border-0 rounded-lg"
                      onLoad={() => setPdfLoading(false)}
                    />
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog
        isOpen={!!confirmConfig}
        onClose={() => setConfirmConfig(null)}
        onConfirm={runFinalSubmitByRole}
        title={confirmConfig?.title || 'Confirm'}
        message={confirmConfig?.message || ''}
        confirmLabel={confirmConfig?.confirmLabel || 'Confirm'}
        cancelLabel="Cancel"
        variant="default"
      />
    </div>
  );
};
