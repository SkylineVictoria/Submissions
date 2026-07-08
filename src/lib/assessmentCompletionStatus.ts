import {
  updateInstanceWorkflowStatus,
  type AssessmentSummaryDataEntry,
  type FormTemplate,
  type InstanceWorkflowStatus,
  type ResultsDataEntry,
  type ResultsOfficeEntry,
} from './formEngine';
import { buildTaskResultSections, getOfficeCheckSectionIds, isOfficeCheckSetOnAnySection } from '../utils/taskResultsOutcome';

export type AssessmentCompletionEvaluation = {
  isComplete: boolean;
  newStatus: InstanceWorkflowStatus | null;
  shouldLock: boolean;
  missingFields: string[];
  validationErrors: Record<string, string>;
  updated: boolean;
};

export type EvaluateAssessmentCompletionParams = {
  instanceId: number;
  template: FormTemplate | null;
  resultsData: Record<number, ResultsDataEntry>;
  resultsOffice: Record<number, ResultsOfficeEntry>;
  assessmentSummary: AssessmentSummaryDataEntry | null;
  submissionCount: number;
  submittedAt?: string | null;
  workflowStatus: InstanceWorkflowStatus;
  roleContext?: string | null;
  studentDeclarationIso?: string;
  options?: {
    /** Admin Quick Edit: validate required fields before marking completed. */
    adminQuickEdit?: boolean;
    applyUpdate?: boolean;
  };
};

function emptyEvaluation(
  overrides: Partial<AssessmentCompletionEvaluation> = {},
): AssessmentCompletionEvaluation {
  return {
    isComplete: false,
    newStatus: null,
    shouldLock: false,
    missingFields: [],
    validationErrors: {},
    updated: false,
    ...overrides,
  };
}

/** Office Initial/Updated checks on summary + every pre-summary task results section. */
export function isOfficeAdminChecklistComplete(params: {
  template: FormTemplate | null;
  resultsData: Record<number, ResultsDataEntry>;
  resultsOffice: Record<number, ResultsOfficeEntry>;
  assessmentSummary: AssessmentSummaryDataEntry | null;
}): { complete: boolean; missingFields: string[] } {
  const { template, resultsData, resultsOffice, assessmentSummary } = params;
  const missingFields: string[] = [];
  const summary = assessmentSummary;
  if (!summary?.admin_initial_checked) {
    missingFields.push('Summary sheet: Initial check');
  }
  if (!summary?.admin_updated_checked) {
    missingFields.push('Summary sheet: Updated check');
  }

  const taskSections = buildTaskResultSections(template, resultsData);
  for (const entry of taskSections) {
    const sectionIds = getOfficeCheckSectionIds(template, entry);
    if (sectionIds.length === 0) continue;
    const label = entry.label?.trim() || `Task results (section ${entry.sectionId ?? sectionIds[0]})`;
    if (!isOfficeCheckSetOnAnySection(resultsOffice, sectionIds, 'initial_checked')) {
      missingFields.push(`${label}: Initial check`);
    }
    if (!isOfficeCheckSetOnAnySection(resultsOffice, sectionIds, 'updated_checked')) {
      missingFields.push(`${label}: Updated check`);
    }
  }

  return { complete: missingFields.length === 0, missingFields };
}

function hasStudentSubmission(submissionCount: number, submittedAt?: string | null): boolean {
  return submissionCount > 0 || Boolean(String(submittedAt ?? '').trim());
}

/** Admin Quick Edit may hand off to office when trainer stage is done but workflow not yet updated. */
export function canHandOffToOfficeQueue(params: {
  workflowStatus: InstanceWorkflowStatus;
  submissionCount: number;
  submittedAt?: string | null;
  roleContext?: string | null;
}): boolean {
  const { workflowStatus, submissionCount, submittedAt, roleContext } = params;
  if (workflowStatus === 'completed' || workflowStatus === 'failed') return false;
  if (workflowStatus === 'waiting_office') return true;
  if (!hasStudentSubmission(submissionCount, submittedAt)) return false;
  if (workflowStatus === 'waiting_trainer') return true;
  const roleCtx = String(roleContext ?? '').trim();
  if (workflowStatus === 'draft' && (roleCtx === 'trainer' || roleCtx === 'office')) return true;
  return false;
}

/**
 * Shared office completion evaluation (mirrors InstanceFillPage `checkAndAutoCompleteOffice`).
 * InstanceFillPage is unchanged; Admin Quick Edit calls this after save.
 */
export async function evaluateAndUpdateAssessmentStatus(
  params: EvaluateAssessmentCompletionParams,
): Promise<AssessmentCompletionEvaluation> {
  const {
    instanceId,
    template,
    resultsData,
    resultsOffice,
    assessmentSummary,
    submissionCount,
    submittedAt,
    workflowStatus,
    roleContext,
    options,
  } = params;
  const adminQuickEdit = options?.adminQuickEdit === true;
  const applyUpdate = options?.applyUpdate !== false;

  if (workflowStatus === 'completed' || workflowStatus === 'failed') {
    return emptyEvaluation({
      isComplete: true,
      newStatus: workflowStatus,
      shouldLock: true,
    });
  }

  const checklist = isOfficeAdminChecklistComplete({
    template,
    resultsData,
    resultsOffice,
    assessmentSummary,
  });
  if (!checklist.complete) {
    return emptyEvaluation({ missingFields: checklist.missingFields });
  }

  let readyForCompletion = workflowStatus === 'waiting_office';
  if (!readyForCompletion) {
    const canHandOff = canHandOffToOfficeQueue({
      workflowStatus,
      submissionCount,
      submittedAt,
      roleContext,
    });
    if (!canHandOff) {
      return emptyEvaluation({
        missingFields: [
          'Assessment must be in Waiting Office stage before it can be finalised (student submit and trainer review required)',
        ],
      });
    }
    if (adminQuickEdit && applyUpdate) {
      await updateInstanceWorkflowStatus(instanceId, 'waiting_office');
    }
    readyForCompletion = true;
  }

  if (!readyForCompletion) {
    return emptyEvaluation({
      missingFields: ['Assessment must be in Waiting Office stage before it can be finalised'],
    });
  }

  if (!applyUpdate) {
    return emptyEvaluation({
      isComplete: true,
      newStatus: 'completed',
      shouldLock: true,
    });
  }

  await updateInstanceWorkflowStatus(instanceId, 'completed');
  return emptyEvaluation({
    isComplete: true,
    newStatus: 'completed',
    shouldLock: true,
    updated: true,
  });
}

/** Alias requested in task spec. */
export const recalculateAssessmentCompletionStatus = evaluateAndUpdateAssessmentStatus;
