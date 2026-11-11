import { describe, expect, it } from 'vitest';
import {
  answerFromDbRow,
  answerToSavePayload,
  isAttachmentEnvelope,
  questionAllowsAttachment,
  splitAnswerAttachment,
  withAnswerAttachment,
  type AnswerSavePayload,
} from './answerAttachment';
import {
  answerAttachmentUrlFromDbRow,
  answerInnerValueFromDbRow,
  getAnswerAttachmentMap,
} from '../../pdf-server/answerAttachment';
import { mergeSaveValuePreservingExisting } from '../utils/formAnswerMerge';
import { ANSWERABLE_TYPES, SAMPLE_INNER_BY_TYPE } from './answerAttachment.fixtures';

const URL_A = 'https://example.supabase.co/storage/v1/object/public/photomedia/skyline/answers/7/11/photo_1.jpg';
const URL_B = 'https://example.supabase.co/storage/v1/object/public/photomedia/skyline/answers/7/11/photo_2.jpg';


/** What skyline_form_answers holds after saveAnswer() writes this payload onto `existing`. */
function persist(
  payload: AnswerSavePayload,
  existing: { value_text: string | null; value_number: number | null; value_json: unknown } | null = null
) {
  const merged = mergeSaveValuePreservingExisting(
    existing ? { text: existing.value_text, number: existing.value_number, json: existing.value_json } : null,
    { text: payload.text ?? null, number: payload.number ?? null, json: payload.json ?? null },
  );
  // Round-trip through JSON like the DB does (drops undefined keys).
  const json = merged.json == null ? null : JSON.parse(JSON.stringify(merged.json));
  return { value_text: merged.text ?? null, value_number: merged.number ?? null, value_json: json };
}

describe('questionAllowsAttachment — driven by the flag, not the type', () => {
  it.each(ANSWERABLE_TYPES)('%s: enabled when pdf_meta.allowAnswerImage is on', (type) => {
    expect(questionAllowsAttachment({ type, pdf_meta: { allowAnswerImage: true } })).toBe(true);
    expect(questionAllowsAttachment({ type, pdf_meta: { allowAnswerImage: false } })).toBe(false);
    expect(questionAllowsAttachment({ type, pdf_meta: {} })).toBe(false);
  });

  it.each(['instruction_block', 'page_break'])('%s never carries an answer, so never an attachment', (type) => {
    expect(questionAllowsAttachment({ type, pdf_meta: { allowAnswerImage: true } })).toBe(false);
  });
});

describe('attachment round-trip through the DB shape, for every question type', () => {
  it.each(ANSWERABLE_TYPES)('%s: answer + attachment survive save → load (app and PDF server agree)', (type) => {
    const inner = SAMPLE_INNER_BY_TYPE[type];
    const row = persist(answerToSavePayload(withAnswerAttachment(inner, URL_A)));

    // Same DB shape as short/long: the URL lives at value_json.answerImageUrl.
    expect((row.value_json as Record<string, unknown>).answerImageUrl).toBe(URL_A);

    const loaded = answerFromDbRow(row);
    expect(isAttachmentEnvelope(loaded)).toBe(true);
    expect(splitAnswerAttachment(loaded)).toEqual({ inner, attachmentUrl: URL_A });

    // PDF server parses the same row to the same answer and attachment.
    const pdfRow = { question_id: 11, row_id: null, ...row };
    expect(answerInnerValueFromDbRow(pdfRow)).toEqual(inner);
    expect(answerAttachmentUrlFromDbRow(pdfRow)).toBe(URL_A);
    expect(getAnswerAttachmentMap([pdfRow]).get('q-11')).toBe(URL_A);
  });

  it.each(ANSWERABLE_TYPES)('%s: editing the answer of a saved draft keeps the existing attachment', (type) => {
    const inner = SAMPLE_INNER_BY_TYPE[type];
    const saved = persist(answerToSavePayload(withAnswerAttachment(inner, URL_A)));
    const { inner: loadedInner, attachmentUrl } = splitAnswerAttachment(answerFromDbRow(saved));
    expect(loadedInner).toEqual(inner);

    // The renderer re-wraps edits with the current attachment URL.
    const edited = typeof inner === 'string' ? `${inner} (edited)` : inner;
    const resaved = persist(answerToSavePayload(withAnswerAttachment(edited, attachmentUrl)), saved);
    expect(splitAnswerAttachment(answerFromDbRow(resaved))).toEqual({ inner: edited, attachmentUrl: URL_A });
  });

  it.each(ANSWERABLE_TYPES)('%s: replacing the attachment stores the new URL', (type) => {
    const inner = SAMPLE_INNER_BY_TYPE[type];
    const saved = persist(answerToSavePayload(withAnswerAttachment(inner, URL_A)));
    const replaced = persist(answerToSavePayload(withAnswerAttachment(inner, URL_B)), saved);
    expect(splitAnswerAttachment(answerFromDbRow(replaced))).toEqual({ inner, attachmentUrl: URL_B });
  });

  it.each(ANSWERABLE_TYPES)('%s: removing the attachment clears it in the DB and keeps the answer', (type) => {
    const inner = SAMPLE_INNER_BY_TYPE[type];
    const saved = persist(answerToSavePayload(withAnswerAttachment(inner, URL_A)));
    const removed = persist(answerToSavePayload(withAnswerAttachment(inner, null)), saved);
    expect(answerAttachmentUrlFromDbRow({ question_id: 1, row_id: null, ...removed })).toBeUndefined();
    expect(splitAnswerAttachment(answerFromDbRow(removed))).toEqual({ inner, attachmentUrl: undefined });
    expect(answerInnerValueFromDbRow({ question_id: 1, row_id: null, ...removed })).toEqual(inner);
  });

  it('attachment-only answer on a per-row question (grid/likert) is stored on the question-level row', () => {
    const row = persist(answerToSavePayload(withAnswerAttachment(null, URL_A)));
    expect(row.value_json).toEqual({ answerImageUrl: URL_A });
    expect(splitAnswerAttachment(answerFromDbRow(row)).attachmentUrl).toBe(URL_A);
    expect(getAnswerAttachmentMap([{ question_id: 5, row_id: null, ...row }]).get('q-5')).toBe(URL_A);
  });
});

describe('regression: short/long answer attachments are unchanged', () => {
  it('serializes the legacy { text, answerImageUrl } envelope exactly as before', () => {
    expect(answerToSavePayload({ text: 'hello', answerImageUrl: URL_A })).toEqual({
      text: 'hello',
      json: { answerImageUrl: URL_A },
    });
    // No attachment change → value_json left alone (preserved by the save merge).
    expect(answerToSavePayload({ text: 'hello' })).toEqual({ text: 'hello', json: undefined });
  });

  it('loads legacy short/long rows into the same { text, answerImageUrl } value as before', () => {
    expect(answerFromDbRow({ value_text: 'hello', value_number: null, value_json: { answerImageUrl: URL_A } })).toEqual({
      text: 'hello',
      answerImageUrl: URL_A,
    });
    // Legacy rows that kept the text inside value_json.
    expect(answerFromDbRow({ value_text: null, value_number: null, value_json: { text: 'old', answerImageUrl: URL_A } })).toEqual({
      text: 'old',
      answerImageUrl: URL_A,
    });
  });

  it('values without attachments serialize and load exactly as before', () => {
    expect(answerToSavePayload('plain')).toEqual({ text: 'plain' });
    expect(answerToSavePayload(3)).toEqual({ number: 3 });
    expect(answerToSavePayload(true)).toEqual({ text: 'true' });
    expect(answerToSavePayload(['a'])).toEqual({ json: ['a'] });
    expect(answerToSavePayload({ r1_c0: 'x' })).toEqual({ json: { r1_c0: 'x' } });
    expect(answerToSavePayload({ url: 'u' })).toEqual({ json: { url: 'u' } });

    expect(answerFromDbRow({ value_text: 'plain', value_number: null, value_json: null })).toBe('plain');
    expect(answerFromDbRow({ value_text: null, value_number: 3, value_json: null })).toBe(3);
    expect(answerFromDbRow({ value_text: null, value_number: null, value_json: ['a'] })).toEqual(['a']);
    expect(answerFromDbRow({ value_text: null, value_number: null, value_json: { url: 'u' } })).toEqual({ url: 'u' });
    expect(answerFromDbRow({ value_text: null, value_number: null, value_json: null })).toBeNull();
  });

  it('PDF answer map is identical to the legacy implementation for rows without attachments', () => {
    const legacy = (a: { value_text: string | null; value_number: number | null; value_json: unknown }) => {
      if (a.value_text != null) return a.value_text;
      if (a.value_number != null) return a.value_number;
      if (a.value_json != null) return a.value_json;
      return undefined;
    };
    const rows = [
      { value_text: 'yes', value_number: null, value_json: null },
      { value_text: null, value_number: 5, value_json: null },
      { value_text: null, value_number: null, value_json: ['a', 'b'] },
      { value_text: null, value_number: null, value_json: { r9_c0: 'x', r9_c1: 'y' } },
      { value_text: null, value_number: null, value_json: { signature: 'data:image/png;base64,AA', date: '2026-01-01' } },
      { value_text: null, value_number: null, value_json: { url: 'https://x/y.png' } },
      { value_text: null, value_number: null, value_json: null },
    ];
    for (const r of rows) {
      expect(answerInnerValueFromDbRow({ question_id: 1, row_id: null, ...r })).toEqual(legacy(r));
      expect(answerAttachmentUrlFromDbRow({ question_id: 1, row_id: null, ...r })).toBeUndefined();
    }
  });
});
