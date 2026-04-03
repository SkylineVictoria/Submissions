import React, { useCallback } from 'react';
import { cn } from '../utils/cn';
import { Select } from '../ui/Select';
import { hhmmTo12HourParts, twelveHourToHHmm } from '../../utils/melbourneTime';

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

const HOUR_OPTIONS = HOURS.map((h) => ({ value: String(h), label: String(h) }));
const MINUTE_OPTIONS = MINUTES.map((m) => ({ value: m, label: m }));
const AMPM_OPTIONS = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
];

interface MelbourneTime12hSelectProps {
  label: string;
  /** 24h `HH:mm` (Melbourne wall time). */
  value: string;
  onChange: (hhmm: string) => void;
  disabled?: boolean;
  className?: string;
}

export const MelbourneTime12hSelect: React.FC<MelbourneTime12hSelectProps> = ({
  label,
  value,
  onChange,
  disabled,
  className,
}) => {
  const p = hhmmTo12HourParts(value);

  const apply = useCallback(
    (next: Partial<{ hour12: number; minute: string; ampm: 'AM' | 'PM' }>) => {
      const hour12 = next.hour12 ?? p.hour12;
      const minute = next.minute ?? p.minute;
      const ampm = next.ampm ?? p.ampm;
      try {
        onChange(twelveHourToHHmm(hour12, minute, ampm));
      } catch {
        /* ignore */
      }
    },
    [onChange, p.hour12, p.minute, p.ampm],
  );

  return (
    <div className={cn('w-full', className)}>
      <fieldset className="min-w-0 border-0 p-0 m-0">
        <legend className="block text-xs font-medium text-gray-700 mb-2">{label}</legend>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-[5.25rem] shrink-0">
            <Select
              label="Hour"
              value={String(p.hour12)}
              onChange={(v) => apply({ hour12: Number(v) })}
              options={HOUR_OPTIONS}
              disabled={disabled}
              className="[&_label]:text-xs [&_label]:mb-1 [&_label]:font-medium"
            />
          </div>
          <span className="pb-3 text-gray-500 text-sm select-none" aria-hidden>
            :
          </span>
          <div className="w-[5.25rem] shrink-0">
            <Select
              label="Min"
              value={p.minute}
              onChange={(v) => apply({ minute: v })}
              options={MINUTE_OPTIONS}
              disabled={disabled}
              className="[&_label]:text-xs [&_label]:mb-1 [&_label]:font-medium"
            />
          </div>
          <div className="w-[5.5rem] shrink-0">
            <Select
              label="AM/PM"
              value={p.ampm}
              onChange={(v) => apply({ ampm: v as 'AM' | 'PM' })}
              options={AMPM_OPTIONS}
              disabled={disabled}
              className="[&_label]:text-xs [&_label]:mb-1 [&_label]:font-medium"
            />
          </div>
        </div>
      </fieldset>
    </div>
  );
};
