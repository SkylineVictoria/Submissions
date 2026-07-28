import { describe, expect, it } from 'vitest';
import {
  applyQuestionFieldUpdate,
  buildDuplicatedQuestionLabel,
  buildQuestionDuplicateInsertPayload,
  deepCloneJson,
  simulateDuplicateThenEditLabel,
} from './questionDuplicate';
import { remapPdfMetaQuestionIds } from './contentBlockClone';

describe('questionDuplicate', () => {
  it('builds a (Copy) label without stacking Copy suffixes', () => {
    expect(buildDuplicatedQuestionLabel('What is your name?', 'short_text')).toBe('What is your name? (Copy)');
    expect(buildDuplicatedQuestionLabel('What is your name? (Copy)', 'short_text')).toBe(
      'What is your name? (Copy)'
    );
  });

  it('creates insert payload without source id and with deep-cloned nested json', () => {
    const sharedMeta = {
      contentBlocks: [{ type: 'grid_table', questionId: 99, headerText: 'A' }],
      columnsMeta: [{ label: 'Terms', type: 'question' }],
    };
    const sharedVisibility = { student: true, trainer: true };
    const source = {
      id: 7451,
      type: 'short_text',
      code: 'custom.q1',
      label: 'What is your name?',
      help_text: 'Enter your full name',
      required: true,
      sort_order: 0,
      role_visibility: sharedVisibility,
      role_editability: sharedVisibility,
      pdf_meta: sharedMeta,
    };

    const payload = buildQuestionDuplicateInsertPayload(source, {
      sectionId: 10,
      sortOrder: 1,
      clearCode: true,
    });

    expect(payload).not.toHaveProperty('id');
    expect(payload.section_id).toBe(10);
    expect(payload.label).toBe('What is your name? (Copy)');
    expect(payload.code).toBeNull();
    expect(payload.pdf_meta).not.toBe(sharedMeta);
    expect((payload.pdf_meta as { contentBlocks: Array<{ questionId?: number }> }).contentBlocks[0].questionId).toBeUndefined();
    expect(payload.role_visibility).not.toBe(sharedVisibility);

    (payload.pdf_meta as { columnsMeta: Array<{ label: string }> }).columnsMeta[0].label = 'CHANGED';
    expect(sharedMeta.columnsMeta[0].label).toBe('Terms');
  });

  it('keeps original label unchanged when duplicate label is edited (TEST 1/2)', () => {
    const original = {
      id: 7451,
      type: 'short_text',
      label: 'What is your name?',
      help_text: 'Enter your full name',
      required: true,
      sort_order: 0,
      pdf_meta: { wordLimit: 50 },
    };
    const result = simulateDuplicateThenEditLabel(original, 8123);
    expect(result.originalLabel).toBe('What is your name?');
    expect(result.duplicateLabel).toBe('Where do you live?');
    expect(result.sharedPdfMetaRef).toBe(false);
  });

  it('updates only the targeted question id (TEST 3)', () => {
    const questions = [
      { id: 1, label: 'ONE', help_text: 'a', required: false },
      { id: 2, label: 'TWO', help_text: 'b', required: false },
      { id: 3, label: 'THREE', help_text: 'c', required: false },
    ];
    const next = applyQuestionFieldUpdate(questions, 2, { label: 'TWO-EDITED', help_text: 'b2', required: true });
    expect(next[0]).toEqual(questions[0]);
    expect(next[2]).toEqual(questions[2]);
    expect(next[1]).toEqual({ id: 2, label: 'TWO-EDITED', help_text: 'b2', required: true });
    expect(next[1]).not.toBe(questions[1]);
  });

  it('deep-clones pdf_meta on field update so nested edits stay isolated (TEST 4/5)', () => {
    const shared = { wordLimit: 50, note: 'x' };
    const questions = [
      { id: 1, label: 'A', pdf_meta: shared },
      { id: 2, label: 'B', pdf_meta: deepCloneJson(shared) },
    ];
    const next = applyQuestionFieldUpdate(questions, 2, {
      pdf_meta: { ...questions[1].pdf_meta, wordLimit: 200 },
    });
    expect((next[0].pdf_meta as { wordLimit: number }).wordLimit).toBe(50);
    expect((next[1].pdf_meta as { wordLimit: number }).wordLimit).toBe(200);
    expect(next[1].pdf_meta).not.toBe(next[0].pdf_meta);
  });

  it('supports three duplicates with independent labels (TEST 10)', () => {
    let questions = [{ id: 1, label: 'ONE', type: 'short_text' }];
    for (const [newId, newLabel] of [
      [2, 'TWO'],
      [3, 'THREE'],
      [4, 'FOUR'],
    ] as const) {
      const source = questions[questions.length - 1];
      const payload = buildQuestionDuplicateInsertPayload(source, {
        sectionId: 1,
        sortOrder: questions.length,
        clearCode: true,
      });
      questions = [
        ...questions,
        {
          id: newId,
          type: String(payload.type),
          label: String(payload.label),
        },
      ];
      questions = applyQuestionFieldUpdate(questions, newId, { label: newLabel });
    }
    expect(questions.map((q) => q.label)).toEqual(['ONE', 'TWO', 'THREE', 'FOUR']);
    expect(new Set(questions.map((q) => q.id)).size).toBe(4);
  });

  it('remaps content-block child ids after duplication (TEST 8)', () => {
    const idMap = new Map([
      [100, 1000],
      [101, 1001],
    ]);
    const remapped = remapPdfMetaQuestionIds(
      {
        contentBlocks: [{ type: 'grid_table', questionId: 101 }],
        isAdditionalBlockOf: 100,
      },
      idMap
    );
    expect(remapped?.contentBlocks?.[0]?.questionId).toBe(1001);
    expect(remapped?.isAdditionalBlockOf).toBe(1000);
  });
});
