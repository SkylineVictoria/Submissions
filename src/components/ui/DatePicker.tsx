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
}) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});

  const parsedDate = value ? parse(value, ISO_FORMAT, new Date()) : undefined;
  const isValidDate = parsedDate && isValid(parsedDate);

  useEffect(() => {
    if (value && isValid(parse(value, ISO_FORMAT, new Date()))) {
      const d = parse(value, ISO_FORMAT, new Date());
      setInputValue(format(d, DISPLAY_FORMAT));
    } else {
      setInputValue('');
    }
  }, [value]);

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

  // Close popover when user scrolls (it uses position:fixed so would stay put otherwise)
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, [open]);

  // Position popover relative to input (for portal - avoids overflow clipping)
  useLayoutEffect(() => {
    if (open && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setPopoverStyle(
        placement === 'above'
          ? {
              position: 'fixed',
              bottom: window.innerHeight - rect.top + 8,
              left: rect.left,
              zIndex: 9999,
            }
          : {
              position: 'fixed',
              top: rect.bottom + 8,
              left: rect.left,
              zIndex: 9999,
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
  };

  const handleInputChange = (_e: React.ChangeEvent<HTMLInputElement>) => {
    // Input is readOnly - user selects via calendar
  };

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
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
          onFocus={() => !disabled && setOpen(true)}
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
          onClick={() => !disabled && setOpen(!open)}
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
      {open && !disabled && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="p-3 bg-white rounded-xl shadow-lg border border-gray-200 rdp-datepicker-modern"
          style={{ ...popoverStyle, minWidth: '280px' }}
        >
          <DayPicker
            mode="single"
            selected={isValidDate ? parsedDate : undefined}
            onSelect={(date) => { if (date) handleSelect(date); }}
            defaultMonth={isValidDate ? parsedDate : new Date()}
          />
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
