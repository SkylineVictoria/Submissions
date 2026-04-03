import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';

interface MultiSelectOption {
  value: number;
  label: string;
}

interface MultiSelectProps {
  label?: string;
  value: number[];
  onChange: (value: number[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  /** Max height of dropdown (px) */
  maxHeight?: number;
  /** Label for count display when multiple selected (e.g. "forms", "students") */
  countLabel?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled,
  className,
  required,
  maxHeight = 200,
  countLabel = 'students',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selectRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{
    top: number;
    left: number;
    minWidth: number;
    maxWidth: number;
    maxHeight: number;
  } | null>(null);

  const updatePosition = useCallback(() => {
    if (!isOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
    const margin = 8;
    const gap = 4;
    const spaceBelow = Math.max(0, viewportH - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);
    const openDown = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    const available = openDown ? spaceBelow - gap : spaceAbove - gap;
    const panelMax = Math.min(Math.max(200, maxHeight + 80), Math.max(160, available));
    const top = openDown
      ? rect.bottom + gap
      : Math.max(margin, rect.top - panelMax - gap);
    let left = rect.left;
    const minW = Math.max(rect.width, 280);
    if (left + minW > viewportW - margin) left = Math.max(margin, viewportW - minW - margin);
    if (left < margin) left = margin;
    setDropdownStyle({
      top,
      left,
      minWidth: minW,
      maxWidth: Math.min(400, viewportW - 16),
      maxHeight: panelMax,
    });
  }, [isOpen, maxHeight]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownStyle(null);
      setSearch('');
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
      if (
        selectRef.current &&
        !selectRef.current.contains(target) &&
        !(target as Element).closest?.('[data-multiselect-dropdown]')
      ) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const filteredOptions = search.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase().trim()))
    : options;

  const selectedSet = new Set(value);
  const displayText =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? `${value.length} selected`
        : `${value.length} ${countLabel} selected`;

  const toggleOption = (optValue: number) => {
    const next = new Set(value);
    if (next.has(optValue)) next.delete(optValue);
    else next.add(optValue);
    onChange([...next]);
  };

  const selectId = `multiselect-${Math.random().toString(36).substr(2, 9)}`;

  return (
    <div className={cn('w-full', className)}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-medium text-gray-700 mb-1">
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
            'w-full min-w-0 h-11 px-4 rounded-lg border transition-all duration-200',
            'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
            'border-[var(--border)] hover:border-gray-300',
            'disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-500',
            'text-sm text-left flex items-center justify-between gap-2 bg-white',
            isOpen && 'border-[var(--brand)] ring-2 ring-[var(--brand)] ring-offset-1'
          )}
        >
          <span
            className={cn('min-w-0 truncate', value.length ? 'text-gray-900' : 'text-gray-400')}
            title={displayText}
          >
            {displayText}
          </span>
          <ChevronDown
            className={cn('w-5 h-5 shrink-0 text-gray-400 transition-transform duration-200', isOpen && 'rotate-180')}
          />
        </button>

        {isOpen &&
          dropdownStyle &&
          typeof document !== 'undefined' &&
          createPortal(
            <div
              data-multiselect-dropdown
              className="fixed z-[10000] flex max-h-[min(360px,calc(100vh-16px))] flex-col overflow-hidden rounded-lg border-2 border-gray-200 bg-white shadow-lg"
              style={{
                top: dropdownStyle.top,
                left: dropdownStyle.left,
                minWidth: dropdownStyle.minWidth,
                maxWidth: dropdownStyle.maxWidth,
                maxHeight: dropdownStyle.maxHeight,
              }}
            >
              <div className="shrink-0 border-b border-gray-100 p-2">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search students..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none focus:ring-1 focus:ring-[var(--brand)]"
                  autoFocus
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {filteredOptions.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500">No students found</div>
                ) : (
                  filteredOptions.map((opt) => (
                    <label
                      key={opt.value}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSet.has(opt.value)}
                        onChange={() => toggleOption(opt.value)}
                        className="w-4 h-4 rounded border-gray-300 text-[var(--brand)] focus:ring-[var(--brand)]"
                      />
                      <span className="text-sm text-gray-900 truncate" title={opt.label}>
                        {opt.label}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>,
            document.body
          )}
      </div>
    </div>
  );
};
