import React from 'react';
import { SignatureField } from './SignatureField';
import { DatePicker } from '../ui/DatePicker';
import { todayIsoLocal } from '../../utils/assessmentAttemptDates';

export type SignatureAnswerValue = string | number | boolean | Record<string, unknown> | string[] | null;

export function parseSignatureAnswerValue(val: SignatureAnswerValue): {
  sigObj: Record<string, unknown> | null;
  imgVal: string | null;
  dateVal: string;
} {
  if (val == null) return { sigObj: null, imgVal: null, dateVal: '' };
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return { sigObj: null, imgVal: trimmed || null, dateVal: '' };
  }
  if (typeof val === 'object' && !Array.isArray(val)) {
    const sigObj = val as Record<string, unknown>;
    const imgVal =
      String(sigObj.signature ?? sigObj.imageDataUrl ?? sigObj.typedText ?? '').trim() || null;
    const dateVal = String(sigObj.date ?? sigObj.signedAtDate ?? sigObj.signedAt ?? '').trim();
    return { sigObj, imgVal, dateVal };
  }
  return { sigObj: null, imgVal: null, dateVal: '' };
}

export function mergeSignatureAnswer(
  existing: SignatureAnswerValue,
  patch: { signature?: string | null; date?: string | null },
): Record<string, unknown> {
  const { sigObj, imgVal } = parseSignatureAnswerValue(existing);
  const base: Record<string, unknown> = sigObj
    ? { ...sigObj }
    : imgVal
      ? { signature: imgVal }
      : {};

  if (patch.signature !== undefined) {
    if (patch.signature) {
      base.signature = patch.signature;
    } else {
      base.signature = null;
    }
  }

  if (patch.date !== undefined) {
    const d = String(patch.date ?? '').trim();
    if (d) base.date = d;
    else delete base.date;
  }

  return base;
}

type Props = {
  label?: string;
  required?: boolean;
  value: SignatureAnswerValue;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
  showMetadata?: boolean;
  minDate?: string;
  suggestionFrom?: string | null;
  onSuggestionClick?: () => void;
};

export const DeclarationSignatureWithDate: React.FC<Props> = ({
  label,
  required,
  value,
  onChange,
  disabled = false,
  showMetadata = true,
  minDate,
  suggestionFrom,
  onSuggestionClick,
}) => {
  const { sigObj, imgVal, dateVal } = parseSignatureAnswerValue(value);
  const signedBy = sigObj ? String(sigObj.signedBy ?? sigObj.typedText ?? '').trim() : '';
  const hasSignature = Boolean(imgVal);

  const handleSignatureChange = (sig: string | null) => {
    const patch: { signature: string | null; date?: string } = { signature: sig };
    if (sig && !dateVal.trim()) {
      patch.date = todayIsoLocal();
    }
    onChange(mergeSignatureAnswer(value, patch));
  };

  const handleDateChange = (newDate: string) => {
    onChange(mergeSignatureAnswer(value, { date: newDate || null }));
  };

  const handleSuggestion = () => {
    if (onSuggestionClick) {
      onSuggestionClick();
      return;
    }
    if (!suggestionFrom) return;
    const patch: { signature: string; date?: string } = { signature: suggestionFrom };
    if (!dateVal.trim()) patch.date = todayIsoLocal();
    onChange(mergeSignatureAnswer(value, patch));
  };

  return (
    <div className="space-y-2">
      {label ? (
        <div className="text-sm font-semibold text-gray-700">
          {label}
          {required ? ' *' : ''}
        </div>
      ) : null}
      {showMetadata && hasSignature ? (
        <div className="text-xs text-gray-500 space-y-0.5">
          <p className="text-emerald-700 font-medium">Signed</p>
          {signedBy ? <p>Signed by: {signedBy}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <div className="min-w-[200px] flex-1">
          <SignatureField
            value={imgVal}
            onChange={handleSignatureChange}
            disabled={disabled}
            suggestionFrom={suggestionFrom}
            onSuggestionClick={suggestionFrom ? handleSuggestion : onSuggestionClick ? handleSuggestion : undefined}
          />
        </div>
        <div className="flex min-w-[140px] items-center gap-2">
          <span className="shrink-0 text-sm font-semibold text-gray-700">Date:</span>
          <DatePicker
            value={dateVal}
            onChange={handleDateChange}
            disabled={disabled}
            compact
            placement="above"
            className="min-w-0 flex-1"
            minDate={minDate}
          />
        </div>
      </div>
    </div>
  );
};
