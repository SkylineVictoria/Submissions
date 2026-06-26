import { describe, expect, it } from 'vitest';
import {
  mergeFormAnswersPreservingExisting,
  mergeSaveValuePreservingExisting,
} from './formAnswerMerge';
import {
  buildIdentityBackfillPlan,
  buildIdentityHydrationUpdates,
  detectAffectedIdentityInstance,
  getMissingIdentityFields,
} from './identityFieldRepair';

describe('mergeFormAnswersPreservingExisting', () => {
  it('preserves existing page 1 values when page 2 save sends empty keys', () => {
    const existing = {
      'q-1': 'Aaron Binu',
      'q-2': '13103383',
    };
    const incoming = {
      'q-3': 'answer on page 2',
      'q-1': '',
      'q-2': null,
    };
    const merged = mergeFormAnswersPreservingExisting(existing, incoming, { source: 'next' });
    expect(merged['q-1']).toBe('Aaron Binu');
    expect(merged['q-2']).toBe('13103383');
    expect(merged['q-3']).toBe('answer on page 2');
  });

  it('allows explicit clear when key is in clearAllowedKeys', () => {
    const merged = mergeFormAnswersPreservingExisting(
      { 'q-1': 'keep unless cleared' },
      { 'q-1': '' },
      { clearAllowedKeys: ['q-1'] },
    );
    expect(merged['q-1']).toBe('');
  });
});

describe('mergeSaveValuePreservingExisting', () => {
  it('does not wipe existing text with empty incoming save', () => {
    const merged = mergeSaveValuePreservingExisting(
      { text: 'Aaron Binu', number: null, json: null },
      { text: '' },
    );
    expect(merged.text).toBe('Aaron Binu');
  });

  it('updates when incoming has new non-empty text', () => {
    const merged = mergeSaveValuePreservingExisting(
      { text: 'old', number: null, json: null },
      { text: 'new' },
    );
    expect(merged.text).toBe('new');
  });
});

describe('detectAffectedIdentityInstance', () => {
  it('finds 8741-style broken data with signature and answers but missing identity', () => {
    const affected = detectAffectedIdentityInstance({
      instanceId: 8741,
      studentId: 552,
      submissionCount: 1,
      submittedAt: '2026-06-18T06:59:02Z',
      hasStudentSignature: true,
      hasQuestionAnswers: true,
      identityValues: {
        'student.fullName': null,
        'student.id': null,
        'student.email': null,
        'trainer.fullName': null,
      },
    });
    expect(affected?.instanceId).toBe(8741);
    expect(affected?.missingFields).toEqual([
      'student.fullName',
      'student.id',
      'student.email',
      'trainer.fullName',
    ]);
  });

  it('ignores clean instances with all identity fields present', () => {
    const affected = detectAffectedIdentityInstance({
      instanceId: 8744,
      submissionCount: 1,
      hasStudentSignature: true,
      identityValues: {
        'student.fullName': 'Aaron Binu',
        'student.id': '13103383',
        'student.email': '13103383@student.slit.edu.au',
        'trainer.fullName': 'Mashhood rasul',
      },
    });
    expect(affected).toBeNull();
  });
});

describe('buildIdentityBackfillPlan', () => {
  it('only backfills missing fields and never overwrites existing', () => {
    const plan = buildIdentityBackfillPlan({
      instanceId: 8741,
      questions: [
        { code: 'student.fullName', questionId: 4013 },
        { code: 'student.id', questionId: 4014 },
        { code: 'student.email', questionId: 4015 },
        { code: 'trainer.fullName', questionId: 4016 },
      ],
      currentValues: {
        'student.fullName': null,
        'student.id': '13103383',
        'student.email': null,
        'trainer.fullName': null,
      },
      sources: {
        'student.fullName': 'AARON BINU',
        'student.id': '13103383',
        'student.email': '13103383@student.slit.edu.au',
        'trainer.fullName': 'Mashhood Rasul',
      },
    });
    expect(plan?.updates.map((u) => u.code)).toEqual(['student.fullName', 'student.email', 'trainer.fullName']);
  });

  it('supports bulk repair for multiple instances independently', () => {
    const plans = [8741, 8744].map((instanceId) =>
      buildIdentityBackfillPlan({
        instanceId,
        questions: [
          { code: 'student.fullName', questionId: 100 + instanceId },
          { code: 'student.email', questionId: 200 + instanceId },
        ],
        currentValues: { 'student.fullName': null, 'student.email': null },
        sources: {
          'student.fullName': 'Aaron Binu',
          'student.email': '13103383@student.slit.edu.au',
        },
      }),
    );
    expect(plans.every((p) => (p?.updates.length ?? 0) > 0)).toBe(true);
  });
});

describe('buildIdentityHydrationUpdates', () => {
  it('hydrates only empty saved fields before validation', () => {
    const updates = buildIdentityHydrationUpdates({
      questions: [
        { code: 'student.fullName', questionId: 10 },
        { code: 'student.email', questionId: 12 },
      ],
      currentAnswers: { 'q-10': '', 'q-12': 'existing@email.com' },
      sources: {
        'student.fullName': 'Aaron Binu',
        'student.email': '13103383@student.slit.edu.au',
      },
      getAnswerKey: (questionId) => `q-${questionId}`,
    });
    expect(updates).toEqual([{ questionId: 10, code: 'student.fullName', value: 'Aaron Binu' }]);
  });
});

describe('getMissingIdentityFields', () => {
  it('returns partial missing list for non-terminal missed attempts style check', () => {
    expect(
      getMissingIdentityFields({
        'student.fullName': 'Aaron',
        'student.id': null,
        'student.email': 'a@b.com',
        'trainer.fullName': '',
      }),
    ).toEqual(['student.id', 'trainer.fullName']);
  });
});

describe('attempt reset preservation', () => {
  it('merge allows clearing attempt result keys while preserving identity answers', () => {
    const merged = mergeFormAnswersPreservingExisting(
      {
        'q-student-fullName': 'Aaron Binu',
        'q-attempt-1-result': 'not_yet_competent',
      },
      {
        'q-attempt-1-result': '',
      },
      { clearAllowedKeys: ['q-attempt-1-result'], source: 'attempt-reset' },
    );
    expect(merged['q-student-fullName']).toBe('Aaron Binu');
    expect(merged['q-attempt-1-result']).toBe('');
  });
});
