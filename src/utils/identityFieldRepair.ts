import { isEmptyFormValue } from './formAnswerMerge';

export const IDENTITY_FIELD_CODES = [
  'student.fullName',
  'student.id',
  'student.email',
  'trainer.fullName',
] as const;

export type IdentityFieldCode = (typeof IDENTITY_FIELD_CODES)[number];

export type IdentityFieldValues = Partial<Record<IdentityFieldCode, string | null>>;

export type IdentityQuestionRef = {
  code: IdentityFieldCode;
  questionId: number;
};

export type InstanceAttemptEvidence = {
  submissionCount?: number | null;
  submittedAt?: string | null;
  hasStudentSignature?: boolean;
  hasQuestionAnswers?: boolean;
};

export type AffectedIdentityInstance = {
  instanceId: number;
  studentId: number | null;
  formId: number | null;
  profileName: string | null;
  profileEmail: string | null;
  profileStudentCode: string | null;
  trainerName: string | null;
  submissionCount: number;
  submittedAt: string | null;
  status: string | null;
  roleContext: string | null;
  hasStudentSignature: boolean;
  hasQuestionAnswers: boolean;
  identityValues: IdentityFieldValues;
  missingFields: IdentityFieldCode[];
};

export type IdentityBackfillPlan = {
  instanceId: number;
  updates: Array<{ questionId: number; code: IdentityFieldCode; value: string }>;
};

export function hasAttemptEvidence(input: InstanceAttemptEvidence): boolean {
  return (
    Number(input.submissionCount ?? 0) > 0 ||
    Boolean(String(input.submittedAt ?? '').trim()) ||
    Boolean(input.hasStudentSignature) ||
    Boolean(input.hasQuestionAnswers)
  );
}

export function getMissingIdentityFields(values: IdentityFieldValues): IdentityFieldCode[] {
  return IDENTITY_FIELD_CODES.filter((code) => isEmptyFormValue(values[code]));
}

export function detectAffectedIdentityInstance(input: {
  instanceId: number;
  studentId?: number | null;
  formId?: number | null;
  profileName?: string | null;
  profileEmail?: string | null;
  profileStudentCode?: string | null;
  trainerName?: string | null;
  submissionCount?: number | null;
  submittedAt?: string | null;
  status?: string | null;
  roleContext?: string | null;
  hasStudentSignature?: boolean;
  hasQuestionAnswers?: boolean;
  identityValues: IdentityFieldValues;
}): AffectedIdentityInstance | null {
  if (
    !hasAttemptEvidence({
      submissionCount: input.submissionCount,
      submittedAt: input.submittedAt,
      hasStudentSignature: input.hasStudentSignature,
      hasQuestionAnswers: input.hasQuestionAnswers,
    })
  ) {
    return null;
  }

  const missingFields = getMissingIdentityFields(input.identityValues);
  if (missingFields.length === 0) return null;

  return {
    instanceId: input.instanceId,
    studentId: input.studentId ?? null,
    formId: input.formId ?? null,
    profileName: input.profileName ?? null,
    profileEmail: input.profileEmail ?? null,
    profileStudentCode: input.profileStudentCode ?? null,
    trainerName: input.trainerName ?? null,
    submissionCount: Number(input.submissionCount ?? 0) || 0,
    submittedAt: input.submittedAt ?? null,
    status: input.status ?? null,
    roleContext: input.roleContext ?? null,
    hasStudentSignature: Boolean(input.hasStudentSignature),
    hasQuestionAnswers: Boolean(input.hasQuestionAnswers),
    identityValues: input.identityValues,
    missingFields,
  };
}

function formatStudentDisplayName(profileName?: string | null, firstName?: string | null, lastName?: string | null): string | null {
  const fromParts = [firstName, lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ').trim();
  const name = String(profileName ?? '').trim() || fromParts;
  return name || null;
}

export function buildIdentitySourceValues(input: {
  profileName?: string | null;
  profileFirstName?: string | null;
  profileLastName?: string | null;
  profileEmail?: string | null;
  profileStudentCode?: string | null;
  trainerName?: string | null;
  resultsStudentName?: string | null;
  resultsTrainerName?: string | null;
}): IdentityFieldValues {
  const studentName =
    formatStudentDisplayName(input.profileName, input.profileFirstName, input.profileLastName) ||
    String(input.resultsStudentName ?? '').trim() ||
    null;

  return {
    'student.fullName': studentName,
    'student.id': String(input.profileStudentCode ?? '').trim() || null,
    'student.email': String(input.profileEmail ?? '').trim() || null,
    'trainer.fullName':
      String(input.trainerName ?? '').trim() || String(input.resultsTrainerName ?? '').trim() || null,
  };
}

export function buildIdentityBackfillPlan(input: {
  instanceId: number;
  questions: IdentityQuestionRef[];
  currentValues: IdentityFieldValues;
  sources: IdentityFieldValues;
}): IdentityBackfillPlan | null {
  const updates: IdentityBackfillPlan['updates'] = [];

  for (const q of input.questions) {
    const current = input.currentValues[q.code];
    if (!isEmptyFormValue(current)) continue;
    const source = input.sources[q.code];
    if (isEmptyFormValue(source)) continue;
    updates.push({ questionId: q.questionId, code: q.code, value: String(source).trim() });
  }

  if (updates.length === 0) return null;
  return { instanceId: input.instanceId, updates };
}

export function buildIdentityHydrationUpdates(input: {
  questions: IdentityQuestionRef[];
  currentAnswers: Record<string, string | number | boolean | Record<string, unknown> | string[] | null | undefined>;
  sources: IdentityFieldValues;
  getAnswerKey: (questionId: number) => string;
}): Array<{ questionId: number; code: IdentityFieldCode; value: string }> {
  const updates: Array<{ questionId: number; code: IdentityFieldCode; value: string }> = [];
  for (const q of input.questions) {
    const key = input.getAnswerKey(q.questionId);
    const current = input.currentAnswers[key];
    if (!isEmptyFormValue(current)) continue;
    const source = input.sources[q.code];
    if (isEmptyFormValue(source)) continue;
    updates.push({ questionId: q.questionId, code: q.code, value: String(source).trim() });
  }
  return updates;
}
