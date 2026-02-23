import React from 'react';
import { cn } from '../utils/cn';

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function truncateToWordLimit(text: string, maxWords: number): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const words = trimmed.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  maxWords?: number;
  maxChars?: number;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  helperText,
  maxWords,
  maxChars,
  className,
  id,
  required,
  value = '',
  onChange,
  ...props
}) => {
  const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
  const strValue = typeof value === 'string' ? value : '';
  const wordCount = countWords(strValue);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!onChange) return;
    let newValue = e.target.value;
    if (maxChars != null && newValue.length > maxChars) {
      newValue = newValue.slice(0, maxChars);
    }
    if (maxWords != null && countWords(newValue) > maxWords) {
      newValue = truncateToWordLimit(newValue, maxWords);
    }
    onChange({ ...e, target: { ...e.target, value: newValue } } as React.ChangeEvent<HTMLTextAreaElement>);
  };

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={textareaId} className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2">
          {label}
          {required && <span className="text-[var(--brand)] ml-1">*</span>}
        </label>
      )}
      <textarea
        id={textareaId}
        className={cn(
          'w-full min-h-[100px] sm:min-h-[120px] px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg border transition-all duration-200',
          'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
          'text-base sm:text-sm', // Larger text on mobile
          error
            ? 'border-red-400 focus:ring-red-400 focus:border-red-400 bg-red-50'
            : 'border-[var(--border)] hover:border-gray-300 bg-white',
          'disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-500',
          'text-[var(--text)] placeholder:text-gray-400 resize-vertical',
          className
        )}
        required={required}
        value={value}
        onChange={handleChange}
        {...props}
      />
      {maxChars != null && (
        <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-gray-500">
          {strValue.length} / {maxChars} characters
        </p>
      )}
      {maxChars == null && maxWords != null && (
        <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-gray-500">
          {wordCount} / {maxWords} words
        </p>
      )}
      {error && <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-red-600">{error}</p>}
      {helperText && !error && <p className="mt-1 sm:mt-1.5 text-xs sm:text-sm text-gray-500">{helperText}</p>}
    </div>
  );
};

