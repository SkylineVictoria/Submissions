import React, { useState, useRef, useEffect } from 'react';
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
  /** Render dropdown in a portal (good for tables); default false (inline inside container). */
  portal?: boolean;
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
  portal = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const selectRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<{ top: number; left: number; minWidth: number } | null>(null);
  const selectId = `select-${Math.random().toString(36).substr(2, 9)}`;

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setDropdownStyle({
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: rect.width,
      });
    } else {
      setDropdownStyle(null);
    }
  }, [isOpen]);

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
            'w-full min-w-0 h-12 px-4 rounded-lg border transition-all duration-200',
            'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
            error
              ? 'border-red-400 focus:ring-red-400 focus:border-red-400 bg-red-50'
              : 'border-[var(--border)] hover:border-gray-300',
            'disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-500',
            'text-sm text-left flex items-center justify-between gap-2 bg-white',
            isOpen && 'border-[var(--brand)] ring-2 ring-[var(--brand)] ring-offset-1'
          )}
        >
          <span className={cn('min-w-0 truncate', selectedOption ? 'text-gray-900' : 'text-gray-400')} title={selectedOption?.label || undefined}>
            {selectedOption?.label || 'Select an option...'}
          </span>
          <ChevronDown
            className={cn(
              'w-5 h-5 shrink-0 text-gray-400 transition-transform duration-200',
              isOpen && 'transform rotate-180'
            )}
          />
        </button>

        {portal && isOpen && dropdownStyle && typeof document !== 'undefined' &&
          createPortal(
            <div
              data-select-dropdown
              className="fixed z-[9999] max-h-60 overflow-auto bg-white border-2 border-gray-200 rounded-lg shadow-lg py-1"
              style={{
                top: dropdownStyle.top,
                left: dropdownStyle.left,
                minWidth: dropdownStyle.minWidth,
              }}
            >
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    'w-full px-4 py-2.5 text-left text-sm transition-colors whitespace-nowrap overflow-hidden text-ellipsis',
                    'hover:bg-[var(--brand)] hover:text-white',
                    value === option.value && 'bg-orange-50 text-[var(--brand)] font-semibold'
                  )}
                  title={option.label}
                >
                  {option.label}
                </button>
              ))}
            </div>,
            document.body
          )
        }
        {!portal && isOpen && (
          <div className="absolute z-[100] left-1/2 -translate-x-1/2 mt-1 min-w-full bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  'w-full px-4 py-2.5 text-left text-sm transition-colors whitespace-nowrap overflow-hidden text-ellipsis',
                  'hover:bg-[var(--brand)] hover:text-white',
                  value === option.value && 'bg-orange-50 text-[var(--brand)] font-semibold'
                )}
                title={option.label}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="mt-1.5 text-sm text-red-600">{error}</p>}
      {helperText && !error && <p className="mt-1.5 text-sm text-gray-500">{helperText}</p>}
    </div>
  );
};

