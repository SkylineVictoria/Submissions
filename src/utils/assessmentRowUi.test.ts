import { describe, expect, it } from 'vitest';
import {
  computeAttemptTones,
  computeRowUi,
  getInstanceWorkflowLabel,
  getMissedAttemptIndexes,
  getMissedAttemptWindowText,
  getStudentAttemptDoneText,
  hasStudentSubmissionNotSentToTrainer,
  isDidNotAttemptAnyFailure,
  isTerminalFailureProgressRow,
} from './assessmentRowUi';

describe('isDidNotAttemptAnyFailure', () => {
  it('requires did_not_attempt and rollovers >= 2', () => {
    expect(isDidNotAttemptAnyFailure({ didNotAttempt: true, noAttemptRollovers: 2 })).toBe(true);
    expect(isDidNotAttemptAnyFailure({ didNotAttempt: true, noAttemptRollovers: 1 })).toBe(false);
    expect(isDidNotAttemptAnyFailure({ didNotAttempt: false, noAttemptRollovers: 2 })).toBe(false);
  });
});

describe('isTerminalFailureProgressRow', () => {
  it('does not treat did_not_attempt alone as terminal', () => {
    expect(isTerminalFailureProgressRow({ did_not_attempt: true, no_attempt_rollovers: 1 })).toBe(false);
    expect(isTerminalFailureProgressRow({ did_not_attempt: true, no_attempt_rollovers: 2 })).toBe(true);
  });
});

describe('getMissedAttemptWindowText', () => {
  it('shows specific missed text for partial rollovers', () => {
    expect(getMissedAttemptWindowText({ noAttemptRollovers: 1, didNotAttempt: false })).toBe('Missed 1st attempt');
    expect(getMissedAttemptWindowText({ noAttemptRollovers: 2, didNotAttempt: false })).toBe(
      'Missed 1st attempt, 2nd attempt',
    );
    expect(getMissedAttemptWindowText({ noAttemptRollovers: 2, didNotAttempt: true })).toBe("Didn't attempt any");
  });
});

describe('computeRowUi terminal state', () => {
  it('only marks terminal when all windows missed', () => {
    const partial = computeRowUi({
      row: { did_not_attempt: true, no_attempt_rollovers: 1, status: 'draft', role_context: 'student' },
      submissionCount: 0,
    });
    expect(partial.kind).toBe('in_progress');

    const terminal = computeRowUi({
      row: { did_not_attempt: true, no_attempt_rollovers: 2, status: 'locked', role_context: 'office' },
      submissionCount: 0,
    });
    expect(terminal.kind).toBe('did_not_attempt');
    expect(terminal.outcomeLabel).toBe("Didn't attempt any");
  });

  it('returns in-progress after reset-like row state', () => {
    const reset = computeRowUi({
      row: {
        did_not_attempt: false,
        no_attempt_rollovers: 0,
        status: 'draft',
        role_context: 'student',
        start_date: '2020-01-01',
        end_date: '2030-12-31',
      },
      submissionCount: 0,
    });
    expect(reset.kind).toBe('in_progress');
    expect(reset.rowClassName).not.toContain('cursor-not-allowed');
  });
});

describe('getMissedAttemptIndexes', () => {
  it('maps rollovers and terminal flag to slots', () => {
    expect([...getMissedAttemptIndexes({ no_attempt_rollovers: 0, did_not_attempt: false })]).toEqual([]);
    expect([...getMissedAttemptIndexes({ no_attempt_rollovers: 1, did_not_attempt: false })]).toEqual([0]);
    expect([...getMissedAttemptIndexes({ no_attempt_rollovers: 2, did_not_attempt: true })]).toEqual([0, 1, 2]);
  });
});

describe('computeAttemptTones', () => {
  const studentTones = (input: Parameters<typeof computeAttemptTones>[0]) => computeAttemptTones(input).student;
  const trainerTones = (input: Parameters<typeof computeAttemptTones>[0]) => computeAttemptTones(input).trainer;
  const tones = studentTones;

  it('trainer dots stay gray when submission exists but handoff to trainer never happened', () => {
    expect(
      trainerTones({
        submissionCount: 1,
        results: [null, null, null],
        no_attempt_rollovers: 0,
        did_not_attempt: false,
        role_context: 'student',
        status: 'draft',
      }),
    ).toEqual(['gray', 'gray', 'gray']);
    expect(
      studentTones({
        submissionCount: 1,
        results: [null, null, null],
        no_attempt_rollovers: 0,
        did_not_attempt: false,
        role_context: 'student',
        status: 'draft',
      }),
    ).toEqual(['gray', 'gray', 'gray']);
  });

  it('labels stuck handoff as submitted not sent', () => {
    expect(
      hasStudentSubmissionNotSentToTrainer({
        status: 'draft',
        role_context: 'student',
        submission_count: 1,
      }),
    ).toBe(true);
    expect(
      getInstanceWorkflowLabel({
        status: 'draft',
        role_context: 'student',
        submission_count: 1,
      }),
    ).toBe('Submitted (Not Sent)');
  });

  it('Case A: clean start', () => {
    expect(
      tones({
        submissionCount: 0,
        results: [null, null, null],
        no_attempt_rollovers: 0,
        did_not_attempt: false,
        role_context: 'student',
        status: 'draft',
      }),
    ).toEqual(['yellow', 'gray', 'gray']);
  });

  it('Case B: attempt 1 missed, on attempt 2', () => {
    expect(
      tones({
        submissionCount: 0,
        results: [null, null, null],
        no_attempt_rollovers: 1,
        did_not_attempt: false,
        role_context: 'student',
        status: 'draft',
      }),
    ).toEqual(['red', 'yellow', 'gray']);
  });

  it('Case C: attempt 1 missed, attempt 2 submitted awaiting trainer', () => {
    expect(
      tones({
        submissionCount: 1,
        results: [null, null, null],
        no_attempt_rollovers: 1,
        did_not_attempt: false,
        role_context: 'trainer',
        status: 'submitted',
      }),
    ).toEqual(['red', 'yellow', 'gray']);
  });

  it('Case D: attempt 1 missed, attempt 2 NYC, attempt 3 available', () => {
    expect(
      tones({
        submissionCount: 1,
        results: [null, 'not_yet_competent', null],
        no_attempt_rollovers: 1,
        did_not_attempt: false,
        role_context: 'student',
        status: 'draft',
      }),
    ).toEqual(['red', 'red', 'yellow']);
  });

  it('Case E: attempt 1 submitted awaiting trainer', () => {
    expect(
      tones({
        submissionCount: 1,
        results: [null, null, null],
        no_attempt_rollovers: 0,
        did_not_attempt: false,
        role_context: 'trainer',
        status: 'submitted',
      }),
    ).toEqual(['yellow', 'gray', 'gray']);
  });

  it('Case F: all three windows missed', () => {
    expect(
      tones({
        submissionCount: 0,
        results: [null, null, null],
        terminalDidNotAttempt: true,
      }),
    ).toEqual(['red', 'red', 'red']);
  });

  it('after reset: attempt 1 available', () => {
    expect(
      tones({
        submissionCount: 0,
        results: [null, null, null],
        no_attempt_rollovers: 0,
        did_not_attempt: false,
        role_context: 'student',
        status: 'draft',
      }),
    ).toEqual(['yellow', 'gray', 'gray']);
  });
});

describe('getStudentAttemptDoneText with rollovers', () => {
  it('maps awaiting trainer to actual attempt slot after missed window', () => {
    const text = getStudentAttemptDoneText({
      submissionCount: 1,
      attemptResults: [null, null, null],
      role_context: 'trainer',
      status: 'submitted',
      no_attempt_rollovers: 1,
      did_not_attempt: false,
    });
    expect(text).toBe('Submitted 2nd attempt — awaiting trainer');
  });
});
