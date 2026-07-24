import { describe, expect, it } from 'vitest';
import {
  formatAssessmentValidationError,
  formatAssessmentValidationSummary,
  formatDisplayQuestionNumber,
  pickAssessmentValidationToast,
} from './assessmentValidationMessages';
import {
  describeContentBlockRequiredGaps,
  describeGridRequiredGap,
  describeSignatureRequiredGap,
  summarizeContentBlockGaps,
} from './assessmentRequiredGaps';
import { getTaskQuestionDisplayNumbers } from '../lib/taskQuestionsNumbering';
import type { FormQuestionWithOptionsAndRows } from '../lib/formEngine';

describe('formatAssessmentValidationError', () => {
  it('formats incomplete question with display number matching on-screen Qn', () => {
    expect(
      formatAssessmentValidationError({
        questionNumber: 9,
        questionTitle: 'Interim Payment Claim',
      })
    ).toBe('Q9 – Interim Payment Claim is not completed.');
    expect(formatDisplayQuestionNumber(9)).toBe('Q9');
  });

  it('formats a specific missing field', () => {
    expect(
      formatAssessmentValidationError({
        questionNumber: 9,
        questionTitle: 'Interim Payment Claim',
        fieldLabel: 'Payment Date',
        missingCount: 1,
      })
    ).toBe('Q9 – Interim Payment Claim: Payment Date is required.');
  });

  it('formats a missing table field', () => {
    expect(
      formatAssessmentValidationError({
        questionNumber: 9,
        questionTitle: 'Interim Payment Claim',
        fieldLabel: 'Table row 2, Amount',
      })
    ).toBe('Q9 – Interim Payment Claim: Table row 2, Amount is required.');
  });

  it('formats signature under parent title', () => {
    expect(
      formatAssessmentValidationError({
        questionNumber: 9,
        questionTitle: 'Assessment Declaration',
        fieldLabel: 'Student Signature',
      })
    ).toBe('Q9 – Assessment Declaration: Student Signature is required.');
  });

  it('consolidates several missing fields in one question', () => {
    expect(
      formatAssessmentValidationError({
        questionNumber: 9,
        questionTitle: 'Interim Payment Claim',
        missingCount: 3,
      })
    ).toBe('Q9 – Interim Payment Claim is not completed (3 required fields missing).');
  });

  it('omits Q prefix when no display number (non-task sections)', () => {
    expect(
      formatAssessmentValidationError({
        questionTitle: 'Assessment Declaration',
        fieldLabel: 'Student Signature',
      })
    ).toBe('Assessment Declaration: Student Signature is required.');
  });
});

describe('formatAssessmentValidationSummary / pickAssessmentValidationToast', () => {
  it('summarises several incomplete questions and points at the first', () => {
    expect(
      formatAssessmentValidationSummary({
        incompleteCount: 3,
        firstQuestionNumber: 9,
        firstQuestionTitle: 'Interim Payment Claim',
      })
    ).toBe('3 questions are incomplete. Please complete Q9 – Interim Payment Claim first.');
  });

  it('uses a single message when only one question fails', () => {
    const msg = formatAssessmentValidationError({
      questionNumber: 9,
      questionTitle: 'Interim Payment Claim',
    });
    expect(
      pickAssessmentValidationToast([
        {
          errorKey: 'q-100',
          questionId: 100,
          questionNumber: 9,
          questionTitle: 'Interim Payment Claim',
          message: msg,
        },
      ])
    ).toBe(msg);
  });
});

describe('question numbering for validation', () => {
  it('matches getTaskQuestionDisplayNumbers (skips additional blocks / instructions)', () => {
    const questions = [
      { id: 1, type: 'instruction_block' },
      { id: 10, type: 'long_text', pdf_meta: {} },
      { id: 11, type: 'grid_table', pdf_meta: { isAdditionalBlockOf: 10 } },
      { id: 12, type: 'long_text', pdf_meta: {} },
      { id: 13, type: 'page_break' },
      { id: 14, type: 'long_text', pdf_meta: {} },
    ];
    const map = getTaskQuestionDisplayNumbers(questions);
    expect(map.get(10)).toBe(1);
    expect(map.get(11)).toBeUndefined();
    expect(map.get(12)).toBe(2);
    expect(map.get(14)).toBe(3);
  });
});

describe('content-block gaps', () => {
  const parent = {
    id: 7451,
    type: 'grid_table',
    label: 'Measurement & Calculation Report',
    required: true,
    pdf_meta: {
      contentBlocks: [
        { type: 'grid_table', questionId: 7452, headerText: 'Table 1' },
        { type: 'grid_table', questionId: 11823, headerText: 'Table 2' },
      ],
    },
    rows: [],
    options: [],
  } as unknown as FormQuestionWithOptionsAndRows;

  const childA = {
    id: 7452,
    type: 'grid_table',
    label: 'Table',
    required: true,
    pdf_meta: {
      isAdditionalBlockOf: 7451,
      layout: 'no_image',
      columnsMeta: [
        { type: 'answer', label: 'Initial Calculation (Incorrect)' },
        { type: 'answer', label: 'Corrected Result' },
      ],
    },
    rows: [
      { id: 8071, row_label: '', sort_order: 0 },
      { id: 8072, row_label: '', sort_order: 1 },
    ],
    options: [],
  } as unknown as FormQuestionWithOptionsAndRows;

  const childB = {
    id: 11823,
    type: 'grid_table',
    label: 'Table',
    required: true,
    pdf_meta: {
      isAdditionalBlockOf: 7451,
      layout: 'no_image',
      columnsMeta: [
        { type: 'answer', label: 'Initial Calculation (Incorrect)' },
        { type: 'answer', label: 'Corrected Result' },
      ],
    },
    rows: [
      { id: 17052, row_label: '', sort_order: 0 },
      { id: 17053, row_label: '', sort_order: 1 },
    ],
    options: [],
  } as unknown as FormQuestionWithOptionsAndRows;

  it('validates children independently but formats with parent Q number/title', () => {
    const answers = {
      // Child A fully filled for one row across answer columns
      'q-7452-8071': { r8071_c0: 'ONE', r8071_c1: 'OK' },
    };
    const isGridFilled = (q: FormQuestionWithOptionsAndRows) => {
      if (q.id === 7452) return true;
      return false;
    };
    const gaps = describeContentBlockRequiredGaps(
      parent,
      [parent, childA, childB],
      answers,
      isGridFilled
    );
    expect(gaps.some((g) => g.childQuestionId === 11823)).toBe(true);
    expect(gaps.every((g) => g.childQuestionId !== 7452)).toBe(true);
    const summary = summarizeContentBlockGaps(gaps);
    const msg = formatAssessmentValidationError({
      questionNumber: 1,
      questionTitle: parent.label,
      fieldLabel: summary.fieldLabel,
      missingCount: summary.missingCount,
    });
    expect(msg.startsWith('Q1 – Measurement & Calculation Report')).toBe(true);
    expect(msg.includes('11823')).toBe(false);
  });
});

describe('describeGridRequiredGap / signature', () => {
  it('names the first missing table cell', () => {
    const q = {
      id: 100,
      type: 'grid_table',
      label: 'Claim',
      pdf_meta: {
        layout: 'no_image',
        columnsMeta: [
          { type: 'answer', label: 'Amount' },
          { type: 'answer', label: 'Notes' },
        ],
      },
      rows: [
        { id: 1, row_label: 'R1', sort_order: 0 },
        { id: 2, row_label: 'R2', sort_order: 1 },
      ],
      options: [],
    } as unknown as FormQuestionWithOptionsAndRows;
    const detail = describeGridRequiredGap(q, {});
    expect(detail.missingCount).toBeGreaterThan(1);
    // With many missing, field label is omitted in favor of count consolidation upstream
    expect(detail.fieldLabel).toBeNull();
  });

  it('describes student signature gap', () => {
    const q = {
      id: 50,
      type: 'signature',
      code: 'student.declarationSignature',
      label: 'Assessment Declaration',
      pdf_meta: { showDateField: true },
      rows: [],
      options: [],
    } as unknown as FormQuestionWithOptionsAndRows;
    const detail = describeSignatureRequiredGap(q, {});
    expect(detail.fieldLabel).toBeNull();
    expect(detail.missingCount).toBe(2);
    const sigOnly = describeSignatureRequiredGap(q, {
      'q-50': { date: '2026-01-01' },
    });
    expect(sigOnly).toEqual({ fieldLabel: 'Student Signature', missingCount: 1 });
  });
});

describe('hidden / non-student fields', () => {
  it('does not assign display numbers to isAdditionalBlockOf children', () => {
    const map = getTaskQuestionDisplayNumbers([
      { id: 1, type: 'long_text', pdf_meta: {} },
      { id: 2, type: 'grid_table', pdf_meta: { isAdditionalBlockOf: 1 } },
    ]);
    expect(map.get(2)).toBeUndefined();
    // Student messages must use parent number, never child id as Q number.
    expect(
      formatAssessmentValidationError({
        questionNumber: map.get(1),
        questionTitle: 'Parent',
        fieldLabel: 'Table 2 – Corrected Result',
      })
    ).toBe('Q1 – Parent: Table 2 – Corrected Result is required.');
  });
});
