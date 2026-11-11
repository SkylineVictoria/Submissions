/**
 * Per-question answer attachments for PDF generation — shared by live `/pdf` (index.ts) and
 * the worker (htmlGenerator.ts).
 *
 * Mirrors src/lib/answerAttachment.ts (DB shape + envelope rules); parity is covered by
 * src/lib/answerAttachment.test.ts. Attachments are rendered for ANY question type whose
 * answer row carries `value_json.answerImageUrl` — never gated by question type.
 */
import { escapeImgSrc } from './pdfConstants.js';

export const ANSWER_ATTACHMENT_URL_KEY = 'answerImageUrl';

export type PdfAnswerValue = string | number | Record<string, unknown>;

export type AnswerRowLike = {
  question_id: number;
  row_id: number | null;
  value_text?: string | null;
  value_number?: number | null;
  value_json?: unknown;
};

function cleanUrl(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

function plainObject(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function answerKey(questionId: number, rowId: number | null): string {
  return rowId === null ? `q-${questionId}` : `q-${questionId}-${rowId}`;
}

/** The type's own answer value for a DB row (attachment removed). Matches legacy getAnswerMap for rows without attachments. */
export function answerInnerValueFromDbRow(a: AnswerRowLike): PdfAnswerValue | undefined {
  const j = plainObject(a.value_json);
  const url = cleanUrl(j?.[ANSWER_ATTACHMENT_URL_KEY]);
  if (j && url) {
    if (Object.prototype.hasOwnProperty.call(j, 'value')) {
      const inner = j.value;
      return inner == null ? undefined : (inner as PdfAnswerValue);
    }
    if (a.value_text == null && a.value_number != null) return a.value_number;
    return String(a.value_text ?? j.text ?? '');
  }
  if (a.value_text != null) return a.value_text;
  if (a.value_number != null) return a.value_number;
  // `{}` is what a removed attachment leaves behind — it is not an answer.
  if (j && Object.keys(j).length === 0) return undefined;
  if (a.value_json != null) return a.value_json as Record<string, unknown>;
  return undefined;
}

/** Attachment URL stored on a DB row, if any. */
export function answerAttachmentUrlFromDbRow(a: AnswerRowLike): string | undefined {
  return cleanUrl(plainObject(a.value_json)?.[ANSWER_ATTACHMENT_URL_KEY]);
}

/** answer key → attachment URL, for every answer row (any question type) that has one. */
export function getAnswerAttachmentMap(answers: AnswerRowLike[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of answers) {
    const url = answerAttachmentUrlFromDbRow(a);
    if (url) m.set(answerKey(a.question_id, a.row_id), url);
  }
  return m;
}

/** Same markup the short/long answer cell has always used for its image. */
export function answerAttachmentImageHtml(url: string): string {
  const u = escapeImgSrc(url, 'answer-image');
  if (!u) return '';
  return `<div style="margin-top:8px"><img src="${u}" class="answer-image" alt="" style="max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px" loading="eager"/></div>`;
}

/**
 * Tracks which attachments have been placed under their answer so that each appears exactly once.
 * `flushSection` renders any attachment a section layout did not place inline (e.g. likert matrices),
 * so an enabled attachment can never be silently dropped from the PDF.
 */
export function createAttachmentTracker(attachments: Map<string, string>) {
  const placed = new Set<string>();
  const questionKey = (questionId: number) => answerKey(questionId, null);
  return {
    /** Attachment URL for a question (question-level row) — marks it as placed. */
    take(questionId: number): string | undefined {
      const key = questionKey(questionId);
      const url = attachments.get(key);
      if (!url || placed.has(key)) return undefined;
      placed.add(key);
      return url;
    },
    /** Image block for a question's attachment ('' when none) — marks it as placed. */
    blockHtml(questionId: number): string {
      const url = this.take(questionId);
      return url ? answerAttachmentImageHtml(url) : '';
    },
    /** Attachments of these questions that no layout placed yet, as labelled blocks. */
    flushSection(
      questions: Array<{ question: { id: number; label?: string | null; type?: string } }>,
      labelToHtml: (s: string | null | undefined) => string
    ): string {
      let out = '';
      for (const { question } of questions) {
        const img = this.blockHtml(question.id);
        if (!img) continue;
        out += `<div class="question answer-attachment-block"><div class="question-label">${labelToHtml(question.label ?? '')} — attachment</div><div class="answer-box">${img}</div></div>`;
      }
      return out;
    },
  };
}

export type AttachmentTracker = ReturnType<typeof createAttachmentTracker>;
