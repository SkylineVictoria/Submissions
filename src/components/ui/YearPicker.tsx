import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../utils/cn';

export const YEAR_NOT_SPECIFIED = 'Not specified';

interface YearPickerProps {
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
  allowNotSpecified?: boolean;
}

export const YearPicker: React.FC<YearPickerProps> = ({
  value = '',
  onChange,
  disabled = false,
  label,
  error,
  required,
  placeholder = 'Select year',
  className,
  id,
  placement = 'below',
  fromYear = 1980,
  toYear = new Date().getFullYear(),
  allowNotSpecified = true,
}) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const minY = Math.min(fromYear, toYear);
  const maxY = Math.max(fromYear, toYear);
  const pageSize = 12;

  const parsedYear =
    value && value !== YEAR_NOT_SPECIFIED && /^\d{4}$/.test(value) ? Number(value) : null;

  const [pageStart, setPageStart] = useState(() => {
    const anchor = parsedYear ?? maxY;
    return Math.max(minY, Math.min(anchor, maxY - pageSize + 1));
  });

  const updatePopoverPosition = () => {
    if (!open || !inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const POPOVER_WIDTH = 280;
    const POPOVER_EST_HEIGHT = 300;
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
    if (!value.trim()) {
      setInputValue('');
      return;
    }
    setInputValue(value === YEAR_NOT_SPECIFIED ? YEAR_NOT_SPECIFIED : value);
    if (parsedYear != null) {
      setPageStart(Math.max(minY, Math.min(parsedYear, maxY - pageSize + 1)));
    }
  }, [value, parsedYear, minY, maxY]);

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

  const pageEnd = Math.min(maxY, pageStart + pageSize - 1);
  const yearsOnPage: number[] = [];
  for (let y = pageEnd; y >= pageStart; y--) yearsOnPage.push(y);

  const canPrevPage = pageStart > minY;
  const canNextPage = pageEnd < maxY;

  const selectYear = (y: number | typeof YEAR_NOT_SPECIFIED) => {
    onChange(y === YEAR_NOT_SPECIFIED ? YEAR_NOT_SPECIFIED : String(y));
    setInputValue(y === YEAR_NOT_SPECIFIED ? YEAR_NOT_SPECIFIED : String(y));
    setOpen(false);
  };

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
            setOpen(!open);
          }}
          disabled={disabled}
          className={cn(
            'flex-shrink-0 p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors',
            open && 'bg-gray-100 text-[var(--brand)]'
          )}
          aria-label="Open year picker"
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
                  !canPrevPage && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
                disabled={!canPrevPage}
                onClick={() => setPageStart((s) => Math.max(minY, s - pageSize))}
                aria-label="Earlier years"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold text-gray-800">
                {pageEnd} – {pageStart}
              </span>
              <button
                type="button"
                className={cn(
                  'p-1.5 rounded-md text-gray-600 hover:bg-gray-100',
                  !canNextPage && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                )}
                disabled={!canNextPage}
                onClick={() => setPageStart((s) => Math.min(maxY - pageSize + 1, s + pageSize))}
                aria-label="Later years"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {allowNotSpecified && (
              <button
                type="button"
                className={cn(
                  'w-full mb-2 py-2 text-sm rounded-md border border-gray-200 hover:bg-gray-50',
                  value === YEAR_NOT_SPECIFIED && 'bg-gray-800 text-white hover:bg-gray-800'
                )}
                onClick={() => selectYear(YEAR_NOT_SPECIFIED)}
              >
                {YEAR_NOT_SPECIFIED}
              </button>
            )}

            <div className="grid grid-cols-3 gap-2 py-1 max-h-52 overflow-y-auto">
              {yearsOnPage.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={cn(
                    'py-2 text-sm rounded-md hover:bg-gray-100',
                    parsedYear === y && 'bg-gray-800 text-white hover:bg-gray-800'
                  )}
                  onClick={() => selectYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>

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
