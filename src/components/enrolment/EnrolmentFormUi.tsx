import React, { useId, useRef } from 'react';
import { Paperclip } from 'lucide-react';
import type { FieldError, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { digitsOnlyPhone } from '../../lib/enrolmentValidation';
import { DatePicker } from '../ui/DatePicker';
import { MonthYearPicker } from '../ui/MonthYearPicker';
import { YearPicker } from '../ui/YearPicker';
import type { EnrolmentFormValues } from '../../types/enrolment';

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <section className="enrol-section">
      <h2>{children}</h2>
      <hr className="section-rule" />
    </section>
  );
}

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="enrol-label">
      {children}
      {required ? <span className="req"> *</span> : null}
    </span>
  );
}

export function FieldErrorMsg({ error }: { error?: FieldError | string }) {
  if (!error) return null;
  const msg = typeof error === 'string' ? error : error.message;
  if (!msg) return null;
  return <p className="field-error">{msg}</p>;
}

type Register = UseFormRegister<EnrolmentFormValues>;
type SetValue = UseFormSetValue<EnrolmentFormValues>;
type FieldName = Parameters<Register>[0];

export function TextField({
  label,
  required,
  register,
  name,
  error,
  type = 'text',
  placeholder,
}: {
  label: string;
  required?: boolean;
  register: Register;
  name: Parameters<Register>[0];
  error?: FieldError;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="enrol-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <input type={type} placeholder={placeholder} {...register(name)} />
      <FieldErrorMsg error={error} />
    </div>
  );
}

/** Digits-only phone input (max 10). Validation rules applied in enrolmentValidation. */
export function PhoneField({
  label,
  required,
  register,
  setValue,
  name,
  error,
  placeholder,
}: {
  label: string;
  required?: boolean;
  register: Register;
  setValue: SetValue;
  name: FieldName;
  error?: FieldError;
  placeholder?: string;
}) {
  const { onChange: _regOnChange, ...reg } = register(name);
  return (
    <div className="enrol-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        maxLength={10}
        placeholder={placeholder}
        {...reg}
        onChange={(e) => {
          const digits = digitsOnlyPhone(e.target.value).slice(0, 10);
          setValue(name, digits, { shouldValidate: true, shouldDirty: true });
        }}
      />
      <FieldErrorMsg error={error} />
    </div>
  );
}

/** Postcode — 4 digits for Australian addresses. */
export function PostcodeField({
  label,
  required,
  register,
  setValue,
  name,
  error,
  australian,
}: {
  label: string;
  required?: boolean;
  register: Register;
  setValue: SetValue;
  name: FieldName;
  error?: FieldError;
  australian?: boolean;
}) {
  const { onChange: _regOnChange, ...reg } = register(name);
  const maxLen = australian ? 4 : 12;
  return (
    <div className="enrol-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        type="text"
        inputMode="numeric"
        maxLength={maxLen}
        {...reg}
        onChange={(e) => {
          const digits = digitsOnlyPhone(e.target.value).slice(0, maxLen);
          setValue(name, digits, { shouldValidate: true, shouldDirty: true });
        }}
      />
      <FieldErrorMsg error={error} />
    </div>
  );
}

export function SelectField({
  label,
  required,
  register,
  name,
  error,
  options,
}: {
  label: string;
  required?: boolean;
  register: Register;
  name: FieldName;
  error?: FieldError;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="enrol-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <select {...register(name)}>
        {options.map((o) => (
          <option key={o.value || '__empty'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldErrorMsg error={error} />
    </div>
  );
}

export function DateField({
  label,
  required,
  value,
  onChange,
  error,
  placement = 'below',
  minDate,
  maxDate,
  disableFuture,
  fromYear,
  toYear,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (iso: string) => void;
  error?: FieldError;
  placement?: 'above' | 'below';
  minDate?: string;
  maxDate?: string;
  disableFuture?: boolean;
  fromYear?: number;
  toYear?: number;
}) {
  return (
    <div className="enrol-field enrol-date-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <DatePicker
        value={value}
        onChange={(v) => onChange(v || '')}
        placement={placement}
        className="enrol-date-picker max-w-full"
        error={typeof error === 'object' ? error?.message : undefined}
        minDate={minDate}
        maxDate={maxDate}
        disableFuture={disableFuture}
        fromYear={fromYear}
        toYear={toYear}
      />
    </div>
  );
}

/** Single checkbox row — checkbox left, label text on the same line. */
export function MonthYearField({
  label,
  required,
  value,
  onChange,
  error,
  placement = 'below',
  fromYear,
  toYear,
  disablePast = true,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (mmYyyy: string) => void;
  error?: FieldError;
  placement?: 'above' | 'below';
  fromYear?: number;
  toYear?: number;
  disablePast?: boolean;
}) {
  const now = new Date();
  return (
    <div className="enrol-field enrol-date-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <MonthYearPicker
        value={value}
        onChange={onChange}
        placement={placement}
        className="enrol-date-picker max-w-full"
        placeholder="mm/yyyy"
        error={typeof error === 'object' ? error?.message : undefined}
        fromYear={fromYear ?? now.getFullYear()}
        toYear={toYear ?? now.getFullYear() + 5}
        disablePast={disablePast}
      />
    </div>
  );
}

export function YearField({
  label,
  required,
  value,
  onChange,
  error,
  placement = 'below',
  fromYear = 1980,
  toYear = new Date().getFullYear(),
  allowNotSpecified = true,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (year: string) => void;
  error?: FieldError;
  placement?: 'above' | 'below';
  fromYear?: number;
  toYear?: number;
  allowNotSpecified?: boolean;
}) {
  return (
    <div className="enrol-field enrol-date-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <YearPicker
        value={value}
        onChange={onChange}
        placement={placement}
        className="enrol-date-picker max-w-full"
        placeholder="Select year"
        error={typeof error === 'object' ? error?.message : undefined}
        fromYear={fromYear}
        toYear={toYear}
        allowNotSpecified={allowNotSpecified}
      />
    </div>
  );
}

export function AttachmentField({
  label,
  required,
  accept = '.jpg,.jpeg,.png,.gif,.pdf',
  hint,
  error,
  fileName,
  uploaded,
  onPick,
  onClear,
}: {
  label: string;
  required?: boolean;
  accept?: string;
  hint?: string;
  error?: FieldError | string;
  fileName?: string | null;
  uploaded?: boolean;
  onPick: (file: File | null) => void;
  onClear?: () => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const hasFile = Boolean(fileName?.trim());

  return (
    <div className="enrol-field enrol-attachment-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <div className="enrol-attachment-row">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="enrol-attachment-input"
          onChange={(e) => {
            onPick(e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={`enrol-btn-attachment${hasFile ? ' has-file' : ''}`}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip className="enrol-attachment-icon" strokeWidth={2} aria-hidden />
          {hasFile ? 'Replace attachment' : 'Choose attachment'}
        </button>
        {hasFile && onClear ? (
          <button type="button" className="enrol-btn-attachment-clear" onClick={onClear}>
            Remove
          </button>
        ) : null}
      </div>
      {hasFile ? (
        <p className="enrol-attachment-status">
          <span className="enrol-attachment-tag">Attachment</span>
          {' — '}
          {fileName}
          {uploaded ? ' (saved)' : ' (ready to upload)'}
        </p>
      ) : (
        <p className="enrol-attachment-hint">No file chosen — use the button above to attach a document.</p>
      )}
      {hint ? <p className="enrol-note">{hint}</p> : null}
      <FieldErrorMsg error={error} />
    </div>
  );
}

export function CheckOption({ children }: { children: React.ReactNode }) {
  let inputEl: React.ReactNode = null;
  const labelParts: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === 'input') inputEl = child;
    else if (child != null && child !== false && child !== '') labelParts.push(child);
  });
  return (
    <label className="enrol-check-option">
      {inputEl}
      <span>{labelParts}</span>
    </label>
  );
}

export function RadioGroup({
  label,
  required,
  name,
  options,
  value,
  onChange,
  error,
}: {
  label: string;
  required?: boolean;
  name: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  error?: FieldError;
}) {
  return (
    <div className="enrol-field">
      <FieldLabel required={required}>{label}</FieldLabel>
      <div className="enrol-radio-group">
        {options.map((o) => (
          <label key={o.value} className="enrol-radio-option">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      <FieldErrorMsg error={error} />
    </div>
  );
}

export function CheckboxGroup({
  label,
  options,
  values,
  onToggle,
}: {
  label?: string;
  options: { value: string; label: string }[];
  values: string[];
  onToggle: (value: string, checked: boolean) => void;
}) {
  return (
    <div className="enrol-field">
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <div className="enrol-check-group">
        {options.map((o) => (
          <label key={o.value} className="enrol-check-option">
            <input
              type="checkbox"
              checked={values.includes(o.value)}
              onChange={(e) => onToggle(o.value, e.target.checked)}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ScrollToTopButton() {
  return (
    <button
      type="button"
      className="enrol-scroll-top"
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      ↑
    </button>
  );
}
