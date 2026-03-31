import { DateTime } from 'luxon';

const ZONE = 'Australia/Melbourne';

/** Parse date + time fields as Melbourne wall time → UTC ISO for DB. */
export function melbourneLocalToUtcIso(dateStr: string, timeStr: string): string {
  const dt = DateTime.fromFormat(`${dateStr} ${timeStr}`, 'yyyy-MM-dd HH:mm', { zone: ZONE });
  if (!dt.isValid) throw new Error('Invalid date or time');
  return dt.toUTC().toISO()!;
}

/** DB timestamptz ISO → Melbourne wall date + HH:mm for date/time inputs. */
export function utcIsoToMelbourneDateAndTime(iso: string): { date: string; time: string } {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(ZONE);
  if (!dt.isValid) return { date: '', time: '17:00' };
  return { date: dt.toFormat('yyyy-MM-dd'), time: dt.toFormat('HH:mm') };
}

/** 24h `HH:mm` → 12-hour parts for pickers. */
export function hhmmTo12HourParts(hhmm: string): { hour12: number; minute: string; ampm: 'AM' | 'PM' } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return { hour12: 9, minute: '00', ampm: 'AM' };
  let h = parseInt(m[1], 10);
  const min = m[2].padStart(2, '0').slice(0, 2);
  if (Number.isNaN(h) || h < 0 || h > 23) return { hour12: 9, minute: '00', ampm: 'AM' };
  const ampm: 'AM' | 'PM' = h < 12 ? 'AM' : 'PM';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  return { hour12, minute: min, ampm };
}

/** 12-hour picker values → 24h `HH:mm` for `melbourneLocalToUtcIso`. */
export function twelveHourToHHmm(hour12: number, minute: string, ampm: 'AM' | 'PM'): string {
  const mm = String(minute ?? '00').replace(/\D/g, '').padStart(2, '0').slice(0, 2);
  const mi = Math.min(59, Math.max(0, parseInt(mm, 10) || 0));
  const mmStr = String(mi).padStart(2, '0');
  let h24: number;
  if (ampm === 'AM') {
    h24 = hour12 === 12 ? 0 : hour12;
  } else {
    h24 = hour12 === 12 ? 12 : hour12 + 12;
  }
  if (h24 < 0 || h24 > 23 || hour12 < 1 || hour12 > 12) throw new Error('Invalid time');
  return `${String(h24).padStart(2, '0')}:${mmStr}`;
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
