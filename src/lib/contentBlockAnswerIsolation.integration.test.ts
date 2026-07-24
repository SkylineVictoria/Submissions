/**
 * Integration-level regression: independently cloned content-block grids must not
 * share answer identity across form-definition → state → save → reload → PDF lookup.
 */
import { describe, expect, it } from 'vitest';
import {
  findSharedContentBlockQuestionIds,
  planSharedContentBlockRepairs,
} from './contentBlockClone';
import { getGridAnswerKey, mergeGridTableAnswers } from '../utils/gridTableAnswers';

type Q = {
  id: number;
  label?: string;
  type?: string;
  pdf_meta?: unknown;
  rows?: Array<{ id: number }>;
};

function simulateGridWrite(
  answers: Record<string, Record<string, string>>,
  questionId: number,
  rowId: number,
  cellKey: string,
  value: string
) {
  const key = getGridAnswerKey(questionId, rowId);
  const prev = answers[key] ?? {};
  answers[key] = { ...prev, [cellKey]: value };
}

function readMergedCell(
  answers: Record<string, Record<string, string> | string | undefined>,
  q: Q,
  cellKey: string
): string {
  const merged = mergeGridTableAnswers(q, answers);
  return merged[cellKey] ?? '';
}

describe('content-block grid answer isolation (integration)', () => {
  it('proves shared child IDs cause WRITE+READ collision (pre-repair)', () => {
    const sharedChildId = 7452;
    const parents = [
      { id: 7451, pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: sharedChildId }] } },
      { id: 7453, pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: sharedChildId }] } },
      { id: 7454, pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: sharedChildId }] } },
      { id: 7455, pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: sharedChildId }] } },
    ];
    const child: Q = {
      id: sharedChildId,
      type: 'grid_table',
      pdf_meta: { isAdditionalBlockOf: 7451, columnsMeta: [{ type: 'answer', label: 'Initial Calculation (Incorrect)' }] },
      rows: [{ id: 8071 }, { id: 8072 }],
    };

    const shared = findSharedContentBlockQuestionIds([...parents, child]);
    expect(shared.get(sharedChildId)).toHaveLength(4);

    // Renderer resolves every content block to the same child question object.
    const tableA = child;
    const tableB = child;
    expect(tableA.id).toBe(tableB.id);

    const answers: Record<string, Record<string, string>> = {};
    const cellKey = `r${child.rows![0].id}_c0`;
    simulateGridWrite(answers, tableA.id, child.rows![0].id, cellKey, 'ONE');

    // Table B reads the same answer key → mirrored value.
    expect(readMergedCell(answers, tableB, cellKey)).toBe('ONE');
    expect(getGridAnswerKey(tableA.id, child.rows![0].id)).toBe(
      getGridAnswerKey(tableB.id, child.rows![0].id)
    );
  });

  it('keeps four repaired tables independent through write → merge → reload', () => {
    const questions: Q[] = [
      { id: 7451, label: 'P1', pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 7452 }] } },
      {
        id: 7452,
        type: 'grid_table',
        pdf_meta: { isAdditionalBlockOf: 7451 },
        rows: [{ id: 8071 }, { id: 8072 }],
      },
      { id: 7453, label: 'P2', pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 11823 }] } },
      {
        id: 11823,
        type: 'grid_table',
        pdf_meta: { isAdditionalBlockOf: 7453 },
        rows: [{ id: 17052 }, { id: 17053 }],
      },
      { id: 7454, label: 'P3', pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 11824 }] } },
      {
        id: 11824,
        type: 'grid_table',
        pdf_meta: { isAdditionalBlockOf: 7454 },
        rows: [{ id: 17056 }, { id: 17057 }],
      },
      { id: 7455, label: 'P4', pdf_meta: { contentBlocks: [{ type: 'grid_table', questionId: 11825 }] } },
      {
        id: 11825,
        type: 'grid_table',
        pdf_meta: { isAdditionalBlockOf: 7455 },
        rows: [{ id: 17060 }, { id: 17061 }],
      },
    ];

    expect(findSharedContentBlockQuestionIds(questions).size).toBe(0);
    expect(planSharedContentBlockRepairs(questions, findSharedContentBlockQuestionIds(questions))).toEqual([]);

    const byId = new Map(questions.map((q) => [q.id, q]));
    const tables = [7452, 11823, 11824, 11825].map((id) => byId.get(id)!);
    const values = ['ONE', 'TWO', 'THREE', 'FOUR'];

    // Unique React/state keys per table.
    const stateKeys = tables.map((t) => getGridAnswerKey(t.id, t.rows![0].id));
    expect(new Set(stateKeys).size).toBe(4);

    const answers: Record<string, Record<string, string>> = {};
    tables.forEach((t, i) => {
      const cellKey = `r${t.rows![0].id}_c0`;
      simulateGridWrite(answers, t.id, t.rows![0].id, cellKey, values[i]);
    });

    // Writing one table must not change siblings.
    tables.forEach((t, i) => {
      const cellKey = `r${t.rows![0].id}_c0`;
      expect(readMergedCell(answers, t, cellKey)).toBe(values[i]);
      tables.forEach((other, j) => {
        if (i === j) return;
        const otherKey = `r${other.rows![0].id}_c0`;
        expect(readMergedCell(answers, other, otherKey)).toBe(values[j]);
        expect(readMergedCell(answers, other, cellKey)).toBe('');
      });
    });

    // Persist → reload simulation: only serializable answer map survives.
    const reloaded = JSON.parse(JSON.stringify(answers)) as typeof answers;
    tables.forEach((t, i) => {
      const cellKey = `r${t.rows![0].id}_c0`;
      expect(readMergedCell(reloaded, t, cellKey)).toBe(values[i]);
    });

    // PDF lookup uses the same child question id + row answer key.
    const pdfLookup = tables.map((t, i) => {
      const rowId = t.rows![0].id;
      const cellKey = `r${rowId}_c0`;
      const saved = reloaded[getGridAnswerKey(t.id, rowId)];
      return { questionId: t.id, rowId, value: saved?.[cellKey] ?? '', expected: values[i] };
    });
    expect(pdfLookup.every((p) => p.value === p.expected)).toBe(true);
    expect(new Set(pdfLookup.map((p) => p.questionId)).size).toBe(4);
  });

  it('does not fall back across independent child IDs when one has no answer', () => {
    const owner: Q = {
      id: 7452,
      rows: [{ id: 8071 }],
      pdf_meta: { isAdditionalBlockOf: 7451 },
    };
    const clone: Q = {
      id: 11823,
      rows: [{ id: 17052 }],
      pdf_meta: { isAdditionalBlockOf: 7453 },
    };
    const answers: Record<string, Record<string, string>> = {};
    simulateGridWrite(answers, owner.id, 8071, 'r8071_c0', 'Test');

    expect(readMergedCell(answers, owner, 'r8071_c0')).toBe('Test');
    // Clone must stay empty — no legacy fallback to owner child's answer.
    expect(readMergedCell(answers, clone, 'r17052_c0')).toBe('');
    expect(readMergedCell(answers, clone, 'r8071_c0')).toBe('');
  });
});
