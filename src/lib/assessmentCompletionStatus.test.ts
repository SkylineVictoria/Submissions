import { describe, expect, it } from 'vitest';
import { canHandOffToOfficeQueue, isOfficeAdminChecklistComplete } from '../lib/assessmentCompletionStatus';
import type { AssessmentSummaryDataEntry, FormTemplate, ResultsDataEntry, ResultsOfficeEntry } from '../lib/formEngine';

const templateWithDuplicateResults = {
  steps: [
    {
      id: 1,
      title: 'Task 1',
      sections: [
        {
          id: 10,
          title: 'Results A',
          pdf_render_mode: 'task_results',
          assessment_task_row_id: 100,
          questions: [],
        },
        {
          id: 11,
          title: 'Results B',
          pdf_render_mode: 'task_results',
          assessment_task_row_id: 100,
          questions: [],
        },
        {
          id: 12,
          title: 'Tasks',
          pdf_render_mode: 'assessment_tasks',
          questions: [{ id: 1, type: 'grid_table', rows: [{ id: 100, row_label: 'Assessment Task - 1' }] }],
        },
      ],
    },
    {
      id: 2,
      title: 'Assessment Summary',
      sections: [{ id: 20, title: 'Summary', pdf_render_mode: 'assessment_summary', questions: [] }],
    },
  ],
} as unknown as FormTemplate;

const template = {
  steps: [
    {
      id: 1,
      title: 'Task 1',
      sections: [{ id: 10, title: 'Results', pdf_render_mode: 'task_results', questions: [] }],
    },
    {
      id: 2,
      title: 'Assessment Summary',
      sections: [{ id: 20, title: 'Summary', pdf_render_mode: 'assessment_summary', questions: [] }],
    },
  ],
} as unknown as FormTemplate;

const resultsData: Record<number, ResultsDataEntry> = {
  10: {
    section_id: 10,
    first_attempt_satisfactory: 's',
    first_attempt_date: '2026-01-10',
    first_attempt_feedback: null,
    second_attempt_satisfactory: null,
    second_attempt_date: null,
    second_attempt_feedback: null,
    third_attempt_satisfactory: null,
    third_attempt_date: null,
    third_attempt_feedback: null,
    student_name: 'Student',
    student_signature: 'signed',
    trainer_name: 'Trainer',
    trainer_signature: 'signed',
    trainer_date: '2026-01-11',
  },
};

const assessmentSummary: AssessmentSummaryDataEntry = {
  start_date: null,
  end_date: null,
  final_attempt_1_result: 'competent',
  final_attempt_2_result: null,
  final_attempt_3_result: null,
  trainer_sig_1: 'signed',
  trainer_date_1: '2026-01-11',
  trainer_sig_2: null,
  trainer_date_2: null,
  trainer_sig_3: null,
  trainer_date_3: null,
  student_sig_1: 'signed',
  student_date_1: '2026-01-10',
  student_sig_2: null,
  student_date_2: null,
  student_sig_3: null,
  student_date_3: null,
  student_overall_feedback: null,
  admin_initials: 'AB',
  admin_initial_checked: true,
  admin_updated_checked: true,
};

const resultsOffice: Record<number, ResultsOfficeEntry> = {
  10: {
    section_id: 10,
    entered_date: null,
    entered_by: null,
    initial_checked: true,
    updated_checked: true,
  },
};

describe('assessmentCompletionStatus', () => {
  it('detects complete office checklist', () => {
    const res = isOfficeAdminChecklistComplete({
      template,
      resultsData,
      resultsOffice,
      assessmentSummary,
    });
    expect(res.complete).toBe(true);
    expect(res.missingFields).toEqual([]);
  });

  it('flags missing office checks', () => {
    const res = isOfficeAdminChecklistComplete({
      template,
      resultsData,
      resultsOffice: {
        10: { ...resultsOffice[10], updated_checked: false },
      },
      assessmentSummary,
    });
    expect(res.complete).toBe(false);
    expect(res.missingFields.some((m) => m.includes('Updated check'))).toBe(true);
  });

  it('requires summary admin checks, not just initials', () => {
    const res = isOfficeAdminChecklistComplete({
      template,
      resultsData,
      resultsOffice,
      assessmentSummary: {
        ...assessmentSummary,
        admin_initials: 'AB',
        admin_initial_checked: false,
        admin_updated_checked: false,
      },
    });
    expect(res.complete).toBe(false);
    expect(res.missingFields).toContain('Summary sheet: Initial check');
    expect(res.missingFields).toContain('Summary sheet: Updated check');
  });

  it('allows handoff from waiting_trainer when student has submitted', () => {
    expect(
      canHandOffToOfficeQueue({
        workflowStatus: 'waiting_trainer',
        submissionCount: 1,
        submittedAt: '2026-01-01T00:00:00Z',
        roleContext: 'trainer',
      }),
    ).toBe(true);
  });

  it('blocks handoff when student has not submitted', () => {
    expect(
      canHandOffToOfficeQueue({
        workflowStatus: 'waiting_trainer',
        submissionCount: 0,
        submittedAt: null,
        roleContext: 'trainer',
      }),
    ).toBe(false);
  });

  it('accepts office checks on any duplicate task_results section for the same task row', () => {
    const resultsData: Record<number, ResultsDataEntry> = {
      10: { section_id: 10, first_attempt_satisfactory: 's', first_attempt_date: '2026-01-01' } as ResultsDataEntry,
      11: { section_id: 11, first_attempt_satisfactory: 's', first_attempt_date: '2026-01-02' } as ResultsDataEntry,
    };
    const resultsOffice: Record<number, ResultsOfficeEntry> = {
      10: {
        section_id: 10,
        entered_date: null,
        entered_by: null,
        initial_checked: true,
        updated_checked: false,
      },
      11: {
        section_id: 11,
        entered_date: null,
        entered_by: null,
        initial_checked: false,
        updated_checked: true,
      },
    };
    const res = isOfficeAdminChecklistComplete({
      template: templateWithDuplicateResults,
      resultsData,
      resultsOffice,
      assessmentSummary,
    });
    expect(res.complete).toBe(true);
  });
});
