import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { toast } from '../utils/toast';

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

const PAGE_SIZE = 20;

type TabKey = 'all' | 'unread' | 'read';

export const NotificationsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const uid = String(user?.id ?? '').trim();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  const loadRows = async (targetPage = 1, replace = true) => {
    if (!uid) return;
    setLoading(true);
    let query = supabase
      .from('skyline_notifications')
      .select('id,user_id,title,message,url,type,is_read,created_at,read_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (tab === 'unread') query = query.eq('is_read', false);
    if (tab === 'read') query = query.eq('is_read', true);
    const from = (targetPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await query.range(from, to);
    if (error) {
      console.error('notifications list error', error);
      toast.error('Failed to load notifications');
      setLoading(false);
      return;
    }
    const list = ((data as NotificationRow[] | null) ?? []) as NotificationRow[];
    setRows((prev) => (replace ? list : [...prev, ...list]));
    setHasMore(list.length === PAGE_SIZE);
    setLoading(false);
  };

  useEffect(() => {
    setPage(1);
    void loadRows(1, true);
  }, [uid, tab]);

  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`notifications-page-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'skyline_notifications', filter: `user_id=eq.${uid}` },
        () => {
          void loadRows(1, true);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [uid, tab]);

  const unreadCount = useMemo(() => rows.filter((r) => !r.is_read).length, [rows]);

  const markOneRead = async (id: string) => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('skyline_notifications').update({ is_read: true, read_at: now }).eq('id', id).eq('user_id', uid);
    if (error) {
      toast.error('Failed to mark as read');
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, is_read: true, read_at: now } : r)));
  };

  const markAllRead = async () => {
    const now = new Date().toISOString();
    const { error } = await supabase.from('skyline_notifications').update({ is_read: true, read_at: now }).eq('user_id', uid).eq('is_read', false);
    if (error) {
      toast.error('Failed to mark all as read');
      return;
    }
    setRows((prev) => prev.map((r) => ({ ...r, is_read: true, read_at: r.read_at ?? now })));
    toast.success('All notifications marked as read');
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--text)]">Notifications</h2>
            <Button type="button" size="sm" variant="outline" onClick={() => void markAllRead()} disabled={unreadCount === 0}>
              Mark all as read
            </Button>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {(['all', 'unread', 'read'] as TabKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  tab === key ? 'border-[var(--brand)] bg-[var(--brand)]/10 text-[var(--brand)]' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
                onClick={() => setTab(key)}
              >
                {key === 'all' ? 'All' : key === 'unread' ? 'Unread' : 'Read'}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="py-8 text-sm text-gray-500">Loading notifications...</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-sm text-gray-500">No notifications yet</div>
          ) : (
            <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-[var(--brand)]/10 ${!row.is_read ? 'bg-amber-50/50' : 'bg-white'}`}
                  onClick={async () => {
                    if (!row.is_read) await markOneRead(row.id);
                    if (row.url?.trim()) navigate(row.url);
                  }}
                >
                  <div className="text-sm font-semibold text-[var(--text)]">{row.title}</div>
                  <div className="mt-1 text-sm text-gray-700">{row.message}</div>
                  <div className="mt-1 text-xs text-gray-500">{new Date(row.created_at).toLocaleString()}</div>
                  {!row.is_read ? (
                    <div className="mt-1">
                      <span
                        role="button"
                        tabIndex={0}
                        className="text-xs font-medium text-[var(--brand)] hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          void markOneRead(row.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            void markOneRead(row.id);
                          }
                        }}
                      >
                        Mark as read
                      </span>
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {hasMore ? (
            <div className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const next = page + 1;
                  setPage(next);
                  void loadRows(next, false);
                }}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
};

