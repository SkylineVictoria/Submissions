/**
 * Describe what is missing on a required question for student-facing validation copy.
 * Does not change pass/fail rules — only labels and counts for messaging.
 */

import type { FormQuestionWithOptionsAndRows } from '../lib/formEngine';
import { getGridAnswerColumnIndexes } from './gridTableAnswers';

type AnswersMap = Record<
  string,
  string | number | boolean | Record<string, unknown> | string[] | undefined
>;

function getAnswerKey(questionId: number, rowId: number | null): string {
  if (rowId === null) return `q-${questionId}`;
  return `q-${questionId}-${rowId}`;
}

function rowHasContent(val: AnswersMap[string]): boolean {
  if (val == null) return false;
  if (typeof val === 'object' && !Array.isArray(val)) {
    return Object.values(val as Record<string, unknown>).some((v) => String(v ?? '').trim());
  }
  return String(val).trim() !== '';
}

function normalizeGridColumnType(raw: unknown): 'question' | 'answer' {
  return String(raw ?? '').trim().toLowerCase() === 'question' ? 'question' : 'answer';
}

function getGridColumnLabels(q: FormQuestionWithOptionsAndRows): string[] {
  const pm = (q.pdf_meta as Record<string, unknown>) || {};
  const colsMeta = pm.columnsMeta;
  if (Array.isArray(colsMeta) && colsMeta.length > 0) {
    return colsMeta.map((entry, idx) => {
      if (!entry || typeof entry !== 'object') return `Column ${idx + 1}`;
      const label = String((entry as Record<string, unknown>).label ?? '').trim();
      return label || `Column ${idx + 1}`;
    });
  }
  const columns = Array.isArray(pm.columns) ? (pm.columns as unknown[]) : [];
  if (columns.length > 0) {
    return columns.map((c, idx) => String(c ?? '').trim() || `Column ${idx + 1}`);
  }
  return ['Column 1'];
}

export type RequiredGapDetail = {
  fieldLabel: string | null;
  missingCount: number;
};

/** Count empty answer cells / first missing label for a grid that already failed fill checks. */
export function describeGridRequiredGap(
  q: FormQuestionWithOptionsAndRows,
  answers: AnswersMap
): RequiredGapDetail {
  if (!q.rows?.length) return { fieldLabel: null, missingCount: 1 };
  const answerCols = getGridAnswerColumnIndexes(q);
  const labels = getGridColumnLabels(q);
  const missingLabels: string[] = [];

  const pm = (q.pdf_meta as Record<string, unknown>) || {};
  const layout = String(pm.layout ?? 'no_image');
  const isNoHeader = layout === 'no_image_no_header';
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

  // Align messaging with isGridTableFilled: header tables need one full row;
  // no-header question-row tables need one fully filled answer column.
  if (isNoHeader && hasQuestionTypedColumn && answerCols.length > 0) {
    for (const colIdx of answerCols) {
      for (let ri = 0; ri < q.rows.length; ri++) {
        const r = q.rows[ri];
        const rowVal = answers[getAnswerKey(q.id, r.id)];
        const rowObj =
          rowVal && typeof rowVal === 'object' && !Array.isArray(rowVal)
            ? (rowVal as Record<string, unknown>)
            : null;
        const cellVal = rowObj ? String(rowObj[`r${r.id}_c${colIdx}`] ?? '').trim() : '';
        if (!cellVal) {
          const colLabel = labels[colIdx] || `Column ${colIdx + 1}`;
          missingLabels.push(`Table row ${ri + 1}, ${colLabel}`);
        }
      }
    }
  } else if (answerCols.length > 0) {
    for (let ri = 0; ri < q.rows.length; ri++) {
      const r = q.rows[ri];
      const rowVal = answers[getAnswerKey(q.id, r.id)];
      const rowObj =
        rowVal && typeof rowVal === 'object' && !Array.isArray(rowVal)
          ? (rowVal as Record<string, unknown>)
          : null;
      for (const colIdx of answerCols) {
        const cellVal = rowObj ? String(rowObj[`r${r.id}_c${colIdx}`] ?? '').trim() : '';
        if (!cellVal) {
          const colLabel = labels[colIdx] || `Column ${colIdx + 1}`;
          missingLabels.push(`Table row ${ri + 1}, ${colLabel}`);
        }
      }
    }
  } else {
    for (let ri = 0; ri < q.rows.length; ri++) {
      if (!rowHasContent(answers[getAnswerKey(q.id, q.rows[ri].id)])) {
        missingLabels.push(`Table row ${ri + 1}`);
      }
    }
  }

  const missingCount = Math.max(1, missingLabels.length);
  if (missingCount === 1) {
    return { fieldLabel: missingLabels[0] ?? null, missingCount: 1 };
  }
  return { fieldLabel: null, missingCount };
}

export function describeSignatureRequiredGap(
  q: FormQuestionWithOptionsAndRows,
  answers: AnswersMap
): RequiredGapDetail {
  const val = answers[getAnswerKey(q.id, null)];
  const obj = val && typeof val === 'object' && !Array.isArray(val) ? (val as Record<string, unknown>) : null;
  const sig = obj ? (obj.signature ?? obj.imageDataUrl ?? null) : typeof val === 'string' ? val : null;
  const dateVal = obj ? String(obj.date ?? obj.signedAtDate ?? '') : '';
  const needsDate = ((q.pdf_meta as { showDateField?: boolean } | undefined)?.showDateField ?? false) === true;
  const missing: string[] = [];
  if (!String(sig ?? '').trim()) {
    const code = String(q.code ?? '').toLowerCase();
    const label = String(q.label ?? '').toLowerCase();
    if (code.includes('student') || label.includes('student')) missing.push('Student Signature');
    else if (code.includes('trainer') || label.includes('trainer')) missing.push('Trainer Signature');
    else missing.push('Signature');
  }
  if (needsDate && !String(dateVal ?? '').trim()) missing.push('Date');
  if (missing.length === 1) return { fieldLabel: missing[0], missingCount: 1 };
  if (missing.length > 1) return { fieldLabel: null, missingCount: missing.length };
  return { fieldLabel: null, missingCount: 1 };
}

export type ContentBlockGap = {
  /** Child question id used for answer identity (never shown to students). */
  childQuestionId: number;
  blockLabel: string | null;
  fieldLabel: string | null;
  missingCount: number;
};

/**
 * Inspect content-block children independently (unique child IDs).
 * Returns gaps for messaging; parent Q number/title stay user-facing.
 */
export function describeContentBlockRequiredGaps(
  parent: FormQuestionWithOptionsAndRows,
  sectionQuestions: FormQuestionWithOptionsAndRows[],
  answers: AnswersMap,
  isGridFilled: (q: FormQuestionWithOptionsAndRows, answers: AnswersMap) => boolean
): ContentBlockGap[] {
  const pm = (parent.pdf_meta as Record<string, unknown>) || {};
  const blocks = pm.contentBlocks as Array<{
    type?: string;
    questionId?: number;
    headerText?: string;
  }> | undefined;
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const gaps: ContentBlockGap[] = [];
  let tableOrdinal = 0;

  for (const b of blocks) {
    if (!b.questionId) continue;
    const childQ = sectionQuestions.find((x) => x.id === b.questionId);
    if (!childQ) continue;
    const blockLabel =
      String(b.headerText ?? '').trim() ||
      (b.type === 'grid_table' ? `Table ${++tableOrdinal}` : null);

    if (b.type === 'grid_table' && childQ.rows?.length) {
      if (!isGridFilled(childQ, answers)) {
        const detail = describeGridRequiredGap(childQ, answers);
        const field =
          detail.missingCount === 1 && detail.fieldLabel
            ? blockLabel
              ? `${blockLabel} – ${detail.fieldLabel}`
              : detail.fieldLabel
            : blockLabel;
        gaps.push({
          childQuestionId: childQ.id,
          blockLabel,
          fieldLabel: detail.missingCount === 1 ? field : blockLabel,
          missingCount: detail.missingCount,
        });
      }
    } else if (b.type === 'short_text' || b.type === 'long_text') {
      if (
        childQ.required &&
        !rowHasContent(answers[getAnswerKey(childQ.id, null)])
      ) {
        gaps.push({
          childQuestionId: childQ.id,
          blockLabel,
          fieldLabel: blockLabel || cleanChildLabel(childQ.label) || 'Text field',
          missingCount: 1,
        });
      }
    }
  }
  return gaps;
}

function cleanChildLabel(label: string | null | undefined): string {
  return String(label ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse content-block gaps into one parent-facing fieldLabel / missingCount. */
export function summarizeContentBlockGaps(gaps: ContentBlockGap[]): RequiredGapDetail {
  if (gaps.length === 0) return { fieldLabel: null, missingCount: 0 };
  const total = gaps.reduce((n, g) => n + Math.max(1, g.missingCount), 0);
  if (total === 1) {
    return { fieldLabel: gaps[0].fieldLabel, missingCount: 1 };
  }
  return { fieldLabel: null, missingCount: total };
}
