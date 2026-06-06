import type {
  FormQuestionWithOptionsAndRows,
  FormSectionWithQuestions,
  FormTemplate,
} from '../lib/formEngine';
import { groupGridCellsByRow, mergeGridTableAnswers, type GridAnswersMap } from './gridTableAnswers';

export type AnswerSaveTarget = {
  questionId: number;
  rowId: number | null;
  value: string | number | boolean | Record<string, unknown> | string[];
};

function getAnswerKey(questionId: number, rowId: number | null): string {
  if (rowId === null) return `q-${questionId}`;
  return `q-${questionId}-${rowId}`;
}

function rowHasContent(val: unknown): boolean {
  if (val == null) return false;
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.values(val as Record<string, unknown>).some((v) => String(v ?? '').trim());
  }
  return String(val).trim() !== '';
}

function findQuestionInTemplate(
  template: FormTemplate,
  questionId: number
): FormQuestionWithOptionsAndRows | null {
  for (const step of template.steps ?? []) {
    for (const section of step.sections) {
      const q = section.questions.find((x) => x.id === questionId);
      if (q) return q;
    }
  }
  return null;
}

function collectQuestionIdsFromSection(section: FormSectionWithQuestions): number[] {
  const ids = new Set<number>();
  for (const q of section.questions) {
    if (q.type === 'instruction_block' || q.type === 'page_break') continue;
    ids.add(q.id);
    const pm = (q.pdf_meta as Record<string, unknown>) || {};
    const blocks = pm.contentBlocks as Array<{ questionId?: number }> | undefined;
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (typeof b.questionId === 'number') ids.add(b.questionId);
      }
    }
    const legacyAb = pm.additionalBlock as { questionId?: number } | undefined;
    if (typeof legacyAb?.questionId === 'number') ids.add(legacyAb.questionId);
  }
  return [...ids];
}

/** Build save payloads for one question, using correct per-row grid format when applicable. */
export function collectAnswerSaveTargetsForQuestion(
  q: FormQuestionWithOptionsAndRows,
  answers: GridAnswersMap
): AnswerSaveTarget[] {
  if (q.type === 'instruction_block' || q.type === 'page_break') return [];

  if (q.type === 'grid_table' && q.rows?.length) {
    const merged = mergeGridTableAnswers(q, answers);
    const byRow = groupGridCellsByRow(merged);
    const targets: AnswerSaveTarget[] = [];
    for (const [rowId, rowCells] of byRow) {
      if (Object.values(rowCells).some((v) => String(v ?? '').trim())) {
        targets.push({ questionId: q.id, rowId, value: rowCells });
      }
    }
    return targets;
  }

  if (q.type === 'likert_5' && q.rows?.length) {
    if (q.rows.length === 1) {
      const v = answers[getAnswerKey(q.id, q.rows[0].id)];
      if (v != null && String(v).trim()) {
        return [{ questionId: q.id, rowId: q.rows[0].id, value: v as string | number | boolean | Record<string, unknown> | string[] }];
      }
      return [];
    }
    const targets: AnswerSaveTarget[] = [];
    for (const r of q.rows) {
      const v = answers[getAnswerKey(q.id, r.id)];
      if (v != null && String(v).trim()) {
        targets.push({ questionId: q.id, rowId: r.id, value: v as string | number | boolean | Record<string, unknown> | string[] });
      }
    }
    return targets;
  }

  if (q.type === 'single_choice' && q.rows?.length) {
    const targets: AnswerSaveTarget[] = [];
    for (const r of q.rows) {
      const v = answers[getAnswerKey(q.id, r.id)];
      if (rowHasContent(v)) {
        targets.push({ questionId: q.id, rowId: r.id, value: v as string | number | boolean | Record<string, unknown> | string[] });
      }
    }
    return targets;
  }

  const v = answers[getAnswerKey(q.id, null)];
  if (rowHasContent(v)) {
    return [{ questionId: q.id, rowId: null, value: v as string | number | boolean | Record<string, unknown> | string[] }];
  }
  return [];
}

/** All answer payloads on one wizard step (for sequential flush on Next). */
export function collectStepAnswerSaveTargets(
  template: FormTemplate,
  stepSections: FormSectionWithQuestions[],
  answers: GridAnswersMap
): AnswerSaveTarget[] {
  const questionIds = new Set<number>();
  for (const section of stepSections) {
    for (const id of collectQuestionIdsFromSection(section)) {
      questionIds.add(id);
    }
  }

  const targets: AnswerSaveTarget[] = [];
  for (const qid of questionIds) {
    const q = findQuestionInTemplate(template, qid);
    if (!q) continue;
    targets.push(...collectAnswerSaveTargetsForQuestion(q, answers));
  }
  return targets;
}

/** Group row-level saves by question for sequential UI updates. */
export function groupSaveTargetsByQuestion(
  targets: AnswerSaveTarget[]
): Map<number, AnswerSaveTarget[]> {
  const byQuestion = new Map<number, AnswerSaveTarget[]>();
  for (const t of targets) {
    if (!byQuestion.has(t.questionId)) byQuestion.set(t.questionId, []);
    byQuestion.get(t.questionId)!.push(t);
  }
  return byQuestion;
}

/** Question ids in section order (deduped) for sequential save UI. */
export function collectOrderedQuestionIdsFromSections(
  sections: FormSectionWithQuestions[]
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const section of sections) {
    for (const qid of collectQuestionIdsFromSection(section)) {
      if (!seen.has(qid)) {
        seen.add(qid);
        ids.push(qid);
      }
    }
  }
  return ids;
}
