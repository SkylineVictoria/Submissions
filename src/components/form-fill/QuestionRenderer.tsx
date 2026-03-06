import React from 'react';
import type { FormQuestionWithOptionsAndRows } from '../../lib/formEngine';
import { Input } from '../ui/Input';
import { DatePicker } from '../ui/DatePicker';
import { Textarea } from '../ui/Textarea';
import { RadioGroup } from '../ui/RadioGroup';
import { Checkbox } from '../ui/Checkbox';
import { LikertTableQuestion } from './LikertTableQuestion';
import { GridTableQuestion } from './GridTableQuestion';
import { SignaturePad } from './SignaturePad';

const countWords = (text: string): number =>
  text.trim() ? text.trim().split(/\s+/).length : 0;
const truncateToWordLimit = (text: string, maxWords: number): string => {
  if (!text.trim()) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
};
const normalizeWordLimit = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

interface QuestionRendererProps {
  question: FormQuestionWithOptionsAndRows;
  value: string | number | boolean | Record<string, unknown> | string[] | null;
  onChange: (value: string | number | boolean | Record<string, unknown> | string[]) => void;
  disabled?: boolean;
  error?: string;
  declarationStyle?: boolean;
}

export const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  value,
  onChange,
  disabled,
  error,
  declarationStyle,
}) => {
  const pm = (question.pdf_meta as Record<string, unknown>) || {};
  const wordLimit = normalizeWordLimit(pm.wordLimit);
  if (question.type === 'instruction_block') {
    return (
      <div className="py-2">
        <div className="text-sm font-medium text-gray-700 whitespace-pre-line">{question.label}</div>
        {question.help_text && (
          <div className="text-xs text-gray-500 mt-1">{question.help_text}</div>
        )}
      </div>
    );
  }

  if (question.type === 'page_break') {
    return (
      <div className="py-8 border-b-2 border-dashed border-gray-300" />
    );
  }

  if (question.type === 'likert_5') {
    return (
      <LikertTableQuestion
        question={question}
        value={value as string | number | Record<string, string> | null}
        onChange={(v) => onChange(v)}
        disabled={disabled}
        error={error}
      />
    );
  }

  if (question.type === 'grid_table') {
    return (
      <GridTableQuestion
        question={question}
        value={value as Record<string, string> | null}
        onChange={(v) => onChange(v)}
        disabled={disabled}
        error={error}
      />
    );
  }

  if (question.type === 'signature') {
    return (
      <SignaturePad
        label={question.label}
        value={value as string | null}
        onChange={(v) => onChange(v as string)}
        disabled={disabled}
        error={error}
      />
    );
  }

  if (question.type === 'short_text') {
    const isDateField = question.code === 'evaluation.trainingDates' || question.code === 'evaluation.evaluationDate';
    if (isDateField) {
      return (
        <DatePicker
          label={question.label}
          value={(value as string) || ''}
          onChange={(v) => onChange(v)}
          disabled={disabled}
          error={error}
          required={question.required && !disabled}
          placement="above"
        />
      );
    }
    return (
      <Input
        label={question.label}
        value={(value as string) || ''}
        onChange={(e) => {
          const next = e.target.value;
          onChange(wordLimit ? truncateToWordLimit(next, wordLimit) : next);
        }}
        disabled={disabled}
        error={error}
        required={question.required && !disabled}
        helperText={[question.help_text, wordLimit ? `${countWords(String(value || ''))} / ${wordLimit} words` : null].filter(Boolean).join(' • ') || undefined}
      />
    );
  }

  if (question.type === 'long_text') {
    return (
      <Textarea
        label={question.label}
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        error={error}
        required={question.required && !disabled}
        helperText={question.help_text || undefined}
        rows={wordLimit ? Math.max(2, Math.min(10, Math.ceil(wordLimit / 10))) : 8}
        maxWords={wordLimit ?? undefined}
        fixedHeightFromWordLimit={!!wordLimit}
      />
    );
  }

  if (question.type === 'date') {
    return (
      <DatePicker
        label={question.label}
        value={(value as string) || ''}
        onChange={(v) => onChange(v)}
        disabled={disabled}
        error={error}
        required={question.required && !disabled}
        placement="above"
      />
    );
  }

  if (question.type === 'yes_no') {
    if (declarationStyle) {
      const checked = value === 'yes' || value === true || value === 'true';
      return (
        <div>
          <Checkbox
            label={`${question.label}${question.required ? ' *' : ''}`}
            checked={checked}
            onChange={(v) => onChange(v ? 'yes' : 'no')}
            disabled={disabled}
            labelClassName="italic"
          />
          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        </div>
      );
    }
    return (
      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2 whitespace-pre-line">
          {question.label}
          {question.required && <span className="text-[var(--brand)] ml-1">*</span>}
        </div>
        <RadioGroup
          name={`q-${question.id}`}
          value={(value as string) || ''}
          onChange={(v) => onChange(v)}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          disabled={disabled}
        />
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (question.type === 'single_choice') {
    return (
      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2 whitespace-pre-line">
          {question.label}
          {question.required && <span className="text-[var(--brand)] ml-1">*</span>}
        </div>
        <RadioGroup
          name={`q-${question.id}`}
          value={(value as string) || ''}
          onChange={(v) => onChange(v)}
          options={question.options.map((o) => ({ value: o.value, label: o.label }))}
          disabled={disabled}
          orientation="vertical"
        />
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  if (question.type === 'multi_choice') {
    const selected = new Set((Array.isArray(value) ? value : []) as string[]);
    return (
      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2 whitespace-pre-line">
          {question.label}
          {question.required && <span className="text-[var(--brand)] ml-1">*</span>}
        </div>
        <div className="space-y-2">
          {question.options.map((opt) => (
            <Checkbox
              key={opt.id}
              label={opt.label}
              checked={selected.has(opt.value)}
              onChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(opt.value);
                else next.delete(opt.value);
                onChange(Array.from(next));
              }}
              disabled={disabled}
            />
          ))}
        </div>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return null;
};
