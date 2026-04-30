import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import { cn } from './utils/cn';
import { toast } from '../utils/toast';
import { requestNotificationPermission, requestNotificationPreference } from '../services/pushNotificationService';

type Props = {
  name: string;
  onLogout: () => void;
  extraItems?: Array<{ label: string; onClick: () => void }>;
  notificationUserId?: string | number;
  className?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export const UserMenu: React.FC<Props> = ({ name, onLogout, extraItems, className, notificationUserId }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | null>(null);

  const displayName = useMemo(() => (name || 'User').trim(), [name]);

  useEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const w = 220;
    const left = clamp(rect.right - w, 8, (window.innerWidth || 0) - w - 8);
    const top = rect.bottom + 8;
    setPos({ top, left, width: w });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission(null);
      return;
    }
    setNotificationPermission(Notification.permission);
  }, [open]);

  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    if (open) document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [open]);

  const notificationStatusLabel = useMemo(() => {
    if (notificationPermission === null) return 'Unavailable';
    if (notificationPermission === 'granted') return 'Enabled';
    if (notificationPermission === 'denied') return 'Blocked';
    return 'Not set';
  }, [notificationPermission]);

  return (
    <div className={cn('relative', className)}>
      <button
        ref={btnRef}
        type="button"
        className="inline-flex h-10 items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-100"
        onClick={() => setOpen((v) => !v)}
        aria-label="User menu"
      >
        <span className="max-w-[160px] truncate">{displayName}</span>
        <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-[10000] w-[220px] overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="py-1">
                <div className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-gray-700">Notifications</span>
                    <span
                      className={cn(
                        'text-xs font-semibold',
                        notificationPermission === 'granted'
                          ? 'text-emerald-700'
                          : notificationPermission === 'denied'
                            ? 'text-red-700'
                            : 'text-gray-500'
                      )}
                    >
                      {notificationStatusLabel}
                    </span>
                  </div>
                  {notificationPermission === 'default' ? (
                    <button
                      type="button"
                      className="mt-2 w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      onClick={async () => {
                        // Keep menu open so the user sees the status update after choosing.
                        try {
                          if (notificationUserId !== undefined && notificationUserId !== null && String(notificationUserId).trim()) {
                            const token = await requestNotificationPermission(notificationUserId);
                            if (token) toast.success('Notifications enabled.');
                          } else {
                            const p = await requestNotificationPreference();
                            if (p === 'granted') toast.success('Notifications enabled.');
                          }
                        } finally {
                          if (typeof window !== 'undefined' && 'Notification' in window) {
                            setNotificationPermission(Notification.permission);
                          }
                        }
                      }}
                    >
                      Enable notifications
                    </button>
                  ) : null}
                  {notificationPermission === 'denied' ? (
                    <div className="mt-2 text-[11px] text-gray-500">
                      Notifications are blocked in your browser settings for this site.
                    </div>
                  ) : null}
                </div>
                <div className="my-1 h-px bg-gray-100" />
                {(extraItems ?? []).map((it) => (
                  <button
                    key={it.label}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setOpen(false);
                      it.onClick();
                    }}
                  >
                    {it.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  onClick={() => {
                    setOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut className="h-4 w-4 text-gray-400" />
                  Logout
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
};

