import type { FormTemplate, FormStepWithSections, ResultsDataEntry } from '../lib/formEngine';

const TASK_SECTION_MODES = new Set([
  'task_instructions',
  'task_questions',
  'task_written_evidence_checklist',
  'task_marking_checklist',
  'task_results',
]);

function stepHasAssessmentSummary(step: FormStepWithSections): boolean {
  if (/Assessment Summary/i.test(String(step.title ?? '').trim())) return true;
  return step.sections.some(
    (s) =>
      s.pdf_render_mode === 'assessment_summary' ||
      /Assessment Summary Sheet/i.test(String(s.title ?? '').trim())
  );
}

/** Index of the Assessment Summary step in template order, or null if not found. */
export function getAssessmentSummaryStepIndex(template: FormTemplate | null): number | null {
  if (!template?.steps?.length) return null;
  const idx = template.steps.findIndex(stepHasAssessmentSummary);
  return idx >= 0 ? idx : null;
}

export function getStepIndexForSection(template: FormTemplate | null, sectionId: number): number {
  if (!template?.steps) return -1;
  for (let i = 0; i < template.steps.length; i++) {
    if (template.steps[i].sections.some((s) => s.id === sectionId)) return i;
  }
  return -1;
}

export function isPreAssessmentSummaryStepIndex(template: FormTemplate | null, stepIndex: number): boolean {
  const summaryIdx = getAssessmentSummaryStepIndex(template);
  if (summaryIdx == null) return true;
  return stepIndex >= 0 && stepIndex < summaryIdx;
}

export function isPreSummarySection(template: FormTemplate | null, sectionId: number): boolean {
  const stepIdx = getStepIndexForSection(template, sectionId);
  if (stepIdx < 0) return false;
  return isPreAssessmentSummaryStepIndex(template, stepIdx);
}

/**
 * Post-summary duplicate task steps (paragraph-only) must not block trainer/student workflow.
 */
export function isPostSummaryAssessmentTaskStep(template: FormTemplate | null, stepId: number): boolean {
  const summaryIdx = getAssessmentSummaryStepIndex(template);
  if (summaryIdx == null || !template?.steps) return false;
  const stepIdx = template.steps.findIndex((s) => s.id === stepId);
  if (stepIdx < 0 || stepIdx <= summaryIdx) return false;
  const step = template.steps[stepIdx];
  return step.sections.some((s) => TASK_SECTION_MODES.has(String(s.pdf_render_mode ?? '')));
}

export function getFirstPreSummaryTaskResultSectionId(
  template: FormTemplate | null,
  resultsData?: Record<number, ResultsDataEntry>
): number | null {
  const entries = buildTaskResultSections(template, resultsData);
  return entries[0]?.sectionId ?? null;
}

export type AttemptOutcome = 'competent' | 'not_yet_competent' | null;
export type TaskAttemptSat = 's' | 'ns' | null;
export type TaskResultCheckStatus = 'satisfactory' | 'not_satisfactory' | 'unmarked';

export type TaskResultCheck = {
  sectionId: number;
  label: string;
  status: TaskResultCheckStatus;
  detail: string;
};

function answerKey(questionId: number, rowId: number | null): string {
  return rowId != null ? `q-${questionId}-${rowId}` : `q-${questionId}`;
}

function isAssessableQuestion(q: { type: string; pdf_meta?: unknown }): boolean {
  if (q.type === 'instruction_block' || q.type === 'page_break') return false;
  const pm = (q.pdf_meta as Record<string, unknown>) || {};
  if (pm.isAdditionalBlockOf) return false;
  return true;
}

export function buildTaskRowLabels(template: FormTemplate | null): Map<number, string> {
  const map = new Map<number, string>();
  if (!template) return map;
  template.steps?.forEach((step, stepIndex) => {
    if (!isPreAssessmentSummaryStepIndex(template, stepIndex)) return;
    for (const sec of step.sections) {
      if (sec.pdf_render_mode !== 'assessment_tasks') continue;
      const taskQ = sec.questions.find((q) => q.type === 'grid_table' && q.rows.length > 0);
      if (!taskQ) continue;
      for (const r of taskQ.rows) map.set(r.id, r.row_label);
    }
  });
  return map;
}

export type TaskResultSectionEntry = {
  sectionId: number | null;
  label: string;
  taskRowId: number | null;
};

function sectionResultsScore(rd: ResultsDataEntry | undefined): number {
  if (!rd) return 0;
  let score = 0;
  if (rd.first_attempt_satisfactory) score += 4;
  if (rd.first_attempt_date) score += 2;
  if (rd.second_attempt_satisfactory) score += 4;
  if (rd.second_attempt_date) score += 2;
  if (rd.third_attempt_satisfactory) score += 4;
  if (rd.third_attempt_date) score += 2;
  if (rd.trainer_signature) score += 1;
  if (rd.student_signature) score += 1;
  return score;
}

function mergeResultsData(
  a: ResultsDataEntry | undefined,
  b: ResultsDataEntry | undefined
): ResultsDataEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    ...a,
    ...Object.fromEntries(
      Object.entries(b).filter(([, v]) => v != null && String(v).trim() !== '')
    ),
  } as ResultsDataEntry;
}

/** Merge results across duplicate task_results sections for the same assessment task row. */
export function getMergedResultsForTaskRow(
  template: FormTemplate | null,
  taskRowId: number | null,
  resultsData: Record<number, ResultsDataEntry>
): ResultsDataEntry | undefined {
  if (!template || taskRowId == null) return undefined;
  let merged: ResultsDataEntry | undefined;
  template.steps?.forEach((step, stepIndex) => {
    if (!isPreAssessmentSummaryStepIndex(template, stepIndex)) return;
    for (const sec of step.sections) {
      if (sec.pdf_render_mode !== 'task_results') continue;
      if ((sec as { assessment_task_row_id?: number | null }).assessment_task_row_id !== taskRowId) continue;
      merged = mergeResultsData(merged, resultsData[sec.id]);
    }
  });
  return merged;
}

function collectAssessmentTaskRows(template: FormTemplate): { id: number; label: string }[] {
  const rows: { id: number; label: string }[] = [];
  const seen = new Set<number>();
  template.steps?.forEach((step, stepIndex) => {
    if (!isPreAssessmentSummaryStepIndex(template, stepIndex)) return;
    for (const sec of step.sections) {
      if (sec.pdf_render_mode !== 'assessment_tasks') continue;
      const taskQ = sec.questions.find((q) => q.type === 'grid_table' && q.rows.length > 0);
      if (!taskQ) continue;
      for (const r of taskQ.rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        rows.push({ id: r.id, label: r.row_label });
      }
    }
  });
  return rows;
}

/**
 * One row per assessment task (matches PDF summary). Duplicate task_results sections
 * for the same task row are collapsed to a single canonical section.
 */
export function buildTaskResultSections(
  template: FormTemplate | null,
  resultsData?: Record<number, ResultsDataEntry>
): TaskResultSectionEntry[] {
  if (!template) return [];

  const rowLabels = buildTaskRowLabels(template);
  const rowToSection = new Map<number, number>();
  const unlinked: TaskResultSectionEntry[] = [];

  for (let stepIndex = 0; stepIndex < (template.steps ?? []).length; stepIndex++) {
    if (!isPreAssessmentSummaryStepIndex(template, stepIndex)) continue;
    for (const sec of template.steps![stepIndex].sections) {
      if (sec.pdf_render_mode !== 'task_results') continue;
      const taskRowId = (sec as { assessment_task_row_id?: number | null }).assessment_task_row_id ?? null;
      if (taskRowId != null) {
        const existingId = rowToSection.get(taskRowId);
        if (existingId == null) {
          rowToSection.set(taskRowId, sec.id);
        } else if (resultsData) {
          const existingScore = sectionResultsScore(resultsData[existingId]);
          const newScore = sectionResultsScore(resultsData[sec.id]);
          if (newScore >= existingScore) rowToSection.set(taskRowId, sec.id);
        } else {
          rowToSection.set(taskRowId, sec.id);
        }
      } else {
        unlinked.push({
          sectionId: sec.id,
          label: sec.title?.trim() ?? 'Assessment task results',
          taskRowId: null,
        });
      }
    }
  }

  const taskRows = collectAssessmentTaskRows(template);
  if (taskRows.length > 0) {
    return taskRows.map((tr) => ({
      sectionId: rowToSection.get(tr.id) ?? null,
      label: tr.label,
      taskRowId: tr.id,
    }));
  }

  const linked: TaskResultSectionEntry[] = [];
  const seenLinked = new Set<number>();
  for (const [taskRowId, sectionId] of rowToSection) {
    if (seenLinked.has(taskRowId)) continue;
    seenLinked.add(taskRowId);
    linked.push({
      sectionId,
      label: rowLabels.get(taskRowId) ?? 'Assessment task results',
      taskRowId,
    });
  }
  return [...linked, ...unlinked];
}

function getStoredAttemptSat(rd: ResultsDataEntry | undefined, attempt: 1 | 2 | 3): TaskAttemptSat {
  const raw =
    attempt === 1
      ? rd?.first_attempt_satisfactory
      : attempt === 2
        ? rd?.second_attempt_satisfactory
        : rd?.third_attempt_satisfactory;
  return raw === 's' || raw === 'ns' ? raw : null;
}

/** When Results S/NS is unset, infer from trainer question marks and checklists (attempt 1 only). */
function deriveFromTaskMarking(
  template: FormTemplate,
  taskRowId: number | null,
  answers: Record<string, unknown>,
  trainerAssessments: Record<number, string>
): TaskAttemptSat {
  if (taskRowId == null) return null;

  let anyNo = false;
  let anyUnmarked = false;
  let checkedCount = 0;

  for (let stepIndex = 0; stepIndex < (template.steps ?? []).length; stepIndex++) {
    if (!isPreAssessmentSummaryStepIndex(template, stepIndex)) continue;
    for (const sec of template.steps![stepIndex].sections) {
      if ((sec as { assessment_task_row_id?: number | null }).assessment_task_row_id !== taskRowId) continue;

      if (sec.pdf_render_mode === 'task_questions') {
        for (const q of sec.questions) {
          if (!isAssessableQuestion(q)) continue;
          const sat = trainerAssessments[q.id];
          if (sat === 'no') anyNo = true;
          else if (sat === 'yes') checkedCount += 1;
          else anyUnmarked = true;
        }
      }

      if (
        sec.pdf_render_mode === 'task_marking_checklist' ||
        sec.pdf_render_mode === 'task_written_evidence_checklist'
      ) {
        for (const q of sec.questions) {
          if (q.type !== 'single_choice' || !q.rows?.length) continue;
          for (const r of q.rows) {
            const val = String(answers[answerKey(q.id, r.id)] ?? '').trim();
            if (val === 'no') anyNo = true;
            else if (val === 'yes') checkedCount += 1;
            else anyUnmarked = true;
          }
        }
      }
    }
  }

  if (checkedCount === 0) return null;
  if (anyNo) return 'ns';
  if (anyUnmarked) return null;
  return 's';
}

export function getEffectiveAttemptSat(
  template: FormTemplate | null,
  sectionId: number | null,
  taskRowId: number | null,
  attempt: 1 | 2 | 3,
  resultsData: Record<number, ResultsDataEntry>,
  answers: Record<string, unknown>,
  trainerAssessments: Record<number, string>
): TaskAttemptSat {
  const rd =
    taskRowId != null
      ? getMergedResultsForTaskRow(template, taskRowId, resultsData)
      : sectionId != null
        ? resultsData[sectionId]
        : undefined;
  const stored = getStoredAttemptSat(rd, attempt);
  if (stored != null) return stored;
  if (attempt !== 1 || !template) return null;
  return deriveFromTaskMarking(template, taskRowId, answers, trainerAssessments);
}

export function getTaskResultChecks(
  template: FormTemplate | null,
  attempt: 1 | 2 | 3,
  resultsData: Record<number, ResultsDataEntry>,
  answers: Record<string, unknown>,
  trainerAssessments: Record<number, string>
): TaskResultCheck[] {
  return buildTaskResultSections(template, resultsData).map(({ sectionId, label, taskRowId }) => {
    const checkSectionId = sectionId ?? -taskRowId!;
    const stored = getStoredAttemptSat(
      taskRowId != null
        ? getMergedResultsForTaskRow(template, taskRowId, resultsData)
        : sectionId != null
          ? resultsData[sectionId]
          : undefined,
      attempt
    );
    const effective = getEffectiveAttemptSat(
      template,
      sectionId,
      taskRowId,
      attempt,
      resultsData,
      answers,
      trainerAssessments
    );

    if (effective === 's') {
      return {
        sectionId: checkSectionId,
        label,
        status: 'satisfactory',
        detail:
          stored === 's'
            ? 'Marked Satisfactory (S) on the task Results section'
            : 'All marking is Satisfactory — also set S on the task Results section to confirm',
      };
    }
    if (effective === 'ns') {
      return {
        sectionId: checkSectionId,
        label,
        status: 'not_satisfactory',
        detail:
          stored === 'ns'
            ? 'Marked Not Satisfactory (NS) on the task Results section'
            : 'One or more marking criteria is marked No',
      };
    }
    return {
      sectionId: checkSectionId,
      label,
      status: 'unmarked',
      detail:
        sectionId == null
          ? 'No Results section is linked to this assessment task'
          : 'Open the task Results section and mark Satisfactory (S), or finish marking every question/checklist as Yes',
    };
  });
}

export function getTrainerAttemptOutcomeFromChecks(checks: TaskResultCheck[]): AttemptOutcome {
  if (checks.length === 0) return null;
  if (checks.some((c) => c.status === 'not_satisfactory')) return 'not_yet_competent';
  if (checks.every((c) => c.status === 'satisfactory')) return 'competent';
  return null;
}

export function formatCompetentBlockerMessage(attempt: 1 | 2 | 3, checks: TaskResultCheck[]): string {
  const attemptLabel = attempt === 1 ? '1st' : attempt === 2 ? '2nd' : '3rd';
  const problems = checks.filter((c) => c.status !== 'satisfactory');
  if (problems.length === 0) {
    return `Cannot mark Competent (${attemptLabel} attempt): every assessment task must be Satisfactory (S) on its Results section.`;
  }
  const lines = problems.map((p) => {
    const state = p.status === 'not_satisfactory' ? 'Not Satisfactory' : 'Unmarked';
    return `• ${p.label}: ${state}`;
  });
  return `Cannot mark Competent (${attemptLabel} attempt). Complete these task results first:\n${lines.join('\n')}`;
}

export function formatAttemptSatLabel(sat: TaskAttemptSat): string {
  if (sat === 's') return '✓ Satisfactory';
  if (sat === 'ns') return '✓ Not Satisfactory';
  return '—';
}

/** Display dates on the assessment summary sheet (matches DatePicker: dd-MM-yyyy). */
export function formatSummaryDisplayDate(value: string | null | undefined): string {
  const v = String(value ?? '').trim();
  if (!v) return '—';
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
  return v;
}

export function maxTaskAttemptDate(
  template: FormTemplate | null,
  taskResultEntries: TaskResultSectionEntry[],
  resultsData: Record<number, ResultsDataEntry>,
  attempt: 1 | 2 | 3
): string | null {
  const field =
    attempt === 1 ? 'first_attempt_date' : attempt === 2 ? 'second_attempt_date' : 'third_attempt_date';
  let max: string | null = null;
  for (const entry of taskResultEntries) {
    const rd =
      entry.taskRowId != null
        ? getMergedResultsForTaskRow(template, entry.taskRowId, resultsData)
        : entry.sectionId != null
          ? resultsData[entry.sectionId]
          : undefined;
    const d = String(rd?.[field] ?? '').trim();
    if (!d) continue;
    if (!max || d > max) max = d;
  }
  return max;
}
