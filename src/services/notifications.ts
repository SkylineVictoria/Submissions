import { supabase } from '../lib/supabase';
import {
  dedupeSupabaseRead,
  recordSupabaseError,
  SupabaseBackoffError,
} from '../lib/supabaseRequestGuard';
import {
  fetchAssessmentSummaries,
  listStudentAssessmentsPaged,
} from '../lib/formEngine';
import {
  getAssessmentOutcomeDisplay,
  getMissedAttemptWindowText,
  type AttemptResult,
} from '../utils/assessmentRowUi';
import {
  getAssessmentStatusVisual,
  getNotificationOutcomeVisual,
  type NotificationOutcomeKind,
} from '../utils/notificationOutcome';

export type NotificationRecord = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  url: string | null;
  type: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

export type PendingAssessmentAck = {
  instanceId: number;
  formName: string;
  statusLabel: string;
  missedText: string | null;
  outcomeKind: NotificationOutcomeKind;
};

export type NotificationBellData = {
  rows: NotificationRecord[];
  unreadCount: number;
};

/** Single lightweight read for the notification bell (no HEAD count, no polling). */
export async function fetchNotificationBellData(
  userId: string,
  options?: { accurateUnread?: boolean; skipCache?: boolean }
): Promise<NotificationBellData> {
  const uid = String(userId ?? '').trim();
  if (!uid) return { rows: [], unreadCount: 0 };

  const cacheKey = `skyline_notifications:bell:${uid}:${options?.accurateUnread ? 'full' : 'recent'}`;
  try {
    return await dedupeSupabaseRead(
      cacheKey,
      options?.skipCache ? 0 : 30_000,
      async () => {
        const { data, error } = await supabase
          .from('skyline_notifications')
          .select('id,user_id,title,message,url,type,is_read,created_at,read_at')
          .eq('user_id', uid)
          .order('created_at', { ascending: false })
          .limit(10);
        if (error) {
          recordSupabaseError('skyline_notifications', error);
          throw new Error(error.message);
        }
        const rows = ((data as NotificationRecord[] | null) ?? []) as NotificationRecord[];
        let unreadCount = rows.filter((r) => !r.is_read).length;
        if (options?.accurateUnread) {
          const { data: unreadRows, error: unreadErr } = await supabase
            .from('skyline_notifications')
            .select('id')
            .eq('user_id', uid)
            .eq('is_read', false)
            .limit(100);
          if (unreadErr) {
            recordSupabaseError('skyline_notifications', unreadErr);
          } else {
            unreadCount = unreadRows?.length ?? unreadCount;
          }
        }
        return { rows, unreadCount };
      },
      { skipCache: options?.skipCache }
    );
  } catch (e) {
    if (e instanceof SupabaseBackoffError) return { rows: [], unreadCount: 0 };
    throw e;
  }
}

export async function fetchUnreadNotifications(userId: string): Promise<NotificationRecord[]> {
  const uid = String(userId ?? '').trim();
  if (!uid) return [];
  try {
    return await dedupeSupabaseRead(`skyline_notifications:unread:${uid}`, 30_000, async () => {
      const { data, error } = await supabase
        .from('skyline_notifications')
        .select('id,user_id,title,message,url,type,is_read,created_at,read_at')
        .eq('user_id', uid)
        .eq('is_read', false)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) {
        recordSupabaseError('skyline_notifications', error);
        throw new Error(error.message);
      }
      return (data ?? []) as NotificationRecord[];
    });
  } catch (e) {
    if (e instanceof SupabaseBackoffError) return [];
    throw e;
  }
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('skyline_notifications')
    .update({ is_read: true, read_at: now })
    .eq('id', notificationId)
    .eq('user_id', String(userId));
  if (error) throw new Error(error.message);
}

export async function fetchPendingAssessmentAcknowledgments(
  studentId: number
): Promise<PendingAssessmentAck[]> {
  const sid = Number(studentId);
  if (!Number.isFinite(sid) || sid <= 0) return [];

  const [{ data: ackRows, error: ackErr }, assessmentsRes] = await Promise.all([
    supabase
      .from('skyline_assessment_acknowledgments')
      .select('instance_id, outcome_label')
      .eq('student_id', sid),
    listStudentAssessmentsPaged(sid, 1, 100),
  ]);
  if (ackErr) {
    const msg = String(ackErr.message ?? '').toLowerCase();
    if (msg.includes('skyline_assessment_acknowledgments') || ackErr.code === '42P01') {
      return [];
    }
    throw new Error(ackErr.message);
  }

  const ackMap = new Map<number, string>();
  for (const row of ackRows ?? []) {
    ackMap.set(Number((row as { instance_id: number }).instance_id), String((row as { outcome_label: string }).outcome_label));
  }

  const ids = assessmentsRes.data.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
  const summaries = ids.length > 0 ? await fetchAssessmentSummaries(ids) : {};

  const pending: PendingAssessmentAck[] = [];

  for (const row of assessmentsRes.data) {
    const instanceId = Number(row.id);
    const summary = summaries[instanceId] as
      | {
          final_attempt_1_result: AttemptResult;
          final_attempt_2_result: AttemptResult;
          final_attempt_3_result: AttemptResult;
        }
      | undefined;
    const missedText = getMissedAttemptWindowText({
      noAttemptRollovers: row.no_attempt_rollovers ?? null,
      didNotAttempt: row.did_not_attempt ?? null,
    });
    const outcome = getAssessmentOutcomeDisplay({
      status: row.status,
      role_context: row.role_context,
      attemptResults: summary
        ? [summary.final_attempt_1_result, summary.final_attempt_2_result, summary.final_attempt_3_result]
        : [],
      submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
      submittedAt: row.submitted_at ?? null,
    });
    const statusLabel = missedText === "Didn't attempt any" ? "Didn't attempt any" : outcome.label;
    const visual = getAssessmentStatusVisual({ label: statusLabel, className: outcome.className });

    if (visual.kind === 'update' || visual.kind === 'general') continue;

    const previousLabel = ackMap.get(instanceId);
    if (previousLabel === statusLabel) continue;

    pending.push({
      instanceId,
      formName: row.form_name?.trim() || 'Assessment',
      statusLabel,
      missedText: missedText && missedText !== "Didn't attempt any" ? missedText : null,
      outcomeKind: visual.kind,
    });
  }

  return pending;
}

export async function acknowledgeAssessmentOutcome(
  studentId: number,
  item: PendingAssessmentAck
): Promise<void> {
  const sid = Number(studentId);
  const { error } = await supabase.from('skyline_assessment_acknowledgments').upsert(
    {
      student_id: sid,
      instance_id: item.instanceId,
      form_name: item.formName,
      outcome_label: item.statusLabel,
      outcome_kind: item.outcomeKind,
      acknowledged_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,instance_id' }
  );
  if (error) throw new Error(error.message);
}

export function getNotificationVisual(row: Pick<NotificationRecord, 'type' | 'title' | 'message'>) {
  return getNotificationOutcomeVisual(row.type, row.title, row.message);
}

export function getAssessmentVisual(item: PendingAssessmentAck) {
  return getAssessmentStatusVisual({ label: item.statusLabel });
}
