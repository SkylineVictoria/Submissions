/**
 * Per-question answer attachments (image uploaded alongside an answer).
 *
 * Attachment support is driven ONLY by the question's `pdf_meta.allowAnswerImage` flag —
 * never by question type. Every answerable type (short/long text, yes/no, choices, date,
 * likert, grid, image, signature, …) uses the same envelope, upload path and DB shape.
 *
 * In-memory answer value (InstanceFillPage `answers` map, QuestionRenderer `value`):
 *   - string inner (short/long text, yes/no, single choice, date, …):
 *       `{ text: string, answerImageUrl?: string | null }`   ← unchanged legacy short/long shape
 *   - non-string inner (multi choice array, image `{url}`, signature object, number, …):
 *       `{ value: <inner>, answerImageUrl?: string | null }`
 *   `answerImageUrl: null` means "attachment explicitly removed" (persists a clear);
 *   a missing key means "no attachment change" (DB attachment is preserved).
 *
 * DB shape (skyline_form_answers):
 *   - string inner: value_text = inner, value_json = { answerImageUrl }  ← same as short/long
 *   - number inner: value_number = inner, value_json = { answerImageUrl }
 *   - array/object inner: value_json = { value: inner, answerImageUrl }
 *
 * Grid/likert/checklist questions store answers per row; their attachment lives on the
 * question-level answer row (row_id null).
 *
 * KEEP IN SYNC with pdf-server/answerAttachment.ts (parity covered by answerAttachment.test.ts).
 */

export type AnswerValue = string | number | boolean | Record<string, unknown> | string[];

export type AnswerSavePayload = { text?: string; number?: number; json?: unknown };

export type AnswerRowLike = {
  value_text?: string | null;
  value_number?: number | null;
  value_json?: unknown;
};

export const ANSWER_ATTACHMENT_URL_KEY = 'answerImageUrl';

/** Structural question types that never hold an answer, so cannot carry an attachment. */
export const NON_ANSWER_QUESTION_TYPES: ReadonlySet<string> = new Set(['instruction_block', 'page_break']);

/** True when the template enabled answer attachments for this question (any answerable type). */
export function questionAllowsAttachment(q: { type: string; pdf_meta?: unknown } | null | undefined): boolean {
  if (!q || NON_ANSWER_QUESTION_TYPES.has(q.type)) return false;
  const pm = q.pdf_meta && typeof q.pdf_meta === 'object' ? (q.pdf_meta as Record<string, unknown>) : null;
  return !!pm?.allowAnswerImage;
}

function cleanUrl(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() ? raw : undefined;
}

function plainObject(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Legacy short/long envelope `{ text, answerImageUrl? }` (also used for any string-valued answer). */
export function isTextAttachmentEnvelope(v: unknown): v is { text: string; answerImageUrl?: string | null } {
  const o = plainObject(v);
  if (!o || typeof o.text !== 'string') return false;
  return Object.keys(o).every((k) => k === 'text' || k === ANSWER_ATTACHMENT_URL_KEY);
}

/** Envelope for non-string answers `{ value, answerImageUrl? }`. */
export function isValueAttachmentEnvelope(v: unknown): v is { value: unknown; answerImageUrl?: string | null } {
  const o = plainObject(v);
  if (!o || !Object.prototype.hasOwnProperty.call(o, 'value')) return false;
  return Object.keys(o).every((k) => k === 'value' || k === ANSWER_ATTACHMENT_URL_KEY);
}

export function isAttachmentEnvelope(v: unknown): boolean {
  return isTextAttachmentEnvelope(v) || isValueAttachmentEnvelope(v);
}

/** Separate an answer value into the type's own value and the attachment URL (if any). */
export function splitAnswerAttachment(v: unknown): { inner: AnswerValue | null; attachmentUrl?: string } {
  if (isTextAttachmentEnvelope(v)) {
    return { inner: v.text, attachmentUrl: cleanUrl(v.answerImageUrl) };
  }
  if (isValueAttachmentEnvelope(v)) {
    const inner = v.value;
    return { inner: inner == null ? null : (inner as AnswerValue), attachmentUrl: cleanUrl(v.answerImageUrl) };
  }
  return { inner: v == null ? null : (v as AnswerValue) };
}

/**
 * Combine a type's own value with an attachment URL.
 * `url === undefined` → no attachment key (DB attachment preserved on save);
 * `url === null` → explicit removal (DB attachment cleared on save).
 */
export function withAnswerAttachment(inner: unknown, url: string | null | undefined): AnswerValue {
  const urlPart = url === undefined ? {} : { [ANSWER_ATTACHMENT_URL_KEY]: cleanUrl(url) ?? null };
  if (inner == null || typeof inner === 'string') {
    return { text: inner ?? '', ...urlPart } as Record<string, unknown>;
  }
  if (typeof inner === 'boolean') {
    // Booleans are persisted as 'true' / 'false' text (see answerToSavePayload).
    return { text: inner ? 'true' : 'false', ...urlPart } as Record<string, unknown>;
  }
  return { value: inner, ...urlPart } as Record<string, unknown>;
}

/** Convert an in-memory answer value into skyline_form_answers columns. */
export function answerToSavePayload(value: unknown): AnswerSavePayload {
  if (value == null) return {};
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'number') return { number: value };
  if (typeof value === 'boolean') return { text: value ? 'true' : 'false' };
  if (Array.isArray(value)) return { json: value };

  const o = value as Record<string, unknown>;
  const hasUrlKey = Object.prototype.hasOwnProperty.call(o, ANSWER_ATTACHMENT_URL_KEY);
  const url = cleanUrl(o[ANSWER_ATTACHMENT_URL_KEY]);
  // Explicit removal writes `{}` so the save merge (which preserves non-null json) really clears it.
  const attachmentJson = url ? { [ANSWER_ATTACHMENT_URL_KEY]: url } : hasUrlKey ? {} : undefined;

  if (isTextAttachmentEnvelope(o)) {
    return { text: o.text, json: attachmentJson };
  }
  if (isValueAttachmentEnvelope(o)) {
    const inner = o.value;
    if (inner == null) return { json: attachmentJson };
    if (typeof inner === 'string') return { text: inner, json: attachmentJson };
    if (typeof inner === 'number') return { number: inner, json: attachmentJson };
    if (typeof inner === 'boolean') return { text: inner ? 'true' : 'false', json: attachmentJson };
    // JSON-valued answers: the inner value moves under `value` only while an attachment exists.
    return { json: url ? { value: inner, [ANSWER_ATTACHMENT_URL_KEY]: url } : inner };
  }
  return { json: value };
}

/** Convert a skyline_form_answers row into the in-memory answer value. */
export function answerFromDbRow(a: AnswerRowLike): AnswerValue | null {
  const j = plainObject(a.value_json);
  const url = cleanUrl(j?.[ANSWER_ATTACHMENT_URL_KEY]);
  if (j && url) {
    if (Object.prototype.hasOwnProperty.call(j, 'value')) {
      return { value: j.value, [ANSWER_ATTACHMENT_URL_KEY]: url };
    }
    if (a.value_text == null && a.value_number != null) {
      return { value: a.value_number, [ANSWER_ATTACHMENT_URL_KEY]: url };
    }
    return { text: String(a.value_text ?? j.text ?? ''), [ANSWER_ATTACHMENT_URL_KEY]: url };
  }
  if (a.value_text != null) return a.value_text;
  if (a.value_number != null) return a.value_number;
  // `{}` is what a removed attachment leaves behind — it is not an answer.
  if (j && Object.keys(j).length === 0) return null;
  if (a.value_json != null) return a.value_json as Record<string, unknown> | string[];
  return null;
}
