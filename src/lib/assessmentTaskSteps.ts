/** Shared helpers for assessment task step identity (labels, duplicate detection). */

export const ASSESSMENT_TASK_LABEL_RE = /Assessment\s+Task\s*-?\s*(\d+)/i;

export function nextAssessmentTaskNumber(labels: string[]): number {
  let maxNum = 0;
  for (const label of labels) {
    const m = label?.match(ASSESSMENT_TASK_LABEL_RE);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  return maxNum + 1;
}

export function nextAssessmentTaskLabel(labels: string[]): string {
  return `Assessment Task - ${nextAssessmentTaskNumber(labels)}`;
}

export interface AssessmentTaskStepLink {
  stepId: number;
  rowId: number;
  title: string;
  sortOrder: number;
}

export interface DuplicateAssessmentTaskStepGroup {
  formId: number;
  assessmentTaskRowId: number;
  stepIds: number[];
  title: string;
  sortOrders: number[];
}

/** Groups steps that share the same assessment_task_row_id (true duplicates). */
export function findDuplicateAssessmentTaskStepsByRowId(
  formId: number,
  links: AssessmentTaskStepLink[],
): DuplicateAssessmentTaskStepGroup[] {
  const byRow = new Map<number, AssessmentTaskStepLink[]>();
  for (const link of links) {
    if (!Number.isFinite(link.rowId) || link.rowId <= 0) continue;
    const list = byRow.get(link.rowId) ?? [];
    list.push(link);
    byRow.set(link.rowId, list);
  }
  const duplicates: DuplicateAssessmentTaskStepGroup[] = [];
  for (const [rowId, group] of byRow) {
    const uniqueStepIds = [...new Set(group.map((g) => g.stepId))];
    if (uniqueStepIds.length <= 1) continue;
    duplicates.push({
      formId,
      assessmentTaskRowId: rowId,
      stepIds: uniqueStepIds,
      title: group[0]?.title ?? '',
      sortOrders: group.map((g) => g.sortOrder),
    });
  }
  return duplicates;
}
