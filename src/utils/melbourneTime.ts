import { DateTime } from 'luxon';

const ZONE = 'Australia/Melbourne';

/** Parse date + time fields as Melbourne wall time → UTC ISO for DB. */
export function melbourneLocalToUtcIso(dateStr: string, timeStr: string): string {
  const dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm', { zone: ZONE });
  if (!dt.isValid) throw new Error('Invalid date or time');
  return dt.toUTC().toISO()!;
}

/**
 * Format a DB timestamptz for Melbourne display — matches pdf-server `inductionHtml`
 * `formatMelbourneDateTime` (en-AU, 24h, short zone name).
 */
/** Compare induction window instants (DB timestamptz) to "now" in the browser. */
export function inductionWindowStatus(
  startIso: string,
  endIso: string,
): 'upcoming' | 'open' | 'ended' {
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'ended';
  if (now < start) return 'upcoming';
  if (now > end) return 'ended';
  return 'open';
}

export function isNowWithinInductionWindow(startIso: string, endIso: string): boolean {
  return inductionWindowStatus(startIso, endIso) === 'open';
}

export function formatMelbourneDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      timeZone: ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).format(d);
  } catch {
    const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE);
    return dt.isValid ? dt.toFormat('dd/MM/yyyy h:mm:ss a z') : '—';
  }
}
