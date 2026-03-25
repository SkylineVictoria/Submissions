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

/** Height in px for a finite answer box based on word limit (~10 words per line, 24px line height).
 * Supports large limits (e.g. 1000 words ≈ 2400px). Cap at 3000px for very long responses. */
export function heightFromWordLimit(wordLimit: number | null | undefined): number {
  if (!wordLimit || wordLimit < 1) return 96;
  const lines = Math.max(1, Math.ceil(wordLimit / 10));
  return Math.min(3000, Math.max(36, lines * 24));
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
  maxWords?: number;
  maxChars?: number;
  /** When true, use fixed height from maxWords so all students get same space */
  fixedHeightFromWordLimit?: boolean;
}

export const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  helperText,
  maxWords,
  maxChars,
  fixedHeightFromWordLimit = false,
  className,
  id,
  required,
  value = '',
  onChange,
  ...props
}) => {
  const fixedHeight = fixedHeightFromWordLimit && maxWords ? heightFromWordLimit(maxWords) : null;
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
        <label htmlFor={textareaId} className="block text-xs sm:text-sm font-semibold text-gray-700 mb-1.5 sm:mb-2 whitespace-pre-line">
          {label}
          {required && <span className="text-[var(--brand)] ml-1">*</span>}
        </label>
      )}
      <textarea
        id={textareaId}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.stopPropagation();
        }}
        className={cn(
          'w-full px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg border transition-all duration-200',
          fixedHeight ? 'resize-none' : 'min-h-[100px] sm:min-h-[120px] resize-vertical',
          'focus:outline-none focus:ring-2 focus:ring-[var(--brand)] focus:ring-offset-1 focus:border-[var(--brand)]',
          'text-base sm:text-sm',
          error
            ? 'border-red-400 focus:ring-red-400 focus:border-red-400 bg-red-50'
            : 'border-[var(--border)] hover:border-gray-300 bg-blue-50/70',
          'disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-500',
          'text-[var(--text)] placeholder:text-gray-400',
          className
        )}
        style={fixedHeight ? { minHeight: fixedHeight, maxHeight: fixedHeight, height: fixedHeight } : undefined}
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

