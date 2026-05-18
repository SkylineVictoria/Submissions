import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format, parse, isValid } from 'date-fns';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../utils/cn';

const STORAGE_FORMAT = 'MM/yyyy';
const DISPLAY_FORMAT = 'MM/yyyy';

export function parseMonthYearValue(value: string): Date | undefined {
  const v = value.trim();
  if (!v) return undefined;
  for (const fmt of [STORAGE_FORMAT, 'M/yyyy', 'yyyy-MM', 'MM-yyyy']) {
    const d = parse(v, fmt, new Date());
    if (isValid(d)) return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  return undefined;
}

export function formatMonthYearValue(d: Date): string {
  return format(d, STORAGE_FORMAT);
}

interface MonthYearPickerProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  placement?: 'above' | 'below';
  fromYear?: number;
  toYear?: number;
  /** Disallow months before the current month */
  disablePast?: boolean;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const MonthYearPicker: React.FC<MonthYearPickerProps> = ({
  value = '',
  onChange,
  disabled = false,
  label,
  error,
  required,
  placeholder = 'mm/yyyy',
  className,
  id,
  placement = 'below',
  fromYear = new Date().getFullYear(),
  toYear = new Date().getFullYear() + 5,
  disablePast = false,
}) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [view, setView] = useState<'month' | 'year'>('month');
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const parsed = parseMonthYearValue(value);
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const [activeMonth, setActiveMonth] = useState<Date>(() => parsed ?? new Date());

  const clampYear = (y: number) => Math.min(toYear, Math.max(fromYear, y));

  const updatePopoverPosition = () => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const POPOVER_WIDTH = 280;
    const POPOVER_EST_HEIGHT = 320;
    const margin = 8;
    const gap = 8;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const spaceBelow = Math.max(0, viewportH - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);
    const effectivePlacement =
      placement === 'above'
        ? spaceAbove < POPOVER_EST_HEIGHT && spaceBelow > spaceAbove
          ? 'below'
          : 'above'
        : spaceBelow < POPOVER_EST_HEIGHT && spaceAbove > spaceBelow
          ? 'above'
          : 'below';
    let left = rect.left;
    if (left + POPOVER_WIDTH > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - POPOVER_WIDTH - 8);
    } else if (left < 8) {
      left = 8;
    }
    const top =
      effectivePlacement === 'below'
        ? rect.bottom + gap
        : Math.max(margin, rect.top - POPOVER_EST_HEIGHT - gap);
    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width: POPOVER_WIDTH,
      minWidth: POPOVER_WIDTH,
      zIndex: 99999,
    });
  };

  useEffect(() => {
    if (parsed) {
      setInputValue(format(parsed, DISPLAY_FORMAT));
      setActiveMonth(parsed);
    } else {
      setInputValue('');
    }
  }, [value]);

  useEffect(() => {
    const y = activeMonth.getFullYear();
    if (y < fromYear) setActiveMonth(new Date(fromYear, 0, 1));
    if (y > toYear) setActiveMonth(new Date(toYear, 11, 1));
  }, [activeMonth, fromYear, toYear]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!containerRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useLayoutEffect(() => {
    updatePopoverPosition();
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const update = () => updatePopoverPosition();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, placement]);

  const selectMonth = (monthIndex: number) => {
    const d = new Date(activeMonth.getFullYear(), monthIndex, 1);
    if (disablePast && d < currentMonthStart) return;
    onChange(formatMonthYearValue(d));
    setInputValue(format(d, DISPLAY_FORMAT));
    setOpen(false);
    setView('month');
  };

  const year = activeMonth.getFullYear();
  const canPrevYear = year > fromYear;
  const canNextYear = year < toYear;

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      {label && (
        <label htmlFor={id} className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
          {label}
          {required && <span className="text-[var(--brand)] ml-1">*</span>}
        </label>
      )}
      <div
        className={cn(
          'flex items-center rounded-lg border transition-all duration-200',
          'focus-within:ring-2 focus-within:ring-[var(--brand)] focus-within:ring-offset-1 focus-within:border-[var(--brand)]',
          error ? 'border-red-400' : 'border-[var(--border)] hover:border-gray-300',
          disabled && 'bg-gray-50 cursor-not-allowed opacity-60',
          !disabled && 'bg-blue-50/70',
          'h-11 sm:h-12 px-3 sm:px-4'
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          readOnly
          onFocus={() => {
            if (disabled) return;
            setView('month');
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 min-w-0 bg-transparent border-0 focus:outline-none focus:ring-0 text-base sm:text-sm text-[var(--text)] placeholder:text-gray-400 py-2"
        />
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setView('month');
            setOpen(!open);
          }}
          disabled={disabled}
          className={cn(
            'flex-shrink-0 p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors',
            open && 'bg-gray-100 text-[var(--brand)]'
          )}
          aria-label="Open month picker"
        >
          <Calendar className="w-5 h-5" strokeWidth={2} />
        </button>
      </div>
      {open &&
        !disabled &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            className="p-3 bg-white rounded-xl shadow-lg border border-gray-200 overflow-visible"
            style={popoverStyle}
          >
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                className={cn(
                  'p-1.5 rounded-md text-gray-600 hover:bg-gray-100',
                  !canPrevYear && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
                disabled={!canPrevYear}
                onClick={() => setActiveMonth(new Date(clampYear(year - 1), activeMonth.getMonth(), 1))}
                aria-label="Previous year"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="text-sm font-semibold text-gray-800 hover:text-[var(--brand)]"
                onClick={() => setView(view === 'month' ? 'year' : 'month')}
              >
                {format(activeMonth, 'MMMM yyyy')}
              </button>
              <button
                type="button"
                className={cn(
                  'p-1.5 rounded-md text-gray-600 hover:bg-gray-100',
                  !canNextYear && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
                disabled={!canNextYear}
                onClick={() => setActiveMonth(new Date(clampYear(year + 1), activeMonth.getMonth(), 1))}
                aria-label="Next year"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {view === 'month' && (
              <div className="grid grid-cols-3 gap-2 py-1">
                {MONTH_LABELS.map((m, idx) => {
                  const candidate = new Date(year, idx, 1);
                  const monthDisabled =
                    (disablePast && candidate < currentMonthStart) ||
                    year < fromYear ||
                    year > toYear;
                  return (
                    <button
                      key={m}
                      type="button"
                      className={cn(
                        'py-2 text-sm rounded-md hover:bg-gray-100',
                        monthDisabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
                        parsed &&
                          parsed.getFullYear() === year &&
                          parsed.getMonth() === idx &&
                          'bg-gray-800 text-white hover:bg-gray-800'
                      )}
                      disabled={monthDisabled}
                      onClick={() => selectMonth(idx)}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            )}

            {view === 'year' && (
              <div className="grid grid-cols-3 gap-2 py-1 max-h-52 overflow-y-auto">
                {Array.from({ length: toYear - fromYear + 1 }).map((_, i) => {
                  const y = fromYear + i;
                  return (
                    <button
                      key={y}
                      type="button"
                      className={cn(
                        'py-2 text-sm rounded-md hover:bg-gray-100',
                        year === y && 'bg-gray-200 text-[var(--brand)] font-semibold'
                      )}
                      onClick={() => {
                        setActiveMonth(new Date(y, activeMonth.getMonth(), 1));
                        setView('month');
                      }}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex justify-between mt-2 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setInputValue('');
                  setOpen(false);
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Clear
              </button>
            </div>
          </div>,
          document.body
        )}
      {error && <p className="mt-1 text-xs sm:text-sm text-red-600">{error}</p>}
    </div>
  );
};
