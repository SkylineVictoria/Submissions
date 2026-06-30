import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Bell, CheckCircle2, Clock, Info, RotateCcw, XCircle } from 'lucide-react';
import { Button } from './ui/Button';
import { cn } from './utils/cn';
import { formatMelbourneDateTime } from '../utils/melbourneTime';
import { toast } from '../utils/toast';
import {
  acknowledgeAssessmentOutcome,
  fetchPendingAssessmentAcknowledgments,
  fetchUnreadNotifications,
  getAssessmentVisual,
  getNotificationVisual,
  markNotificationRead,
  type NotificationRecord,
  type PendingAssessmentAck,
} from '../services/notifications';
import type { NotificationOutcomeKind } from '../utils/notificationOutcome';

function OutcomeIcon({ kind, className }: { kind: NotificationOutcomeKind; className?: string }) {
  const props = { className: cn('h-5 w-5 shrink-0', className) };
  switch (kind) {
    case 'passed':
      return <CheckCircle2 {...props} />;
    case 'failed':
      return <XCircle {...props} />;
    case 'missed':
      return <Clock {...props} />;
    case 'resubmit':
      return <RotateCcw {...props} />;
    case 'update':
      return <Info {...props} />;
    default:
      return <AlertCircle {...props} />;
  }
}

function formatWhen(iso: string): string {
  return formatMelbourneDateTime(iso);
}

interface NotificationAcknowledgmentGateProps {
  userId: string | number;
  studentId: number;
  children: React.ReactNode;
}

export const NotificationAcknowledgmentGate: React.FC<NotificationAcknowledgmentGateProps> = ({
  userId,
  studentId,
  children,
}) => {
  const uid = useMemo(() => String(userId ?? '').trim(), [userId]);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [assessments, setAssessments] = useState<PendingAssessmentAck[]>([]);
  const [ackedNotificationIds, setAckedNotificationIds] = useState<Set<string>>(new Set());
  const [ackedAssessmentIds, setAckedAssessmentIds] = useState<Set<number>>(new Set());
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadPending = useCallback(async () => {
    if (!uid || !studentId) {
      setNotifications([]);
      setAssessments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [unread, pendingAssessments] = await Promise.all([
        fetchUnreadNotifications(uid),
        fetchPendingAssessmentAcknowledgments(studentId),
      ]);
      setNotifications(unread);
      setAssessments(pendingAssessments);
      setAckedNotificationIds(new Set());
      setAckedAssessmentIds(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load acknowledgments');
    } finally {
      setLoading(false);
    }
  }, [uid, studentId]);

  useEffect(() => {
    void loadPending();
  }, [loadPending]);

  const pendingNotifications = notifications.filter((n) => !ackedNotificationIds.has(n.id));
  const pendingAssessments = assessments.filter((a) => !ackedAssessmentIds.has(a.instanceId));
  const totalPending = pendingNotifications.length + pendingAssessments.length;
  const totalItems = notifications.length + assessments.length;
  const acknowledgedCount = totalItems - totalPending;
  const gateActive = !loading && totalPending > 0;

  const acknowledgeNotification = async (row: NotificationRecord) => {
    setSubmittingId(`n-${row.id}`);
    try {
      await markNotificationRead(uid, row.id);
      setAckedNotificationIds((prev) => new Set(prev).add(row.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not acknowledge notification');
    } finally {
      setSubmittingId(null);
    }
  };

  const acknowledgeAssessment = async (item: PendingAssessmentAck) => {
    setSubmittingId(`a-${item.instanceId}`);
    try {
      await acknowledgeAssessmentOutcome(studentId, item);
      setAckedAssessmentIds((prev) => new Set(prev).add(item.instanceId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not acknowledge assessment');
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <>
      <div
        className={cn(gateActive && 'pointer-events-none select-none blur-[1px]')}
        aria-hidden={gateActive}
      >
        {children}
      </div>

      {gateActive ? (
        <div
          className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ack-gate-title"
        >
          <div className="flex max-h-[min(92dvh,900px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-2xl">
            <div className="border-b border-[var(--border)] bg-[#fff7ed] px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ea580c]/10 text-[#ea580c]">
                  <Bell className="h-5 w-5" strokeWidth={2.25} />
                </div>
                <div>
                  <h2 id="ack-gate-title" className="text-lg font-bold text-[var(--text)]">
                    Review required before continuing
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    You must acknowledge each alert and assessment update below. The dashboard stays locked until every
                    item is confirmed.
                  </p>
                  <p className="mt-2 text-xs font-medium text-gray-700">
                    {acknowledgedCount} of {totalItems} acknowledged
                  </p>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {pendingNotifications.map((row) => {
                const visual = getNotificationVisual(row);
                const busy = submittingId === `n-${row.id}`;
                return (
                  <div
                    key={row.id}
                    className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"
                  >
                    <div className="flex gap-3">
                      <OutcomeIcon kind={visual.kind} className={visual.iconClass} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              visual.badgeClass
                            )}
                          >
                            {visual.label}
                          </span>
                          <span className="text-sm font-semibold text-[var(--text)]">{row.title}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">{row.message}</p>
                        <p className="mt-1 text-xs text-gray-500">{formatWhen(row.created_at)}</p>
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          className="mt-3"
                          disabled={busy}
                          onClick={() => void acknowledgeNotification(row)}
                        >
                          {busy ? 'Saving…' : 'I acknowledge'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {pendingAssessments.map((item) => {
                const visual = getAssessmentVisual(item);
                const busy = submittingId === `a-${item.instanceId}`;
                return (
                  <div
                    key={`assessment-${item.instanceId}`}
                    className="rounded-lg border border-[var(--border)] bg-white p-4 shadow-sm"
                  >
                    <div className="flex gap-3">
                      <OutcomeIcon kind={item.outcomeKind} className={visual.iconClass} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                              visual.badgeClass
                            )}
                          >
                            {visual.label}
                          </span>
                          <span className="text-sm font-semibold text-[var(--text)]">{item.formName}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">{item.statusLabel}</p>
                        {item.missedText ? (
                          <p className="mt-1 text-xs font-medium text-amber-700">{item.missedText}</p>
                        ) : null}
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          className="mt-3"
                          disabled={busy}
                          onClick={() => void acknowledgeAssessment(item)}
                        >
                          {busy ? 'Saving…' : 'I acknowledge this assessment'}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-[var(--border)] bg-gray-50 px-5 py-3 text-center text-xs text-gray-600">
              Continue button unlocks automatically after all items are acknowledged.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
