import { describe, expect, it } from 'vitest';
import {
  buildContentBlockGridDiagnostic,
  findSharedContentBlockQuestionIds,
  planSharedContentBlockRepairs,
  remapPdfMetaQuestionIds,
} from './contentBlockClone';

describe('remapPdfMetaQuestionIds', () => {
  it('remaps contentBlocks.questionId and isAdditionalBlockOf', () => {
    const idMap = new Map<number, number>([
      [100, 1000],
      [200, 2000],
    ]);
    const next = remapPdfMetaQuestionIds(
      {
        isAdditionalBlockOf: 100,
        contentBlocks: [
          { type: 'grid_table', questionId: 200 },
          { type: 'instruction_block', content: 'hi' },
        ],
        layout: 'no_image',
      },
      idMap
    );
    expect(next).toEqual({
      isAdditionalBlockOf: 1000,
      contentBlocks: [
        { type: 'grid_table', questionId: 2000 },
        { type: 'instruction_block', content: 'hi' },
      ],
      layout: 'no_image',
    });
  });

  it('returns null when nothing to remap', () => {
    expect(remapPdfMetaQuestionIds({ layout: 'no_image' }, new Map([[1, 2]]))).toBeNull();
    expect(
      remapPdfMetaQuestionIds({ contentBlocks: [{ type: 'grid_table', questionId: 99 }] }, new Map([[1, 2]]))
    ).toBeNull();
  });
});

describe('findSharedContentBlockQuestionIds / planSharedContentBlockRepairs', () => {
  const questions = [
    {
      id: 7451,
      pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 7452 }] },
    },
    {
      id: 7452,
      pdf_meta: { isAdditionalBlockOf: 7451, layout: 'no_image' },
    },
    {
      id: 7453,
      pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 7452 }] },
    },
    {
      id: 7454,
      pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 7452 }] },
    },
    {
      id: 7455,
      pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 7452 }] },
    },
  ];

  it('detects a shared child grid used by multiple parents', () => {
    const shared = findSharedContentBlockQuestionIds(questions);
    expect(shared.get(7452)).toEqual([7451, 7453, 7454, 7455]);
  });

  it('plans clones for non-owner parents only', () => {
    const shared = findSharedContentBlockQuestionIds(questions);
    const plans = planSharedContentBlockRepairs(questions, shared);
    expect(plans).toHaveLength(1);
    expect(plans[0].sharedChildId).toBe(7452);
    expect(plans[0].ownerParentId).toBe(7451);
    expect(plans[0].parentsNeedingClone).toEqual([7453, 7454, 7455]);
  });

  it('returns empty when each parent has its own child', () => {
    const ok = [
      { id: 1, pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 11 }] } },
      { id: 2, pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 22 }] } },
      { id: 11, pdf_meta: { isAdditionalBlockOf: 1 } },
      { id: 22, pdf_meta: { isAdditionalBlockOf: 2 } },
    ];
    expect(findSharedContentBlockQuestionIds(ok).size).toBe(0);
    expect(planSharedContentBlockRepairs(ok, findSharedContentBlockQuestionIds(ok))).toEqual([]);
  });

  it('buildContentBlockGridDiagnostic reports usage counts and row ids', () => {
    const diag = buildContentBlockGridDiagnostic([
      { id: 1, label: 'A', pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 10 }] } },
      { id: 2, label: 'B', pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 10 }] } },
      { id: 10, rows: [{ id: 100 }, { id: 101 }], pdf_meta: { isAdditionalBlockOf: 1 } },
    ]);
    expect(diag).toHaveLength(2);
    expect(diag.every((r) => r.childQuestionId === 10 && r.usageCount === 2)).toBe(true);
    expect(diag[0].rowIds).toEqual([100, 101]);
  });
});
