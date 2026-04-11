import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  error?: string;
  helperText?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  /**
   * Narrow trigger + shorter scrollable menu (e.g. page numbers).
   */
  compact?: boolean;
  /**
   * @deprecated Dropdown always renders in a portal to avoid clipping in modals / overflow containers.
   */
  portal?: boolean;
}

const DROPDOWN_MAX_HEIGHT = 240;
/** Default max height for `compact` selects (scroll inside list). */
const COMPACT_MENU_MAX_HEIGHT = 200;

type DropdownPosition = {
  top: number;
  left: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
};

function computeDropdownPosition(
  trigger: DOMRect,
  opts?: { compact?: boolean }
): DropdownPosition {
  const margin = 8;
  const gap = 4;
  const compact = opts?.compact === true;
  const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
  const spaceBelow = Math.max(0, viewportH - trigger.bottom - margin);
  const spaceAbove = Math.max(0, trigger.top - margin);
  const openDown = spaceBelow >= 160 || spaceBelow >= spaceAbove;
  const available = openDown ? spaceBelow - gap : spaceAbove - gap;
  const cap = compact ? COMPACT_MENU_MAX_HEIGHT : DROPDOWN_MAX_HEIGHT;
  const minList = compact ? 88 : 120;
  const maxHeight = Math.min(cap, Math.max(minList, available));
  const top = openDown
    ? trigger.bottom + gap
    : Math.max(margin, trigger.top - maxHeight - gap);
  let left = trigger.left;
  const minMenu = compact ? Math.max(trigger.width, 64) : Math.max(trigger.width, 180);
  const minWidth = minMenu;
  const maxWidth = Math.min(compact ? 120 : 360, viewportW - 16);
  const clampedMin = Math.min(minWidth, maxWidth);
  if (left + clampedMin > viewportW - margin) {
    left = Math.max(margin, viewportW - clampedMin - margin);
  }
  if (left < margin) left = margin;
  return { top, left, minWidth: clampedMin, maxWidth, maxHeight };
}

export const Select: React.FC<SelectProps> = ({
  label,
  value,
  onChange,
  options,
  error,
  helperText,
  disabled,
  className,
  required,
  compact,
  portal: _portal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<DropdownPosition | null>(null);
  const selectId = `select-${Math.random().toString(36).substr(2, 9)}`;

  const updatePosition = useCallback(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setDropdownStyle(computeDropdownPosition(rect, { compact }));
  }, [isOpen, compact]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownStyle(null);
      return;
    }
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);


  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (selectRef.current && !selectRef.current.contains(target) && !(target as Element).closest?.('[data-select-dropdown]')) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-semibold text-gray-700 mb-2">
          {label}
          {required && <span className="text-[#F27A1A] ml-1">*</span>}
        </label>
      )}
      <div ref={selectRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          id={selectId}
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={cn(
            'w-full min-w-0 rounded-lg border transition-all duration-200',
            compact ? 'h-10 px-2.5 text-base font-semibold tabular-nums' : 'h-12 px-4 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
            error
              ? 'border-red-400 focus:ring-red-400 focus:border-red-400 bg-red-50'
              : compact
                ? 'border-[var(--border)] bg-blue-50/70 hover:border-gray-400'
                : 'border-[var(--border)] hover:border-gray-300',
            'disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-500',
            'text-left flex items-center justify-between gap-1.5 bg-white',
            isOpen && 'border-[var(--brand)] ring-2 ring-[var(--brand)] ring-offset-1'
          )}
        >
          <span
            className={cn(
              'min-w-0 truncate text-center flex-1',
              selectedOption ? 'text-gray-900' : 'text-gray-400',
              compact && 'font-semibold tabular-nums'
            )}
            title={selectedOption?.label || undefined}
          >
            {selectedOption?.label || (compact ? '—' : 'Select an option...')}
          </span>
          <ChevronDown
            className={cn(
              'shrink-0 text-gray-400 transition-transform duration-200',
              compact ? 'h-4 w-4' : 'w-5 h-5',
              isOpen && 'transform rotate-180'
            )}
          />
        </button>

        {isOpen && dropdownStyle && typeof document !== 'undefined' &&
          createPortal(
            <div
              data-select-dropdown
              className="fixed z-[10000] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl ring-1 ring-black/5"
              style={{
                top: dropdownStyle.top,
                left: dropdownStyle.left,
                minWidth: dropdownStyle.minWidth,
                maxWidth: dropdownStyle.maxWidth,
                maxHeight: dropdownStyle.maxHeight,
              }}
            >
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    className={cn(
                      'w-full transition-colors whitespace-nowrap overflow-hidden text-ellipsis',
                      compact ? 'px-3 py-2 text-center text-base font-medium tabular-nums' : 'px-4 py-2.5 text-left text-sm',
                      'hover:bg-[var(--brand)] hover:text-white',
                      value === option.value && 'bg-orange-50 text-[var(--brand)] font-semibold'
                    )}
                    title={option.label}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>,
            document.body
          )}
      </div>
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
      {helperText && !error && <p className="mt-1.5 text-sm text-gray-500">{helperText}</p>}
    </div>
  );
};
