import { describe, expect, it } from 'vitest';
import {
  buildHtml,
  getAnswerMap,
  type FormAnswer,
  type FormQuestion,
  type FormQuestionRow,
  type FormSection,
} from '../../pdf-server/htmlGenerator';
import { getAnswerAttachmentMap } from '../../pdf-server/answerAttachment';
import { answerToSavePayload, withAnswerAttachment } from './answerAttachment';
import { ANSWERABLE_TYPES, SAMPLE_INNER_BY_TYPE } from './answerAttachment.fixtures';

const attachUrlFor = (qid: number) =>
  `https://example.supabase.co/storage/v1/object/public/photomedia/skyline/answers/900/${qid}/evidence_${qid}.jpg`;

type QEntry = { question: FormQuestion; options: []; rows: FormQuestionRow[] };

function question(id: number, sectionId: number, type: string, extra: Partial<FormQuestion> = {}): QEntry {
  const pdf_meta: Record<string, unknown> = { allowAnswerImage: true };
  if (type === 'grid_table') pdf_meta.columns = ['Answer'];
  const rows: FormQuestionRow[] =
    type === 'grid_table'
      ? [{ id: id * 10, question_id: id, row_label: 'Row', row_help: null, row_image_url: null, sort_order: 0 }]
      : [];
  return {
    question: {
      id,
      section_id: sectionId,
      type,
      code: null,
      label: `Label ${type} ${id}`,
      help_text: null,
      required: false,
      sort_order: id,
      role_visibility: {},
      role_editability: {},
      pdf_meta,
      ...extra,
    },
    options: [],
    rows,
  };
}

/** DB rows exactly as the app writes them (answerToSavePayload) for one attachment-enabled answer. */
function dbRowsFor(q: QEntry): FormAnswer[] {
  const qid = q.question.id;
  const inner = SAMPLE_INNER_BY_TYPE[q.question.type];
  const url = attachUrlFor(qid);
  if (q.rows.length) {
    // Per-row question: cells on each row, attachment on the question-level row.
    const p = answerToSavePayload(withAnswerAttachment(null, url));
    return [
      { question_id: qid, row_id: q.rows[0].id, value_text: null, value_number: null, value_json: { [`r${q.rows[0].id}_c0`]: 'cell' } },
      { question_id: qid, row_id: null, value_text: p.text ?? null, value_number: p.number ?? null, value_json: p.json ?? null },
    ];
  }
  const p = answerToSavePayload(withAnswerAttachment(inner, url));
  return [{ question_id: qid, row_id: null, value_text: p.text ?? null, value_number: p.number ?? null, value_json: p.json ?? null }];
}

function section(id: number, pdf_render_mode: string, title = `Section ${id}`): FormSection {
  return { id, step_id: 1, title, description: null, pdf_render_mode, sort_order: id };
}

function render(sections: Array<{ section: FormSection; questions: QEntry[] }>, answers: FormAnswer[]) {
  return buildHtml({
    form: { name: 'Attachment test', version: '1', unit_code: 'TEST001', header_asset_url: null },
    steps: [{ step: { id: 1, title: 'Assessment', subtitle: null }, sections }],
    answers: getAnswerMap(answers),
    answerAttachments: getAnswerAttachmentMap(answers),
  }).html;
}

const occurrences = (html: string, needle: string) => html.split(needle).length - 1;

// Layouts a builder question can land in. Each must place every attachment exactly once.
const LAYOUTS: Array<{ mode: string; title?: string }> = [
  { mode: 'default' },
  { mode: 'task_questions' },
  { mode: 'declarations', title: 'Student declaration' },
  { mode: 'likert_table' },
];

describe('PDF: attachments render for every question type', () => {
  for (const layout of LAYOUTS) {
    describe(`section layout "${layout.mode}"`, () => {
      it.each(ANSWERABLE_TYPES)('%s: attachment image appears exactly once', (type) => {
        const qid = 100 + ANSWERABLE_TYPES.indexOf(type);
        const q = question(qid, 1, type);
        const html = render([{ section: section(1, layout.mode, layout.title), questions: [q] }], dbRowsFor(q));
        const url = attachUrlFor(qid);
        expect(occurrences(html, `src="${url}"`)).toBe(1);
        expect(html).toContain('class="answer-image"');
      });
    });
  }

  it('all types together in one task-questions section: each attachment once, under its own answer', () => {
    const qs = ANSWERABLE_TYPES.map((t, i) => question(200 + i, 1, t));
    const html = render([{ section: section(1, 'task_questions'), questions: qs }], qs.flatMap(dbRowsFor));
    let lastPos = -1;
    for (const q of qs) {
      const url = attachUrlFor(q.question.id);
      expect(occurrences(html, `src="${url}"`)).toBe(1);
      // Attachments follow question order (each sits under its own answer).
      const pos = html.indexOf(`src="${url}"`);
      expect(pos).toBeGreaterThan(lastPos);
      lastPos = pos;
    }
    // Attachments must not change how the answers themselves print. (Image/signature answers in
    // task-question boxes print "[object Object]" today with or without attachments — pre-existing.)
    const noAttachmentRows = qs.map((q) => {
      const p = answerToSavePayload(SAMPLE_INNER_BY_TYPE[q.question.type] as never);
      return { question_id: q.question.id, row_id: null, value_text: p.text ?? null, value_number: p.number ?? null, value_json: p.json ?? null };
    });
    const without = render([{ section: section(1, 'task_questions'), questions: qs }], noAttachmentRows);
    expect(occurrences(html, '[object Object]')).toBe(occurrences(without, '[object Object]'));
  });

  it('choice/date answers render their value, not the attachment envelope', () => {
    const qs = [question(301, 1, 'single_choice'), question(302, 1, 'date'), question(303, 1, 'multi_choice')];
    const html = render([{ section: section(1, 'default'), questions: qs }], qs.flatMap(dbRowsFor));
    expect(html).toContain('option_b');
    expect(html).toContain('2026-11-11');
    expect(html).toContain('option_a,option_c');
    expect(html).not.toContain('[object Object]');
  });
});

describe('PDF regression: short/long answers and existing submissions', () => {
  it.each(['short_text', 'long_text'])('%s: legacy row renders the exact same text + image markup as before', (type) => {
    const q = question(400, 1, type);
    const url = attachUrlFor(400);
    const legacyRow: FormAnswer = {
      question_id: 400,
      row_id: null,
      value_text: 'Line one\nLine two',
      value_number: null,
      value_json: { answerImageUrl: url },
    };
    const html = render([{ section: section(1, 'task_questions'), questions: [q] }], [legacyRow]);
    expect(html).toContain(
      `<div style="white-space:pre-line">Line one<br>Line two</div><div style="margin-top:8px"><img src="${url}" class="answer-image" alt="" loading="eager" style="max-width:100%;max-height:280px;object-fit:contain;border:1px solid #ddd;border-radius:4px"/></div>`
    );
    expect(occurrences(html, `src="${url}"`)).toBe(1);
  });

  it('submissions without attachments render identical HTML whether or not the attachment map is passed', () => {
    const qs = ANSWERABLE_TYPES.map((t, i) => question(500 + i, 1, t, { pdf_meta: {} }));
    const rows: FormAnswer[] = qs.map((q) => {
      const p = answerToSavePayload(SAMPLE_INNER_BY_TYPE[q.question.type] as never);
      return { question_id: q.question.id, row_id: null, value_text: p.text ?? null, value_number: p.number ?? null, value_json: p.json ?? null };
    });
    for (const mode of ['default', 'task_questions', 'declarations']) {
      const sections = [{ section: section(1, mode, 'Student declaration'), questions: qs }];
      const base = {
        form: { name: 'Attachment test', version: '1', unit_code: 'TEST001', header_asset_url: null },
        steps: [{ step: { id: 1, title: 'Assessment', subtitle: null }, sections }],
        answers: getAnswerMap(rows),
      };
      expect(buildHtml({ ...base, answerAttachments: getAnswerAttachmentMap(rows) }).html).toBe(buildHtml(base).html);
      expect(buildHtml(base).html).not.toContain('class="answer-image"');
    }
  });
});
