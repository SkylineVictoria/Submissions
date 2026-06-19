export type NotificationOutcomeKind = 'passed' | 'failed' | 'missed' | 'resubmit' | 'update' | 'general';

export interface NotificationOutcomeVisual {
  kind: NotificationOutcomeKind;
  label: string;
  badgeClass: string;
  iconClass: string;
}

const OUTCOME_VISUALS: Record<NotificationOutcomeKind, NotificationOutcomeVisual> = {
  passed: {
    kind: 'passed',
    label: 'Passed',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    iconClass: 'text-emerald-600',
  },
  failed: {
    kind: 'failed',
    label: 'Failed',
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
    iconClass: 'text-red-600',
  },
  missed: {
    kind: 'missed',
    label: 'Missed',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-200',
    iconClass: 'text-amber-600',
  },
  resubmit: {
    kind: 'resubmit',
    label: 'Resubmit',
    badgeClass: 'bg-orange-100 text-orange-900 border-orange-200',
    iconClass: 'text-orange-600',
  },
  update: {
    kind: 'update',
    label: 'Update',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    iconClass: 'text-sky-600',
  },
  general: {
    kind: 'general',
    label: 'Notice',
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
    iconClass: 'text-gray-500',
  },
};

export function getNotificationOutcomeVisual(
  type: string,
  title: string,
  message: string
): NotificationOutcomeVisual {
  const t = String(type ?? '').trim().toLowerCase();
  const blob = `${title} ${message}`.toLowerCase();

  if (t === 'workflow_completed' || blob.includes('finalised') || blob.includes('competent')) {
    return OUTCOME_VISUALS.passed;
  }
  if (t === 'workflow_failed' || blob.includes('not competent after 3') || blob.includes('recorded as not competent')) {
    return OUTCOME_VISUALS.failed;
  }
  if (
    t.includes('missed') ||
    blob.includes("didn't attempt") ||
    blob.includes('did not attempt') ||
    blob.includes('missed attempt') ||
    blob.includes('missed 1st') ||
    blob.includes('missed 2nd') ||
    blob.includes('missed 3rd')
  ) {
    return OUTCOME_VISUALS.missed;
  }
  if (t === 'workflow_resubmit' || blob.includes('resubmission') || blob.includes('not yet competent')) {
    return OUTCOME_VISUALS.resubmit;
  }
  if (
    t === 'workflow_student_submit' ||
    t === 'workflow_to_office' ||
    t.startsWith('workflow_')
  ) {
    return OUTCOME_VISUALS.update;
  }

  return OUTCOME_VISUALS.general;
}

export function getAssessmentStatusVisual(input: {
  label: string;
  className?: string;
}): NotificationOutcomeVisual {
  const label = input.label.toLowerCase();
  if (label.includes('competent') && !label.includes('not yet')) {
    return OUTCOME_VISUALS.passed;
  }
  if (
    label.includes('failed') ||
    label.includes("didn't attempt") ||
    label.includes('did not attempt') ||
    label.includes('not competent after')
  ) {
    return OUTCOME_VISUALS.failed;
  }
  if (label.includes('missed')) {
    return OUTCOME_VISUALS.missed;
  }
  if (label.includes('not yet competent') || label.includes('in progress') || label.includes('awaiting')) {
    return OUTCOME_VISUALS.resubmit;
  }
  return OUTCOME_VISUALS.update;
}
