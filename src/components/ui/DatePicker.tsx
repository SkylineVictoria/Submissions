import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { format, parse, isValid } from 'date-fns';
import { Calendar } from 'lucide-react';
import { cn } from '../utils/cn';

const DISPLAY_FORMAT = 'dd-MM-yyyy';
const ISO_FORMAT = 'yyyy-MM-dd';

interface DatePickerProps {
  value?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  error?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  /** Compact style for table cells */
  compact?: boolean;
  /** Popover placement: above or below input */
  placement?: 'above' | 'below';
  /** Lower year bound for year picker */
  fromYear?: number;
  /** Upper year bound for year picker */
  toYear?: number;
  /** Disable selecting future dates */
  disableFuture?: boolean;
}

export const DatePicker: React.FC<DatePickerProps> = ({
  value = '',
  onChange,
  disabled = false,
  label,
  error,
  required,
  placeholder = 'dd-mm-yyyy',
  className,
  id,
  compact = false,
  placement = 'above',
  fromYear = 1900,
  toYear = new Date().getFullYear() + 10,
  disableFuture = false,
}) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [view, setView] = useState<'day' | 'month' | 'year'>('day');
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const parsedDate = value ? parse(value, ISO_FORMAT, new Date()) : undefined;
  const isValidDate = parsedDate && isValid(parsedDate);
  const [activeMonth, setActiveMonth] = useState<Date>(() =>
    isValidDate ? (parsedDate as Date) : new Date()
  );
  const today = new Date();

  useEffect(() => {
    if (value && isValid(parse(value, ISO_FORMAT, new Date()))) {
      const d = parse(value, ISO_FORMAT, new Date());
      setInputValue(format(d, DISPLAY_FORMAT));
      setActiveMonth(d);
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
      const inContainer = containerRef.current?.contains(target);
      const inPopover = popoverRef.current?.contains(target);
      if (!inContainer && !inPopover) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Position popover relative to input (for portal - avoids overflow clipping)
  const POPOVER_WIDTH = 320;
  useLayoutEffect(() => {
    if (open && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      let left = rect.left;
      if (left + POPOVER_WIDTH > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - POPOVER_WIDTH - 8);
      } else if (left < 8) {
        left = 8;
      }
      setPopoverStyle(
        placement === 'above'
          ? {
              position: 'fixed',
              bottom: window.innerHeight - rect.top + 8,
              left,
              width: POPOVER_WIDTH,
              minWidth: POPOVER_WIDTH,
              zIndex: 99999,
              overflow: 'visible',
            }
          : {
              position: 'fixed',
              top: rect.bottom + 8,
              left,
              width: POPOVER_WIDTH,
              minWidth: POPOVER_WIDTH,
              zIndex: 99999,
              overflow: 'visible',
            }
      );
    }
  }, [open, placement]);

  const handleSelect = (date: Date | undefined) => {
    if (!date) return;
    const iso = format(date, ISO_FORMAT);
    onChange(iso);
    setInputValue(format(date, DISPLAY_FORMAT));
    setOpen(false);
    setView('day');
  };

  const handleInputChange = (_e: React.ChangeEvent<HTMLInputElement>) => {
    // Input is readOnly - user selects via calendar
  };

  return (
    <div ref={containerRef} className={cn('relative', compact ? 'min-w-0' : 'w-full', className)}>
      {label && (
        <label
          htmlFor={id}
          className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2"
        >
          {label}
          {required && <span className="text-[var(--brand)] ml-1">*</span>}
        </label>
      )}
      <div
        className={cn(
          'flex items-center rounded-lg border bg-white transition-all duration-200',
          'focus-within:ring-2 focus-within:ring-[var(--brand)] focus-within:ring-offset-1 focus-within:border-[var(--brand)]',
          error
            ? 'border-red-400 focus-within:ring-red-400'
            : 'border-[var(--border)] hover:border-gray-300',
          disabled && 'bg-gray-50 cursor-not-allowed opacity-60',
          compact ? 'h-8 px-2' : 'h-11 sm:h-12 px-3 sm:px-4'
        )}
      >
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (disabled) return;
            setView('day');
            setOpen(true);
          }}
          readOnly
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'flex-1 min-w-0 bg-transparent border-0 focus:outline-none focus:ring-0',
            'text-base sm:text-sm text-[var(--text)] placeholder:text-gray-400',
            compact ? 'text-xs py-1' : 'py-2'
          )}
        />
        <button
          type="button"
          onClick={() => {
            if (disabled) return;
            setView('day');
            setOpen(!open);
          }}
          disabled={disabled}
          className={cn(
            'flex-shrink-0 p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors',
            open && 'bg-gray-100 text-[var(--brand)]'
          )}
          aria-label="Open calendar"
        >
          <Calendar className="w-5 h-5" strokeWidth={2} />
        </button>
      </div>
      {open && !disabled && typeof document !== 'undefined' &&
        createPortal(
        <div
          ref={popoverRef}
          className="p-3 bg-white rounded-xl shadow-lg border border-gray-200 rdp-datepicker-modern overflow-visible"
          style={popoverStyle}
        >
          {/* Header: \"February 2026\" – cycles day → month → year views on click */}
          <div className="flex items-center justify-center mb-2">
            <button
              type="button"
              className="text-sm font-semibold text-gray-800 hover:text-[var(--brand)]"
              onClick={() => {
                if (view === 'day') setView('year');
                else if (view === 'year') setView('month');
                else setView('day');
              }}
            >
              {format(activeMonth, 'MMMM yyyy')}
            </button>
          </div>

          {view === 'day' && (
            <DayPicker
              mode="single"
              month={activeMonth}
              onMonthChange={setActiveMonth}
              selected={isValidDate ? parsedDate : undefined}
              onSelect={(date) => { if (date) handleSelect(date); }}
              disabled={disableFuture ? { after: today } : undefined}
              styles={{
                caption: { display: 'none' },
                nav: { display: 'none' },
              }}
            />
          )}

          {view === 'month' && (
            <div className="grid grid-cols-3 gap-2 py-1">
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, idx) => {
                const candidate = new Date(activeMonth.getFullYear(), idx, 1);
                const monthDisabled = (disableFuture && candidate > new Date(today.getFullYear(), today.getMonth(), 1)) || activeMonth.getFullYear() < fromYear || activeMonth.getFullYear() > toYear;
                return (
                <button
                  key={m}
                  type="button"
                  className={cn(
                    'py-1.5 text-sm rounded-md hover:bg-gray-100',
                    monthDisabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
                    activeMonth.getMonth() === idx && 'bg-gray-800 text-white'
                  )}
                  disabled={monthDisabled}
                  onClick={() => {
                    const d = new Date(activeMonth);
                    d.setMonth(idx);
                    setActiveMonth(d);
                    setView('day');
                  }}
                >
                  {m}
                </button>
              )})}
            </div>
          )}

          {view === 'year' && (
            <div className="grid grid-cols-3 gap-2 py-1 max-h-52 overflow-y-auto">
              {Array.from({ length: Math.max(0, toYear - fromYear + 1) }).map((_, i) => {
                const year = fromYear + i;
                const yearDisabled = disableFuture && year > today.getFullYear();
                return (
                  <button
                    key={year}
                    type="button"
                    className={cn(
                      'py-1.5 text-sm rounded-md hover:bg-gray-100',
                      yearDisabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
                      activeMonth.getFullYear() === year && 'bg-gray-200 text-[var(--brand)] font-semibold'
                    )}
                    disabled={yearDisabled}
                    onClick={() => {
                      const d = new Date(activeMonth);
                      d.setFullYear(year);
                      setActiveMonth(d);
                      setView('month');
                    }}
                  >
                    {year}
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
            <button
              type="button"
              onClick={() => handleSelect(new Date())}
              className="text-sm font-medium text-[var(--brand)] hover:underline"
            >
              Today
            </button>
          </div>
        </div>,
        document.body
      )}
      {error && <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-red-600">{error}</p>}
    </div>
  );
};
