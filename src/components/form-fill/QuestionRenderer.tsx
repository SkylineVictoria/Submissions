import React from 'react';
import { ClipboardPaste, ImagePlus } from 'lucide-react';
import type { FormQuestionWithOptionsAndRows } from '../../lib/formEngine';
import { DatePicker } from '../ui/DatePicker';
import { Textarea } from '../ui/Textarea';
import { RadioGroup } from '../ui/RadioGroup';
import { Checkbox } from '../ui/Checkbox';
import { LikertTableQuestion } from './LikertTableQuestion';
import { GridTableQuestion } from './GridTableQuestion';
import { SignaturePad } from './SignaturePad';
import { cn } from '../utils/cn';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { deleteAnswerImageByPublicUrl, uploadAnswerImage } from '../../lib/storage';

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
  /** Needed for image answer uploads (stored under instance). */
  instanceId?: number;
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

function ImageAnswerField({
  instanceId,
  questionId,
  label,
  helpText,
  promptImageUrl,
  promptImageLayout,
  promptImageWidthPercent,
  disabled,
  error,
  highlight,
  value,
  onChange,
  fillBgClass,
}: {
  instanceId?: number;
  questionId: number;
  label: React.ReactNode;
  helpText?: string | null;
  promptImageUrl?: string | null;
  promptImageLayout?: ImageLayoutOption;
  promptImageWidthPercent?: number;
  disabled?: boolean;
  error?: string;
  highlight?: boolean;
  value: string | number | boolean | Record<string, unknown> | string[] | null;
  onChange: (value: string | number | boolean | Record<string, unknown> | string[]) => void;
  fillBgClass?: string;
}) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const url = raw ? String(raw.url ?? '') : typeof value === 'string' ? value : '';
  const [uploading, setUploading] = React.useState(false);
  const [localErr, setLocalErr] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const canUpload = !disabled && Number.isFinite(Number(instanceId)) && Number(instanceId) > 0;

  const doUpload = async (file: File) => {
    if (!canUpload) return;
    setLocalErr(null);
    setUploading(true);
    try {
      const res = await uploadAnswerImage(Number(instanceId), Number(questionId), file);
      if (!res.url) {
        setLocalErr(res.error || 'Upload failed');
        return;
      }
      onChange({ url: res.url } as Record<string, unknown>);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <QuestionLabelWithImage
        label={label}
        helpText={helpText}
        imageUrl={promptImageUrl || undefined}
        imageLayout={promptImageLayout || 'side_by_side'}
        imageWidthPercent={promptImageWidthPercent ?? 50}
      >
        <div className="mt-2 space-y-2">
          {url ? (
            <div className="rounded-lg border border-gray-200 bg-white p-2">
              <img src={url} alt="" className="max-h-[320px] w-auto max-w-full object-contain" />
            </div>
          ) : (
            <div className={cn('rounded-lg border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-600', fillBgClass)}>
              Upload an image to answer this question.
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={!canUpload || uploading}
              onChange={async (e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (!f) return;
                await doUpload(f);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canUpload || uploading}
              onClick={() => {
                if (!canUpload || uploading) return;
                fileInputRef.current?.click();
              }}
            >
              {uploading ? (
                <>
                  <Loader variant="dots" size="sm" inline className="mr-1.5" />
                  Uploading…
                </>
              ) : (
                url ? 'Replace image' : 'Upload image'
              )}
            </Button>
            {url && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || uploading}
                onClick={async () => {
                  if (!url) {
                    onChange({ url: null } as Record<string, unknown>);
                    return;
                  }
                  setLocalErr(null);
                  setUploading(true);
                  try {
                    const res = await deleteAnswerImageByPublicUrl(url);
                    if (!res.success) {
                      setLocalErr(res.error || 'Failed to delete image from storage');
                      return;
                    }
                    onChange({ url: null } as Record<string, unknown>);
                  } finally {
                    setUploading(false);
                  }
                }}
              >
                Delete image
              </Button>
            )}
            {!canUpload && (
              <span className="text-xs text-gray-500">
                Image upload is unavailable here (read-only or missing instance).
              </span>
            )}
            {!!highlight && !disabled && !url && <span className="text-xs text-[var(--brand)] font-medium">Required</span>}
          </div>
          {(localErr || error) && <p className="text-sm text-red-600">{localErr || error}</p>}
        </div>
      </QuestionLabelWithImage>
    </div>
  );
}

type TextWithAnswerImage = { text: string; answerImageUrl?: string };

function normalizeTextWithAnswerImage(raw: QuestionRendererProps['value']): TextWithAnswerImage {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if (typeof o.text === 'string' && Object.keys(o).every((k) => k === 'text' || k === 'answerImageUrl')) {
      return {
        text: String(o.text ?? ''),
        answerImageUrl: typeof o.answerImageUrl === 'string' && o.answerImageUrl.trim() ? o.answerImageUrl : undefined,
      };
    }
  }
  return { text: String(raw ?? '') };
}

async function pasteImageFromClipboard(): Promise<File | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (type.startsWith('image/')) {
          const blob = await item.getType(type);
          const ext = type === 'image/png' ? 'png' : type === 'image/gif' ? 'gif' : type === 'image/webp' ? 'webp' : 'jpg';
          return new File([blob], `pasted-image.${ext}`, { type });
        }
      }
    }
  } catch (e) {
    console.warn('Paste image failed:', e);
  }
  return null;
}

function OptionalAnswerImageAttachBar({
  instanceId,
  questionId,
  answerImageUrl,
  onImageUrl,
  disabled,
}: {
  instanceId?: number;
  questionId: number;
  answerImageUrl?: string;
  onImageUrl: (url: string | undefined) => void;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [localErr, setLocalErr] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const canUpload = !disabled && Number.isFinite(Number(instanceId)) && Number(instanceId) > 0;

  const applyFile = async (file: File | null) => {
    if (!file || !canUpload) return;
    const okType =
      file.type.startsWith('image/') || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);
    if (!okType) {
      setLocalErr('Please choose an image file.');
      return;
    }
    setLocalErr(null);
    setUploading(true);
    try {
      const res = await uploadAnswerImage(Number(instanceId), questionId, file);
      if (!res.url) {
        setLocalErr(res.error || 'Upload failed');
        return;
      }
      onImageUrl(res.url);
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!answerImageUrl) return;
    setLocalErr(null);
    setUploading(true);
    try {
      const res = await deleteAnswerImageByPublicUrl(answerImageUrl);
      if (!res.success) {
        setLocalErr(res.error || 'Could not remove file from storage');
        return;
      }
      onImageUrl(undefined);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-gray-200 bg-gray-50/90 p-3">
      <span className="text-xs font-medium text-gray-700">Image with answer (optional)</span>
      <p className="text-xs text-gray-500">Photos from phones (incl. iPhone HEIC) are accepted and converted for display and PDF.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          disabled={!canUpload || uploading}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            void applyFile(f);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canUpload || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <>
              <Loader variant="dots" size="sm" inline className="mr-1.5" />
              Uploading…
            </>
          ) : (
            <>
              <ImagePlus className="w-4 h-4 mr-1" /> Upload
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canUpload || uploading}
          onClick={async () => {
            const file = await pasteImageFromClipboard();
            if (!file) {
              setLocalErr('No image in clipboard. Copy or screenshot an image first.');
              return;
            }
            await applyFile(file);
          }}
        >
          <ClipboardPaste className="w-4 h-4 mr-1" /> Paste
        </Button>
        {answerImageUrl && (
          <Button type="button" variant="outline" size="sm" disabled={disabled || uploading} onClick={() => void remove()}>
            Remove image
          </Button>
        )}
      </div>
      {answerImageUrl && (
        <img src={answerImageUrl} alt="" className="max-h-44 max-w-full rounded border border-gray-200 object-contain" />
      )}
      {localErr && <p className="text-sm text-red-600">{localErr}</p>}
      {!canUpload && <p className="text-xs text-amber-800">Save the form instance before attaching images.</p>}
    </div>
  );
}

export const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  value,
  onChange,
  instanceId,
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

  if (question.type === 'image') {
    const imgUrl = pm.imageUrl as string | undefined;
    return (
      <ImageAnswerField
        instanceId={instanceId}
        questionId={question.id}
        label={taskLabel(question.label)}
        helpText={question.help_text}
        promptImageUrl={imgUrl}
        promptImageLayout={(pm.imageLayout as ImageLayoutOption) || 'side_by_side'}
        promptImageWidthPercent={(pm.imageWidthPercent as number) ?? 50}
        disabled={disabled}
        error={error}
        highlight={shouldHighlight && !!question.required}
        value={value}
        onChange={onChange}
        fillBgClass={fillBgClass}
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
    const allowAnswerImage = !!pm.allowAnswerImage;

    if (allowAnswerImage) {
      const norm = normalizeTextWithAnswerImage(value);
      const emit = (patch: Partial<TextWithAnswerImage>) =>
        onChange({
          text: patch.text ?? norm.text,
          answerImageUrl: patch.answerImageUrl !== undefined ? patch.answerImageUrl : norm.answerImageUrl,
        } as Record<string, unknown>);
      const wordHelp = wordLimit ? `${countWords(norm.text)} / ${wordLimit} words` : undefined;
      const textEl = (
        <Textarea
          label={imgUrl ? undefined : taskLabel(question.label)}
          value={norm.text}
          onChange={(e) => {
            const next = e.target.value;
            emit({ text: wordLimit ? truncateToWordLimit(next, wordLimit) : next });
          }}
          disabled={disabled}
          error={error}
          className={fillBgClass}
          required={false}
          helperText={imgUrl ? wordHelp : [question.help_text, wordHelp].filter(Boolean).join(' • ') || undefined}
          rows={wordLimit ? Math.max(2, Math.min(6, Math.ceil(wordLimit / 12))) : 3}
          maxWords={wordLimit ?? undefined}
        />
      );
      const attach = (
        <OptionalAnswerImageAttachBar
          instanceId={instanceId}
          questionId={question.id}
          answerImageUrl={norm.answerImageUrl}
          onImageUrl={(u) => emit({ answerImageUrl: u })}
          disabled={disabled}
        />
      );
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
                {textEl}
                {attach}
              </div>
            </QuestionLabelWithImage>
          </div>
        );
      }
      return (
        <div>
          {textEl}
          {attach}
        </div>
      );
    }

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
                onChange={(e) => {
                  const next = e.target.value;
                  onChange(wordLimit ? truncateToWordLimit(next, wordLimit) : next);
                }}
                disabled={disabled}
                error={error}
                className={fillBgClass}
                required={question.required && !disabled}
                helperText={wordLimit ? `${countWords(String(value || ''))} / ${wordLimit} words` : undefined}
                rows={wordLimit ? Math.max(2, Math.min(6, Math.ceil(wordLimit / 12))) : 3}
                maxWords={wordLimit ?? undefined}
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
        onChange={(e) => {
          const next = e.target.value;
          onChange(wordLimit ? truncateToWordLimit(next, wordLimit) : next);
        }}
        disabled={disabled}
        error={error}
        className={fillBgClass}
        required={question.required && !disabled}
        helperText={[question.help_text, wordLimit ? `${countWords(String(value || ''))} / ${wordLimit} words` : null].filter(Boolean).join(' • ') || undefined}
        rows={wordLimit ? Math.max(2, Math.min(6, Math.ceil(wordLimit / 12))) : 3}
        maxWords={wordLimit ?? undefined}
      />
    );
  }

  if (question.type === 'long_text') {
    const imgUrl = pm.imageUrl as string | undefined;
    const allowAnswerImage = !!pm.allowAnswerImage;

    if (allowAnswerImage) {
      const norm = normalizeTextWithAnswerImage(value);
      const emit = (patch: Partial<TextWithAnswerImage>) =>
        onChange({
          text: patch.text ?? norm.text,
          answerImageUrl: patch.answerImageUrl !== undefined ? patch.answerImageUrl : norm.answerImageUrl,
        } as Record<string, unknown>);
      const wordHelp = wordLimit ? `${countWords(norm.text)} / ${wordLimit} words` : undefined;
      const textEl = (
        <Textarea
          label={imgUrl ? undefined : taskLabel(question.label)}
          value={norm.text}
          onChange={(e) => emit({ text: e.target.value })}
          disabled={disabled}
          error={error}
          className={fillBgClass}
          required={false}
          helperText={imgUrl ? wordHelp : [question.help_text, wordHelp].filter(Boolean).join(' • ') || undefined}
          rows={wordLimit ? Math.max(2, Math.min(10, Math.ceil(wordLimit / 10))) : 8}
          maxWords={wordLimit ?? undefined}
          fixedHeightFromWordLimit={!!wordLimit}
        />
      );
      const attach = (
        <OptionalAnswerImageAttachBar
          instanceId={instanceId}
          questionId={question.id}
          answerImageUrl={norm.answerImageUrl}
          onImageUrl={(u) => emit({ answerImageUrl: u })}
          disabled={disabled}
        />
      );
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
                {textEl}
                {attach}
              </div>
            </QuestionLabelWithImage>
          </div>
        );
      }
      return (
        <div>
          {textEl}
          {attach}
        </div>
      );
    }

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
