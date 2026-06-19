import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Bell, CheckCheck, CheckCircle2, Clock, Info, RotateCcw, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { cn } from './utils/cn';
import { toast } from '../utils/toast';
import { listenForForegroundMessages } from '../services/pushNotificationService';
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

type NotificationRow = {
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

type AssessmentStatusRow = {
  id: number;
  formName: string;
  statusLabel: string;
  missedText: string | null;
  outcomeKind: NotificationOutcomeKind;
};

function formatWhen(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString();
}

function OutcomeIcon({ kind, className }: { kind: NotificationOutcomeKind; className?: string }) {
  const props = { className: cn('h-4 w-4 shrink-0', className) };
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

export const NotificationBell: React.FC<{
  userId: string | number;
  className?: string;
  viewAllHref?: string;
  /** When set, show live assessment pass/fail/missed status for this student. */
  assessmentStudentId?: number;
}> = ({ userId, className, viewAllHref = '/admin/notifications', assessmentStudentId }) => {
  const navigate = useNavigate();
  const uid = useMemo(() => String(userId ?? '').trim(), [userId]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [assessmentRows, setAssessmentRows] = useState<AssessmentStatusRow[]>([]);
  const [assessmentLoading, setAssessmentLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const realtimeRef = useRef<{ uid: string; channel: ReturnType<typeof supabase.channel> } | null>(null);
  const realtimeCleanupTimerRef = useRef<number | null>(null);

  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

  const fetchLatest = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const [{ data, error }, { count, error: countError }] = await Promise.all([
      supabase
        .from('skyline_notifications')
        .select('id,user_id,title,message,url,type,is_read,created_at,read_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('skyline_notifications').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('is_read', false),
    ]);
    if (error) console.error('fetch notifications error', error);
    if (countError) console.error('fetch unread count error', countError);
    setRows(((data as NotificationRow[] | null) ?? []) as NotificationRow[]);
    setUnreadCount(Number(count ?? 0));
    setLoading(false);
  }, [uid]);

  const fetchAssessmentStatus = useCallback(async () => {
    const sid = Number(assessmentStudentId);
    if (!Number.isFinite(sid) || sid <= 0) {
      setAssessmentRows([]);
      return;
    }
    setAssessmentLoading(true);
    try {
      const res = await listStudentAssessmentsPaged(sid, 1, 12);
      const ids = res.data.map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
      const summaries = ids.length > 0 ? await fetchAssessmentSummaries(ids) : {};
      const items: AssessmentStatusRow[] = res.data.map((row) => {
        const summary = summaries[Number(row.id)] as
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
        return {
          id: Number(row.id),
          formName: row.form_name?.trim() || 'Assessment',
          statusLabel,
          missedText: missedText && missedText !== "Didn't attempt any" ? missedText : null,
          outcomeKind: visual.kind,
        };
      });
      setAssessmentRows(items);
    } catch (e) {
      console.error('fetch assessment status error', e);
      setAssessmentRows([]);
    } finally {
      setAssessmentLoading(false);
    }
  }, [assessmentStudentId]);

  useEffect(() => {
    if (!uid) return;
    void fetchLatest();
    let fgUnsub: (() => void) | null = null;
    void listenForForegroundMessages((payload) => {
      const t = payload.notification?.title || payload.data?.title || 'Notification';
      const m = payload.notification?.body || payload.data?.message || '';
      toast.info(`${t}${m ? `: ${m}` : ''}`);
      void fetchLatest();
    }).then((unsub) => {
      fgUnsub = unsub;
    });

    if (realtimeCleanupTimerRef.current) {
      window.clearTimeout(realtimeCleanupTimerRef.current);
      realtimeCleanupTimerRef.current = null;
    }

    if (!realtimeRef.current || realtimeRef.current.uid !== uid) {
      if (realtimeRef.current) {
        supabase.removeChannel(realtimeRef.current.channel);
        realtimeRef.current = null;
      }
      const channel = supabase
        .channel(`notifications-bell-${uid}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'skyline_notifications', filter: `user_id=eq.${uid}` },
          (payload) => {
            const eventType = payload.eventType;
            if (eventType === 'INSERT') {
              const n = payload.new as NotificationRow;
              setRows((prev) => [n, ...prev].slice(0, 10));
              if (!n.is_read) setUnreadCount((c) => c + 1);
              toast.info(`${n.title}: ${n.message}`);
              return;
            }
            if (eventType === 'UPDATE') {
              const n = payload.new as NotificationRow;
              setRows((prev) => prev.map((p) => (p.id === n.id ? n : p)));
              void supabase
                .from('skyline_notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', uid)
                .eq('is_read', false)
                .then(({ count }) => setUnreadCount(Number(count ?? 0)));
            }
          }
        )
        .subscribe((status) => {
          if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
            void fetchLatest();
          }
        });
      realtimeRef.current = { uid, channel };
    }

    return () => {
      if (fgUnsub) fgUnsub();
      realtimeCleanupTimerRef.current = window.setTimeout(() => {
        if (realtimeRef.current?.uid === uid) {
          supabase.removeChannel(realtimeRef.current.channel);
          realtimeRef.current = null;
        }
      }, 250);
    };
  }, [uid, fetchLatest]);

  const pollUnreadCount = useCallback(async () => {
    if (!uid || document.hidden) return;
    const { count, error } = await supabase
      .from('skyline_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', uid)
      .eq('is_read', false);
    if (error) return;
    setUnreadCount(Number(count ?? 0));
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const interval = window.setInterval(() => void pollUnreadCount(), 25000);
    const onFocus = () => void fetchLatest();
    const onVis = () => {
      if (!document.hidden) void fetchLatest();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [uid, fetchLatest, pollUnreadCount]);

  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const w = 380;
    const left = clamp(rect.right - w, 8, (window.innerWidth || 0) - w - 8);
    const top = rect.bottom + 8;
    setPos({ top, left, width: w });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (assessmentStudentId) void fetchAssessmentStatus();
  }, [open, assessmentStudentId, fetchAssessmentStatus]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const markOneRead = async (id: string) => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('skyline_notifications').update({ is_read: true, read_at: now }).eq('id', id).eq('user_id', uid);
    if (error) {
      toast.error('Failed to mark as read');
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: true, read_at: now } : r)));
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('skyline_notifications').update({ is_read: true, read_at: now }).eq('user_id', uid).eq('is_read', false);
    if (error) {
      toast.error('Failed to mark all as read');
      return;
    }
    setRows((prev) => prev.map((r) => ({ ...r, is_read: true, read_at: r.read_at ?? now })));
    setUnreadCount(0);
    toast.success('All notifications marked as read');
  };

  const onClickRow = async (row: NotificationRow) => {
    if (!row.is_read) await markOneRead(row.id);
    if (row.url?.trim()) {
      navigate(row.url);
    }
    setOpen(false);
  };

  if (!uid) return null;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-800 shadow-sm hover:border-[#ea580c]/40 hover:bg-[#fff7ed] hover:text-[#ea580c]"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void fetchLatest();
        }}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        title="Notifications"
      >
        <Bell className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-[#ea580c] px-1 text-[10px] font-semibold text-white ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[10000] w-[380px] max-w-[92vw] rounded-lg border border-[var(--border)] bg-white shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-[#ea580c]" strokeWidth={2.25} />
                  <div className="text-sm font-semibold text-[var(--text)]">Notifications</div>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  onClick={() => void markAllRead()}
                  disabled={unreadCount === 0}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              </div>

              {assessmentStudentId ? (
                <div className="border-b border-[var(--border)] bg-[#fafafa]">
                  <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Assessment status
                  </div>
                  <div className="max-h-[220px] overflow-y-auto">
                    {assessmentLoading ? (
                      <div className="px-3 pb-3 text-sm text-gray-500">Loading assessments…</div>
                    ) : assessmentRows.length === 0 ? (
                      <div className="px-3 pb-3 text-sm text-gray-500">No assessments yet</div>
                    ) : (
                      assessmentRows.map((item) => {
                        const visual = getAssessmentStatusVisual({ label: item.statusLabel });
                        return (
                          <div key={`assessment-${item.id}`} className="flex gap-2 border-t border-gray-100 px-3 py-2.5">
                            <OutcomeIcon kind={item.outcomeKind} className={visual.iconClass} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-[var(--text)]">{item.formName}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                    visual.badgeClass
                                  )}
                                >
                                  {visual.label}
                                </span>
                                <span className="text-xs text-gray-600">{item.statusLabel}</span>
                              </div>
                              {item.missedText ? (
                                <div className="mt-1 text-[11px] font-medium text-amber-700">{item.missedText}</div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : null}

              <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recent alerts
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {loading ? (
                  <div className="p-4 text-sm text-gray-500">Loading…</div>
                ) : rows.length === 0 ? (
                  <div className="p-4 text-sm text-gray-500">No notifications yet</div>
                ) : (
                  rows.map((row) => {
                    const visual = getNotificationOutcomeVisual(row.type, row.title, row.message);
                    return (
                      <button
                        type="button"
                        key={row.id}
                        className={cn(
                          'flex w-full gap-2 border-b border-[var(--border)] px-3 py-2.5 text-left hover:bg-[var(--brand)]/10',
                          !row.is_read && 'bg-amber-50/50'
                        )}
                        onClick={() => void onClickRow(row)}
                      >
                        <OutcomeIcon kind={visual.kind} className={cn('mt-0.5', visual.iconClass)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                visual.badgeClass
                              )}
                            >
                              {visual.label}
                            </span>
                            <span className="truncate text-sm font-semibold text-[var(--text)]">{row.title}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-gray-700">{row.message}</div>
                          <div className="mt-1 text-[11px] text-gray-500">{formatWhen(row.created_at)}</div>
                          {!row.is_read ? (
                            <button
                              type="button"
                              className="mt-1 text-[11px] font-medium text-[var(--brand)] hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                void markOneRead(row.id);
                              }}
                            >
                              Mark as read
                            </button>
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {viewAllHref ? (
                <button
                  type="button"
                  className="w-full border-t border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--brand)]/10"
                  onClick={() => {
                    navigate(viewAllHref);
                    setOpen(false);
                  }}
                >
                  View all notifications
                </button>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
};
