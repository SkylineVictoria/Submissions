import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/storage', () => ({
  uploadAnswerImage: vi.fn(async (iid: number, qid: number) => ({
    url: `https://cdn.test/photomedia/skyline/answers/${iid}/${qid}/x.jpg`,
    error: null,
  })),
  deleteAnswerImageByPublicUrl: vi.fn(async () => ({ success: true })),
}));

import { QuestionAttachment, QuestionRenderer } from './QuestionRenderer';
import type { FormQuestionWithOptionsAndRows } from '../../lib/formEngine';
import { ANSWERABLE_TYPES, SAMPLE_INNER_BY_TYPE } from '../../lib/answerAttachment.fixtures';
import { withAnswerAttachment } from '../../lib/answerAttachment';

type Value = string | number | boolean | Record<string, unknown> | string[];

const ATTACH_URL = 'https://cdn.test/photomedia/skyline/answers/7/42/evidence.jpg';

function makeQuestion(
  type: string,
  opts: { allowAnswerImage?: boolean; rows?: boolean } = {}
): FormQuestionWithOptionsAndRows {
  const pdf_meta: Record<string, unknown> = { allowAnswerImage: opts.allowAnswerImage ?? true };
  if (type === 'grid_table') pdf_meta.columns = ['Answer'];
  return {
    id: 42,
    section_id: 1,
    type,
    code: null,
    label: `Question of type ${type}`,
    help_text: null,
    required: false,
    sort_order: 0,
    role_visibility: { student: true, trainer: true, office: true },
    role_editability: { student: true, trainer: true, office: true },
    pdf_meta,
    options: [
      { id: 1, question_id: 42, value: 'option_a', label: 'Option A', sort_order: 0 },
      { id: 2, question_id: 42, value: 'option_b', label: 'Option B', sort_order: 1 },
      { id: 3, question_id: 42, value: 'option_c', label: 'Option C', sort_order: 2 },
    ],
    rows: opts.rows ? [{ id: 1, question_id: 42, row_label: 'Row 1', row_help: null, row_image_url: null, sort_order: 0 }] : [],
  } as unknown as FormQuestionWithOptionsAndRows;
}

function render(el: React.ReactElement) {
  return renderToStaticMarkup(el);
}

const ATTACH_MARKER = 'data-testid="question-attachment-42"';

describe('QuestionRenderer — attachment upload control for every question type', () => {
  it.each(ANSWERABLE_TYPES)('%s: shows the upload control when attachments are enabled', (type) => {
    const html = render(
      <QuestionRenderer instanceId={7} question={makeQuestion(type)} value={null} onChange={() => {}} />
    );
    expect(html).toContain(ATTACH_MARKER);
    expect(html).toContain('Image with answer (optional)');
    expect(html).toContain('accept="image/*,.heic,.heif"');
  });

  it.each(ANSWERABLE_TYPES)('%s: no upload control when attachments are disabled', (type) => {
    const html = render(
      <QuestionRenderer
        instanceId={7}
        question={makeQuestion(type, { allowAnswerImage: false })}
        value={null}
        onChange={() => {}}
      />
    );
    expect(html).not.toContain(ATTACH_MARKER);
  });

  it.each(ANSWERABLE_TYPES)('%s: shows a saved attachment alongside the answer', (type) => {
    const value = withAnswerAttachment(SAMPLE_INNER_BY_TYPE[type], ATTACH_URL) as Value;
    const html = render(<QuestionRenderer instanceId={7} question={makeQuestion(type)} value={value} onChange={() => {}} />);
    expect(html).toContain(ATTACH_MARKER);
    expect(html).toContain(`src="${ATTACH_URL}"`);
    expect(html).toContain('Remove image');
    expect(html).not.toContain('[object Object]');
  });

  it.each(['instruction_block', 'page_break'])('%s: never shows an upload control', (type) => {
    const html = render(<QuestionRenderer instanceId={7} question={makeQuestion(type)} value={null} onChange={() => {}} />);
    expect(html).not.toContain(ATTACH_MARKER);
  });

  it('per-row questions (grid with rows) store the attachment in the question-level slot', () => {
    const q = makeQuestion('grid_table', { rows: true });
    const slotValue = withAnswerAttachment(null, ATTACH_URL) as Value;
    const withSlot = render(
      <QuestionRenderer
        instanceId={7}
        question={q}
        value={{ r1_c0: 'cell' }}
        onChange={() => {}}
        attachmentSlot={{ value: slotValue, onChange: () => {} }}
      />
    );
    expect(withSlot).toContain(ATTACH_MARKER);
    expect(withSlot).toContain(`src="${ATTACH_URL}"`);
    // Without a slot (read-only previews) there is nowhere to store it, so no control.
    const noSlot = render(<QuestionRenderer instanceId={7} question={q} value={{ r1_c0: 'cell' }} onChange={() => {}} />);
    expect(noSlot).not.toContain(ATTACH_MARKER);
  });
});

/** Walk the element tree QuestionRenderer returns (no DOM needed) to reach the wired callbacks. */
function findElement(node: React.ReactNode, match: (el: React.ReactElement) => boolean): React.ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findElement(n, match);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (match(el)) return el;
  return findElement(el.props?.children, match);
}

describe('QuestionRenderer — attachment wiring (stored with the answer, same shape for every type)', () => {
  it.each(ANSWERABLE_TYPES.filter((t) => t !== 'short_text' && t !== 'long_text'))(
    '%s: upload, answer edit and removal all emit the shared envelope',
    (type) => {
      const inner = SAMPLE_INNER_BY_TYPE[type];
      const onChange = vi.fn();
      const tree = (QuestionRenderer as unknown as (p: unknown) => React.ReactElement)({
        instanceId: 7,
        question: makeQuestion(type),
        value: withAnswerAttachment(inner, ATTACH_URL),
        onChange,
      });

      const attach = findElement(tree, (el) => el.type === QuestionAttachment) as React.ReactElement<{
        questionId: number;
        instanceId: number;
        answerImageUrl?: string;
        onImageUrl: (u: string | null) => void;
      }>;
      expect(attach).toBeTruthy();
      expect(attach.props.questionId).toBe(42);
      expect(attach.props.instanceId).toBe(7);
      expect(attach.props.answerImageUrl).toBe(ATTACH_URL);

      // Body (type renderer) only sees its own value, and its edits keep the attachment.
      const body = findElement(tree, (el) => typeof el.type === 'function' && el.type !== QuestionAttachment) as React.ReactElement<{
        value: unknown;
        onChange: (v: Value) => void;
      }>;
      expect(body.props.value).toEqual(inner);
      body.props.onChange(inner as Value);
      expect(onChange).toHaveBeenLastCalledWith(withAnswerAttachment(inner, ATTACH_URL));

      // Replacing the attachment keeps the answer.
      attach.props.onImageUrl('https://cdn.test/new.jpg');
      expect(onChange).toHaveBeenLastCalledWith(withAnswerAttachment(inner, 'https://cdn.test/new.jpg'));

      // Removal is explicit (null) so the stored URL is really cleared.
      attach.props.onImageUrl(null);
      expect(onChange).toHaveBeenLastCalledWith(withAnswerAttachment(inner, null));
    }
  );
});

describe('regression: short/long answer attachments', () => {
  it.each(['short_text', 'long_text'])('%s: text box and attachment render together, attachment under the answer', (type) => {
    const html = render(
      <QuestionRenderer
        instanceId={7}
        question={makeQuestion(type)}
        value={{ text: 'My answer', answerImageUrl: ATTACH_URL }}
        onChange={() => {}}
      />
    );
    expect(html).toContain('My answer');
    expect(html).toContain(`src="${ATTACH_URL}"`);
    expect(html.indexOf('My answer')).toBeLessThan(html.indexOf(ATTACH_MARKER));
    expect(html).not.toContain('[object Object]');
  });

  it.each(['short_text', 'long_text'])('%s: without attachments enabled, renders a plain text box as before', (type) => {
    const html = render(
      <QuestionRenderer
        instanceId={7}
        question={makeQuestion(type, { allowAnswerImage: false })}
        value="Plain answer"
        onChange={() => {}}
      />
    );
    expect(html).toContain('Plain answer');
    expect(html).not.toContain(ATTACH_MARKER);
  });

  it('attachments switched off after upload: answer still shows as text (not [object Object])', () => {
    const html = render(
      <QuestionRenderer
        instanceId={7}
        question={makeQuestion('yes_no', { allowAnswerImage: false })}
        value={{ text: 'yes', answerImageUrl: ATTACH_URL }}
        onChange={() => {}}
      />
    );
    expect(html).not.toContain(ATTACH_MARKER);
    expect(html).toMatch(/value="yes"[^>]*checked|checked[^>]*value="yes"/);
  });
});

describe('QuestionAttachment — validation and storage', () => {
  it('upload is disabled until the instance exists (same rule as short/long)', () => {
    const html = render(<QuestionAttachment questionId={42} onImageUrl={() => {}} />);
    expect(html).toContain('Save the form instance before attaching images.');
  });

  it('read-only (disabled) shows the saved image but no active upload', () => {
    const html = render(<QuestionAttachment instanceId={7} questionId={42} answerImageUrl={ATTACH_URL} onImageUrl={() => {}} disabled />);
    expect(html).toContain(`src="${ATTACH_URL}"`);
    expect(html).toMatch(/<input[^>]*type="file"[^>]*disabled/);
  });
});
