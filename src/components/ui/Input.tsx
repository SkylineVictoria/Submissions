import React, { useMemo } from 'react';
import { cn } from '../utils/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  tooltip?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  tooltip,
  className,
  id,
  required,
  ...props
}) => {
  const inputId = useMemo(() => id || `input-${Math.random().toString(36).substr(2, 9)}`, [id]);

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2 whitespace-pre-line">
          {label}
          {required && <span className="text-[#F27A1A] ml-1">*</span>}
          {tooltip && (
            <span className="ml-1 sm:ml-2 text-gray-400 cursor-help" title={tooltip}>
              <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
          )}
        </label>
      )}
      <input
        id={inputId}
        className={cn(
          'w-full h-11 sm:h-12 px-3 sm:px-4 rounded-lg border transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
          'text-base sm:text-sm', // Larger text on mobile for better UX
          error
            ? 'border-red-400 focus:ring-red-400 focus:border-red-400 bg-red-50'
            : 'border-[var(--border)] hover:border-gray-300 bg-blue-50/70',
          'disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-500',
          'text-[var(--text)] placeholder:text-gray-400',
          props.type === 'date' && 'input-date-styled cursor-pointer',
          className
        )}
        required={required}
        {...props}
      />
      {error && <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-red-600">{error}</p>}
      {helperText && !error && <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-gray-500">{helperText}</p>}
    </div>
  );
};

