import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { cn } from './utils/cn';
import { toast } from '../utils/toast';
import { listenForForegroundMessages } from '../services/pushNotificationService';

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

function formatWhen(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString();
}

export const NotificationBell: React.FC<{ userId: string | number; className?: string }> = ({ userId, className }) => {
  const navigate = useNavigate();
  const uid = useMemo(() => String(userId ?? '').trim(), [userId]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
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

  useEffect(() => {
    if (!uid) return;
    void fetchLatest();
    let fgUnsub: (() => void) | null = null;
    void listenForForegroundMessages((payload) => {
      const t = payload.notification?.title || payload.data?.title || 'Notification';
      const m = payload.notification?.body || payload.data?.message || '';
      toast.info(`${t}${m ? `: ${m}` : ''}`);
      // FCM foreground does not imply Postgres Realtime fired (e.g. table not in publication). Re-fetch so the badge matches the DB.
      void fetchLatest();
    }).then((unsub) => {
      fgUnsub = unsub;
    });

    // Avoid noisy "WebSocket closed before the connection is established" warnings in dev StrictMode
    // by reusing the same channel when effects are double-invoked.
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
      // Delay cleanup slightly so StrictMode's immediate cleanup doesn't flap the socket.
      realtimeCleanupTimerRef.current = window.setTimeout(() => {
        if (realtimeRef.current?.uid === uid) {
          supabase.removeChannel(realtimeRef.current.channel);
          realtimeRef.current = null;
        }
      }, 250);
    };
  }, [uid, fetchLatest]);

  /** Lightweight unread poll when Realtime is flaky or publication not applied yet; cheap head-only query. */
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
    const w = 360;
    const left = clamp(rect.right - w, 8, (window.innerWidth || 0) - w - 8);
    const top = rect.bottom + 8;
    setPos({ top, left, width: w });
  }, [open]);

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

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void fetchLatest();
        }}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-[#ea580c] px-1 text-[10px] font-semibold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[10000] w-[360px] max-w-[90vw] rounded-lg border border-[var(--border)] bg-white shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
            <div className="text-sm font-semibold text-[var(--text)]">Notifications</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                onClick={() => void markAllRead()}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all as read
              </button>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {loading ? (
              <div className="p-4 text-sm text-gray-500">Loading...</div>
            ) : rows.length === 0 ? (
              <div className="p-4 text-sm text-gray-500">No notifications yet</div>
            ) : (
              rows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={cn(
                    'block w-full border-b border-[var(--border)] px-3 py-2 text-left hover:bg-[var(--brand)]/10',
                    !row.is_read && 'bg-amber-50/50'
                  )}
                  onClick={() => void onClickRow(row)}
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{row.title}</div>
                  <div className="mt-0.5 text-xs text-gray-700">{row.message}</div>
                  <div className="mt-1 text-[11px] text-gray-500">{formatWhen(row.created_at)}</div>
                  {!row.is_read ? (
                    <div className="mt-1">
                      <button
                        type="button"
                        className="text-[11px] font-medium text-[var(--brand)] hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void markOneRead(row.id);
                        }}
                      >
                        Mark as read
                      </button>
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>
          <button
            type="button"
            className="w-full border-t border-[var(--border)] px-3 py-2 text-sm font-medium text-[var(--brand)] hover:bg-[var(--brand)]/10"
            onClick={() => {
              navigate('/admin/notifications');
              setOpen(false);
            }}
          >
            View all notifications
          </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

