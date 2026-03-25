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

type ImageLayoutOption = 'side_by_side' | 'above' | 'below';

function QuestionLabelWithImage({
  label,
  helpText,
  imageUrl,
  imageLayout = 'side_by_side',
  imageWidthPercent = 50,
  children,
}: {
  label: React.ReactNode;
  helpText?: string | null;
  imageUrl?: string | null;
  imageLayout?: ImageLayoutOption;
  imageWidthPercent?: number;
  children?: React.ReactNode;
}) {
  const imgEl = imageUrl ? (
    <img src={imageUrl} alt="" className="max-w-full h-auto object-contain rounded border border-gray-200" style={{ maxHeight: 280 }} />
  ) : null;
  const textBlock = (
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium text-gray-700 whitespace-pre-line">{label}</div>
      {helpText && <div className="text-xs text-gray-500 mt-1">{helpText}</div>}
      {children}
    </div>
  );

  if (!imgEl) {
    return (
      <div>
        <div className="text-sm font-medium text-gray-700 whitespace-pre-line">{label}</div>
        {helpText && <div className="text-xs text-gray-500 mt-1">{helpText}</div>}
        {children}
      </div>
    );
  }

  if (imageLayout === 'above') {
    return (
      <div>
        <div className="mb-2">{imgEl}</div>
        {textBlock}
      </div>
    );
  }
  if (imageLayout === 'below') {
    return (
      <div>
        {textBlock}
        <div className="mt-2">{imgEl}</div>
      </div>
    );
  }
  const pct = Math.max(20, Math.min(80, imageWidthPercent || 50));
  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-700 whitespace-pre-line">{label}</div>
        {helpText && <div className="text-xs text-gray-500 mt-1">{helpText}</div>}
        {children}
      </div>
      <div style={{ width: `${pct}%`, flexShrink: 0 }}>{imgEl}</div>
    </div>
  );
}

interface QuestionRendererProps {
  question: FormQuestionWithOptionsAndRows;
  value: string | number | boolean | Record<string, unknown> | string[] | null;
  onChange: (value: string | number | boolean | Record<string, unknown> | string[]) => void;
  disabled?: boolean;
  error?: string;
  declarationStyle?: boolean;
  /** Highlight inputs the current user needs to fill (student/trainer) */
  highlightAsFill?: boolean;
  /** For Assessment Task 2+ grid_table: show per-row check/cancel */
  showRowAssessmentColumn?: boolean;
  rowAssessments?: Record<number, string>;
  onRowAssessmentChange?: (rowId: number, satisfactory: 'yes' | 'no') => void;
  /** When true (student resubmission), grid rows where trainer marked satisfactory='yes' become read-only */
  studentResubmissionReadOnlyForSatisfactoryRows?: boolean;
  /** When the parent UI already shows `question.label` (e.g. task question card header), hide the duplicate above the grid. */
  hideQuestionLabel?: boolean;
  /** Task assessment section: 1-based index matching PDF Q1, Q2, … (see getTaskQuestionDisplayNumbers). */
  taskQuestionDisplayNumber?: number;
  /** Passed to DatePicker for `evaluation.evaluationDate` etc. (ISO yyyy-MM-dd). */
  minDate?: string;
  maxDate?: string;
}

export const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  value,
  onChange,
  disabled,
  error,
  declarationStyle,
  highlightAsFill,
  showRowAssessmentColumn,
  rowAssessments,
  onRowAssessmentChange,
  studentResubmissionReadOnlyForSatisfactoryRows,
  hideQuestionLabel,
  taskQuestionDisplayNumber,
  minDate,
  maxDate,
}) => {
  const pm = (question.pdf_meta as Record<string, unknown>) || {};
  const wordLimit = normalizeWordLimit(pm.wordLimit);
  const taskLabel = (label: string) =>
    taskQuestionDisplayNumber != null ? `Q${taskQuestionDisplayNumber}: ${label}` : label;
  const shouldHighlight = !!highlightAsFill && !disabled;
  /** Match task results / tables: editable fields use a steady fill; keep error state visible. */
  const fillBgClass = disabled || error ? undefined : 'bg-blue-50/70';
  if (question.type === 'instruction_block') {
    const imgUrl = pm.imageUrl as string | undefined;
    return (
      <div className="py-2">
        <QuestionLabelWithImage
          label={question.label}
          helpText={question.help_text}
          imageUrl={imgUrl}
          imageLayout={(pm.imageLayout as ImageLayoutOption) || 'side_by_side'}
          imageWidthPercent={(pm.imageWidthPercent as number) ?? 50}
        />
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
      <div className="space-y-2">
        {!hideQuestionLabel && question.label?.trim() && (
          <div>
            <div className="text-sm font-medium text-gray-700 whitespace-pre-line">{taskLabel(question.label)}</div>
            {question.help_text && <div className="text-xs text-gray-500 mt-1">{question.help_text}</div>}
          </div>
        )}
        <GridTableQuestion
          question={question}
          value={value as Record<string, string> | null}
          onChange={(v) => onChange(v)}
          disabled={disabled}
          error={error}
          showRowAssessmentColumn={showRowAssessmentColumn}
          rowAssessments={rowAssessments}
          onRowAssessmentChange={onRowAssessmentChange}
          studentResubmissionReadOnlyForSatisfactoryRows={studentResubmissionReadOnlyForSatisfactoryRows}
          highlight={shouldHighlight}
        />
      </div>
    );
  }

  if (question.type === 'signature') {
    const raw = value;
    const rawObj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    const sigValue =
      rawObj
        ? (String(rawObj.signature ?? rawObj.imageDataUrl ?? rawObj.typedText ?? '').trim() || null)
        : (typeof raw === 'string' ? (raw.trim() || null) : null);
    return (
      <SignaturePad
        label={taskLabel(question.label)}
        value={sigValue}
        onChange={(v) => {
          if (rawObj) {
            onChange({ ...rawObj, signature: v } as Record<string, unknown>);
          } else {
            onChange(v as string);
          }
        }}
        disabled={disabled}
        error={error}
        highlight={shouldHighlight}
      />
    );
  }

  if (question.type === 'short_text') {
    const isDateField = question.code === 'evaluation.trainingDates' || question.code === 'evaluation.evaluationDate';
    if (isDateField) {
      return (
        <DatePicker
          label={taskLabel(question.label)}
          value={(value as string) || ''}
          onChange={(v) => onChange(v)}
          disabled={disabled}
          error={error}
          required={question.required && !disabled}
          placement="above"
          highlight={shouldHighlight}
          minDate={minDate}
          maxDate={maxDate}
        />
      );
    }
    const imgUrl = pm.imageUrl as string | undefined;
    if (imgUrl) {
      return (
        <div>
          <QuestionLabelWithImage
            label={taskLabel(question.label)}
            helpText={question.help_text}
            imageUrl={imgUrl}
            imageLayout={(pm.imageLayout as ImageLayoutOption) || 'side_by_side'}
            imageWidthPercent={(pm.imageWidthPercent as number) ?? 50}
          >
            <div className="mt-2">
              <Input
                value={(value as string) || ''}
                onChange={(e) => {
                  const next = e.target.value;
                  onChange(wordLimit ? truncateToWordLimit(next, wordLimit) : next);
                }}
                disabled={disabled}
                error={error}
                className={fillBgClass}
                required={question.required && !disabled}
                helperText={wordLimit ? `${countWords(String(value || ''))} / ${wordLimit} words` : undefined}
              />
            </div>
          </QuestionLabelWithImage>
        </div>
      );
    }
    return (
      <Input
        label={taskLabel(question.label)}
        value={(value as string) || ''}
        onChange={(e) => {
          const next = e.target.value;
          onChange(wordLimit ? truncateToWordLimit(next, wordLimit) : next);
        }}
        disabled={disabled}
        error={error}
        className={fillBgClass}
        required={question.required && !disabled}
        helperText={[question.help_text, wordLimit ? `${countWords(String(value || ''))} / ${wordLimit} words` : null].filter(Boolean).join(' • ') || undefined}
      />
    );
  }

  if (question.type === 'long_text') {
    const imgUrl = pm.imageUrl as string | undefined;
    if (imgUrl) {
      return (
        <div>
          <QuestionLabelWithImage
            label={taskLabel(question.label)}
            helpText={question.help_text}
            imageUrl={imgUrl}
            imageLayout={(pm.imageLayout as ImageLayoutOption) || 'side_by_side'}
            imageWidthPercent={(pm.imageWidthPercent as number) ?? 50}
          >
            <div className="mt-2">
              <Textarea
                value={(value as string) || ''}
                onChange={(e) => onChange(e.target.value)}
                disabled={disabled}
                error={error}
                className={fillBgClass}
                required={question.required && !disabled}
                helperText={wordLimit ? `${countWords(String(value || ''))} / ${wordLimit} words` : undefined}
                rows={wordLimit ? Math.max(2, Math.min(10, Math.ceil(wordLimit / 10))) : 8}
                maxWords={wordLimit ?? undefined}
                fixedHeightFromWordLimit={!!wordLimit}
              />
            </div>
          </QuestionLabelWithImage>
        </div>
      );
    }
    return (
      <Textarea
        label={taskLabel(question.label)}
        value={(value as string) || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        error={error}
        className={fillBgClass}
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
        label={taskLabel(question.label)}
        value={(value as string) || ''}
        onChange={(v) => onChange(v)}
        disabled={disabled}
        error={error}
        required={question.required && !disabled}
        placement="above"
        highlight={shouldHighlight}
        minDate={minDate}
        maxDate={maxDate}
      />
    );
  }

  if (question.type === 'yes_no') {
    if (declarationStyle) {
      const checked = value === 'yes' || value === true || value === 'true';
      return (
        <div>
          <Checkbox
            label={`${taskLabel(question.label)}${question.required ? ' *' : ''}`}
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
          {taskLabel(question.label)}
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
          {taskLabel(question.label)}
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
          {taskLabel(question.label)}
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
