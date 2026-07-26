/** Shared helpers for assessment task step identity (labels, duplicate detection). */

export const ASSESSMENT_TASK_LABEL_RE = /Assessment\s+Task\s*-?\s*(\d+)/i;

/** Match default-style labels, capturing prefix / number / optional suffix (custom title). */
const ASSESSMENT_TASK_LABEL_PARTS_RE = /^(Assessment\s+Task\s*-?\s*)(\d+)(.*)$/i;

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

/**
 * On form duplication, assessment task labels must be preserved as cloned from the source.
 * They are LOCAL to the form — never renumbered from max(task#) inside the new copy
 * (that incorrectly produced Task 3/4, 5/6, … across successive duplicates).
 */
export function preserveAssessmentTaskLabelsOnFormDuplicate(
  sourceLabels: string[]
): string[] {
  return sourceLabels.map((l) => String(l ?? ''));
}

export type AssessmentTaskLabelRow = {
  id: number;
  row_label: string;
  sort_order: number;
};

export type AssessmentTaskLabelRepairPlan = {
  id: number;
  from: string;
  to: string;
};

/**
 * Plan a form-scoped repair for default "Assessment Task N" labels.
 * Orders by sort_order and renumbers matching labels to 1..N within THIS form only.
 * Preserves custom suffixes (e.g. "Assessment Task - 3 – Written Questions" → "… - 1 – Written Questions").
 * Leaves fully custom titles (no Assessment Task N pattern) unchanged.
 */
export function planFormScopedAssessmentTaskLabelRepair(
  rows: AssessmentTaskLabelRow[]
): AssessmentTaskLabelRepairPlan[] {
  const ordered = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  const plans: AssessmentTaskLabelRepairPlan[] = [];
  let nextNum = 0;
  for (const row of ordered) {
    const label = String(row.row_label ?? '');
    const parts = label.match(ASSESSMENT_TASK_LABEL_PARTS_RE);
    if (!parts) continue;
    nextNum += 1;
    const to = `${parts[1]}${nextNum}${parts[3]}`;
    if (to !== label) {
      plans.push({ id: row.id, from: label, to });
    }
  }
  return plans;
}

/**
 * Legacy incorrect duplicate behaviour (documented for regression tests):
 * take max task number in the cloned rows, then rewrite to max+1, max+2, …
 * That must NEVER run on form duplicate.
 */
export function legacyIncorrectDuplicateRenumberLabels(labels: string[]): string[] {
  let maxNum = 0;
  for (const label of labels) {
    const m = label?.match(ASSESSMENT_TASK_LABEL_RE);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const startNew = maxNum + 1;
  return labels.map((_, i) => `Assessment Task - ${startNew + i}`);
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
