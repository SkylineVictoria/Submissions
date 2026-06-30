import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  dedupeSupabaseRead,
  endpointFromUrl,
  invalidateSupabaseReadCache,
  isTransientSupabaseFailure,
  recordEndpointFailure,
  isEndpointBackedOff,
} from './supabaseRequestGuard';

describe('supabaseRequestGuard', () => {
  beforeEach(() => {
    invalidateSupabaseReadCache();
    vi.useFakeTimers();
  });

  it('extracts table and rpc names from URLs', () => {
    expect(endpointFromUrl('https://x.supabase.co/rest/v1/skyline_notifications?select=*')).toBe(
      'skyline_notifications'
    );
    expect(endpointFromUrl('https://x.supabase.co/rest/v1/rpc/skyline_admin_dashboard_stats_v2')).toBe(
      'skyline_admin_dashboard_stats_v2'
    );
  });

  it('detects transient failures', () => {
    expect(isTransientSupabaseFailure({ status: 522 })).toBe(true);
    expect(isTransientSupabaseFailure({ status: 503 })).toBe(true);
    expect(isTransientSupabaseFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransientSupabaseFailure({ status: 400, message: 'bad request' })).toBe(false);
  });

  it('dedupes concurrent reads', async () => {
    const fn = vi.fn(async () => 'ok');
    const p1 = dedupeSupabaseRead('test:key', 1000, fn);
    const p2 = dedupeSupabaseRead('test:key', 1000, fn);
    await expect(Promise.all([p1, p2])).resolves.toEqual(['ok', 'ok']);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off endpoints after transient failure', () => {
    recordEndpointFailure('skyline_notifications', { status: 503 });
    expect(isEndpointBackedOff('skyline_notifications')).toBe(true);
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(isEndpointBackedOff('skyline_notifications')).toBe(false);
  });
});
