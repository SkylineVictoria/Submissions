import React, { useState } from 'react';
import { SlitDocumentHeader } from '../SlitDocumentHeader';
import { Checkbox } from '../ui/Checkbox';
import { DatePicker } from '../ui/DatePicker';
import { DateTime } from 'luxon';
import type {
  ChecklistRowState,
  ChecklistTopicKey,
  InductionDocumentKey,
  InductionFormPayload,
  InductionFormSyncOptions,
} from '../../lib/inductionForm';
import {
  CHECKLIST_TOPIC_KEYS,
  INDUCTION_DOCUMENT_KEYS,
  INDUCTION_DOCUMENT_LABELS,
  getInductionDocumentAttachments,
  inductionDocumentAllowsMultiple,
  inductionDocumentHasAttachment,
  syncInductionDocumentRowFiles,
} from '../../lib/inductionForm';
import { digitsOnlyPhone } from '../../lib/enrolmentValidation';
import { uploadInductionDocument } from '../../lib/storage';
import { toast } from '../../utils/toast';
const ZONE = 'Australia/Melbourne';

export type InductionFormChangeArg =
  | InductionFormPayload
  | ((prev: InductionFormPayload) => InductionFormPayload);

export interface InductionInteractiveBindings {
  value: InductionFormPayload;
  onChange: (next: InductionFormChangeArg, sync?: InductionFormSyncOptions) => void;
  readOnly?: boolean;
  /** When false (default), OFFICE USE ONLY is read-only (student induction). Set true for admin/trainer tools. */
  allowOfficeUseEdit?: boolean;
  /** Folder for uploads — admin uses numeric submission id; public induction uses session token. */
  inductionSubmissionFolder?: number | string;
}

function melbourneMonthYear(iso: string | null | undefined): string {
  if (!iso) return DateTime.now().setZone(ZONE).toFormat('MMMM yyyy').toUpperCase();
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(ZONE);
  return dt.isValid ? dt.toFormat('MMMM yyyy').toUpperCase() : DateTime.now().setZone(ZONE).toFormat('MMMM yyyy').toUpperCase();
}

/** A4-style sheet: repeated header, optional watermark, print page break after. */
function DocPage({
  children,
  pageNum,
  totalPages,
  showWatermark,
  allowBreakInside,
}: {
  children: React.ReactNode;
  pageNum: number;
  totalPages: number;
  showWatermark?: boolean;
  /** Long forms may span multiple sheets when printing. */
  allowBreakInside?: boolean;
}) {
  return (
    <section
      className={`relative mx-auto mb-6 w-full max-w-full min-h-0 border border-gray-300 bg-white px-3 pt-3 pb-4 shadow-sm print:mb-8 print:max-w-[210mm] print:break-after-page print:px-10 print:pb-6 print:pt-4 print:shadow-none sm:mb-8 sm:px-5 sm:pb-5 md:px-10 md:pt-4 md:pb-6 ${allowBreakInside ? 'induction-doc-page-breakable' : ''}`}
      aria-label={`Page ${pageNum} of ${totalPages}`}
    >
      {showWatermark ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden"
          aria-hidden
        >
          <div className="select-none text-center text-[10rem] font-bold uppercase leading-none text-[rgba(229,231,235,0.45)] md:text-[14rem]">
            SKYLINE
          </div>
        </div>
      ) : null}
      <div className="relative z-[1]">{children}</div>
      <footer className="relative z-[1] mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#d1d5db] pt-2 text-[8pt] uppercase tracking-[0.05em] text-[#6b7280] print:mt-3">
        <span>Induction instructions</span>
        <span className="hidden sm:inline" />
        <span>
          Page {pageNum} of {totalPages}
        </span>
      </footer>
    </section>
  );
}

const linkMail = (email: string) => (
  <a href={`mailto:${email}`} className="text-[#2563eb] underline">
    {email}
  </a>
);

const FORM_RED = '#e60000';
const FORM_INPUT_BG = '#F0F4F8';

/** Same styling as assessment typed signatures (SignatureField / SignaturePad). */
const SIG_INPUT_BASE =
  'min-w-0 bg-transparent px-1 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-red-300 disabled:cursor-default disabled:opacity-80 text-red-600 italic font-serif font-medium border-b border-gray-700';

function InductionInlineDatePicker({
  value,
  onChange,
  disabled,
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DatePicker
      value={value}
      onChange={(v) => onChange(v || '')}
      disabled={disabled}
      compact
      placement="above"
      className={className ?? 'max-w-[148px]'}
    />
  );
}

const enrolInp =
  'w-full min-w-0 bg-transparent px-1 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:cursor-default disabled:opacity-80';

const ENROLMENT_PHONE_FIELDS = new Set<keyof InductionFormPayload['enrolment']>(['phone', 'emergencyPhone']);
const ENROLMENT_EMAIL_FIELDS = new Set<keyof InductionFormPayload['enrolment']>(['email']);

function sanitizeInductionPhoneInput(raw: string): string {
  return digitsOnlyPhone(raw).slice(0, 10);
}

/** Stacked label + full-width input on phones; inline on larger screens. */
function ChecklistHeaderField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="induction-header-field flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-1">
      <span className="shrink-0 text-[10pt] font-semibold sm:text-[10pt]">{label}</span>
      <div className="min-w-0 w-full sm:w-auto">{children}</div>
    </div>
  );
}

const checklistHeaderInputClass =
  'block w-full min-w-0 rounded-sm border border-gray-300 bg-white px-2 py-2.5 text-[11pt] outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-80 sm:inline-block sm:w-auto sm:min-w-[12rem] sm:border-0 sm:border-b sm:border-dotted sm:rounded-none sm:bg-transparent sm:px-1 sm:py-0.5';

function EnrolmentFormTable({ interactive }: { interactive?: InductionInteractiveBindings }) {
  const empty = <span className="block min-h-[1.25rem]">&nbsp;</span>;
  const e = interactive?.value.enrolment;
  const ro = interactive?.readOnly;
  const officeLocked = ro || !interactive?.allowOfficeUseEdit;
  const patch = (p: Partial<InductionFormPayload['enrolment']>, sync?: InductionFormSyncOptions) => {
    if (!interactive) return;
    interactive.onChange(
      (prev) => ({ ...prev, enrolment: { ...prev.enrolment, ...p } }),
      sync
    );
  };

  const textCell = (field: keyof InductionFormPayload['enrolment']) =>
    interactive && e ? (
      <input
        type={ENROLMENT_EMAIL_FIELDS.has(field) ? 'email' : ENROLMENT_PHONE_FIELDS.has(field) ? 'tel' : 'text'}
        inputMode={
          ENROLMENT_EMAIL_FIELDS.has(field) ? 'email' : ENROLMENT_PHONE_FIELDS.has(field) ? 'numeric' : undefined
        }
        maxLength={ENROLMENT_PHONE_FIELDS.has(field) ? 10 : undefined}
        className={enrolInp}
        value={e[field] as string}
        onChange={(ev) => {
          const sync: InductionFormSyncOptions | undefined =
            field === 'familyName' || field === 'givenNames'
              ? { activeNameField: 'enrolment_names' }
              : field === 'declarationSignature'
                ? { activeSignatureField: 'enrolment_declaration' }
                : undefined;
          const raw = ev.target.value;
          const value = ENROLMENT_PHONE_FIELDS.has(field) ? sanitizeInductionPhoneInput(raw) : raw;
          patch({ [field]: value } as Partial<InductionFormPayload['enrolment']>, sync);
        }}
        disabled={ro}
        autoComplete={
          ENROLMENT_EMAIL_FIELDS.has(field) ? 'email' : ENROLMENT_PHONE_FIELDS.has(field) ? 'tel' : 'off'
        }
      />
    ) : (
      empty
    );

  return (
    <table className="induction-enrol-table mt-2 w-full border-collapse border border-black text-[10pt] [font-family:Calibri,'Calibri_Light',Arial,Helvetica,sans-serif]">
      <tbody>
        <tr>
          <td colSpan={2} className="border border-black px-2 py-1.5 font-bold text-white" style={{ backgroundColor: FORM_RED }}>
            Personal Details
          </td>
        </tr>
        <tr>
          <td className="w-[34%] border border-black px-2 py-1 align-top font-semibold">Family Name</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('familyName')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Given Name/s</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('givenNames')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Date of Birth</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {interactive && e ? (
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <InductionInlineDatePicker
                  value={e.dateOfBirth}
                  onChange={(iso) => patch({ dateOfBirth: iso })}
                  disabled={ro}
                  className="w-full max-w-full sm:max-w-[160px]"
                />
                <span className="flex flex-wrap items-center gap-x-3 text-[9pt]">
                  Gender:
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="enrol-gender"
                      checked={e.gender === 'male'}
                      onChange={() => patch({ gender: 'male' })}
                      disabled={ro}
                    />
                    Male
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="enrol-gender"
                      checked={e.gender === 'female'}
                      onChange={() => patch({ gender: 'female' })}
                      disabled={ro}
                    />
                    Female
                  </label>
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-x-6 gap-y-1">
                <span className="inline-block min-w-[140px] border-b border-dotted border-gray-600">&nbsp;</span>
                <span>
                  Gender (please tick): <span className="whitespace-nowrap">☐ Male</span> <span className="whitespace-nowrap">☐ Female</span>
                </span>
              </div>
            )}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Student ID</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('studentId')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Passport Number</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('passportNumber')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Visa Number (optional)</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('visaNumber')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Visa Expiry Date (optional)</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {interactive && e ? (
              <InductionInlineDatePicker
                value={e.visaExpiry}
                onChange={(iso) => patch({ visaExpiry: iso })}
                disabled={ro}
              />
            ) : (
              textCell('visaExpiry')
            )}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Residential Address</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('residentialAddress')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Phone</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('phone')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Email</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('email')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">USI Number</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('usiNumber')}
          </td>
        </tr>

        <tr>
          <td colSpan={2} className="border border-black px-2 py-1.5 font-bold text-white" style={{ backgroundColor: FORM_RED }}>
            Emergency Contact Details
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Name</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('emergencyName')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Address</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('emergencyAddress')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Telephone Number</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('emergencyPhone')}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Relationship to you</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {textCell('emergencyRelationship')}
          </td>
        </tr>

        <tr>
          <td colSpan={2} className="border border-black px-2 py-2 font-semibold" style={{ color: FORM_RED }}>
            I declare the information provided by myself, on this form is true and correct.
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Signature</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {interactive && e ? (
              <span className="inline-flex flex-wrap items-end gap-x-4 gap-y-1">
                <input
                  type="text"
                  className={`${SIG_INPUT_BASE} min-w-[55%]`}
                  value={e.declarationSignature}
                  onChange={(ev) =>
                    patch({ declarationSignature: ev.target.value }, { activeSignatureField: 'enrolment_declaration' })
                  }
                  disabled={ro}
                  autoComplete="off"
                />
                <span className="font-semibold">Date:</span>
                <InductionInlineDatePicker
                  value={e.declarationDate}
                  onChange={(iso) => patch({ declarationDate: iso }, { activeDateField: 'enrolment_declaration' })}
                  disabled={ro}
                />
              </span>
            ) : (
              <>
                <span className="inline-block min-w-[55%] border-b border-black">&nbsp;</span>
                <span className="ml-6 font-semibold">Date:</span>{' '}
                <span className="inline-block min-w-[100px] border-b border-black">&nbsp;</span>
              </>
            )}
          </td>
        </tr>

        <tr>
          <td colSpan={2} className="border border-black px-2 py-1.5 font-bold text-white" style={{ backgroundColor: FORM_RED }}>
            OFFICE USE ONLY
            {interactive && officeLocked ? (
              <span className="ml-2 text-[9pt] font-normal font-sans normal-case text-white/90">(staff only — not editable here)</span>
            ) : null}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Updated in SMS by</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {interactive && e ? (
              <span className="inline-flex flex-wrap items-end gap-x-3 gap-y-1">
                <input
                  type="text"
                  className={`${enrolInp} min-w-[40%]`}
                  value={e.officeSmsBy}
                  onChange={(ev) => patch({ officeSmsBy: ev.target.value })}
                  disabled={officeLocked}
                />
                <span className="font-semibold">Date:</span>
                <InductionInlineDatePicker
                  value={e.officeSmsDate}
                  onChange={(iso) => patch({ officeSmsDate: iso })}
                  disabled={officeLocked}
                  className="max-w-[132px]"
                />
              </span>
            ) : (
              <>
                <span className="inline-block min-w-[45%] border-b border-dotted border-gray-600">&nbsp;</span>
                <span className="ml-4 font-semibold">Date:</span>{' '}
                <span className="inline-block min-w-[100px] border-b border-dotted border-gray-600">&nbsp;</span>
              </>
            )}
          </td>
        </tr>
        <tr>
          <td className="border border-black px-2 py-1 font-semibold">Updated in PRISMS by</td>
          <td className="border border-black px-2 py-1" style={{ backgroundColor: FORM_INPUT_BG }}>
            {interactive && e ? (
              <span className="inline-flex flex-wrap items-end gap-x-3 gap-y-1">
                <input
                  type="text"
                  className={`${enrolInp} min-w-[40%]`}
                  value={e.officePrismsBy}
                  onChange={(ev) => patch({ officePrismsBy: ev.target.value })}
                  disabled={officeLocked}
                />
                <span className="font-semibold">Date:</span>
                <InductionInlineDatePicker
                  value={e.officePrismsDate}
                  onChange={(iso) => patch({ officePrismsDate: iso })}
                  disabled={officeLocked}
                  className="max-w-[132px]"
                />
              </span>
            ) : (
              <>
                <span className="inline-block min-w-[45%] border-b border-dotted border-gray-600">&nbsp;</span>
                <span className="ml-4 font-semibold">Date:</span>{' '}
                <span className="inline-block min-w-[100px] border-b border-dotted border-gray-600">&nbsp;</span>
              </>
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Fixed-width signature lines — keeps F12 media page to one sheet in print/PDF. */
const SIG_W = 'w-[220px]';
const SIG_W_WIDE = 'w-[240px]';

const mediaInp = 'border-b border-black bg-transparent px-0.5 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-80';

function MediaConsentContent({ interactive }: { interactive?: InductionInteractiveBindings }) {
  const a = interactive?.value.mediaAck;
  const m = interactive?.value.mediaConsent;
  const ro = interactive?.readOnly;
  const patchAck = (p: Partial<InductionFormPayload['mediaAck']>, sync?: InductionFormSyncOptions) => {
    if (!interactive) return;
    interactive.onChange((prev) => ({ ...prev, mediaAck: { ...prev.mediaAck, ...p } }), sync);
  };
  const patchConsent = (p: Partial<InductionFormPayload['mediaConsent']>) => {
    if (!interactive) return;
    interactive.onChange({ ...interactive.value, mediaConsent: { ...interactive.value.mediaConsent, ...p } });
  };

  return (
    <div className="induction-media-consent mt-2 text-[10pt] leading-snug">
      <div>
        <p className="mb-2 text-center text-[11pt] font-bold underline">ACKNOWLEDGEMENT (required)</p>
        <p className="mb-1">I acknowledge and understand that:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            SKYLINE INSTITUTE OF TECHNOLOGY may operate <strong>CCTV / video surveillance systems</strong> on campus premises
            for safety, security, incident prevention, and investigation purposes.
          </li>
          <li>
            Video footage may be recorded, monitored, stored, and reviewed in the event of an incident, complaint,
            misconduct allegation, safety concern, or official investigation.
          </li>
          <li>
            Footage may be shared with authorized personnel, regulatory bodies, or law enforcement if required by law or
            for investigative purposes.
          </li>
          <li>Surveillance is conducted to maintain a secure learning environment and to protect students, staff, and institutional property.</li>
        </ul>
        <p className="mt-2 leading-snug">
          I understand that video surveillance is a condition of being present on campus premises. By signing below, I
          acknowledge that I have been informed of and understand the Institute&apos;s use of CCTV surveillance for safety and
          security purposes.
        </p>
        <p className="mt-2.5">
          <span className="font-semibold">Student Name:</span>{' '}
          {interactive && a ? (
            <input
              type="text"
              className={`inline-block min-w-[200px] ${mediaInp} ${SIG_W_WIDE}`}
              value={a.studentName}
              onChange={(ev) => patchAck({ studentName: ev.target.value }, { activeNameField: 'media_student_name' })}
              disabled={ro}
            />
          ) : (
            <span className={`inline-block border-b border-black ${SIG_W_WIDE}`}>&nbsp;</span>
          )}
        </p>
        <p className="mt-2">
          <span className="font-semibold">Student Signature:</span>{' '}
          {interactive && a ? (
            <input
              type="text"
              className={`inline-block min-w-[200px] ${SIG_INPUT_BASE} ${SIG_W_WIDE}`}
              value={a.studentSignature}
              onChange={(ev) =>
                patchAck({ studentSignature: ev.target.value }, { activeSignatureField: 'media_ack' })
              }
              disabled={ro}
            />
          ) : (
            <span className={`inline-block border-b border-black ${SIG_W_WIDE}`}>&nbsp;</span>
          )}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">Date:</span>
          {interactive && a ? (
            <InductionInlineDatePicker
              value={a.date}
              onChange={(iso) => patchAck({ date: iso }, { activeDateField: 'media_ack' })}
              disabled={ro}
            />
          ) : (
            <span className={`inline-block border-b border-black ${SIG_W}`}>&nbsp;</span>
          )}
        </p>
      </div>

      <div className="mt-5">
        <p className="mb-2 text-center text-[11pt] font-bold underline">CONSENT FORM (optional)</p>
        <p className="mb-2 leading-snug">
          This section is voluntary — you do not need to complete it to submit your induction. You may choose to consent or
          decline. Your decision will not affect your enrolment, academic standing, or access to services.
        </p>
        <p className="mt-2">
          I{' '}
          {interactive && m ? (
            <input
              type="text"
              className={`inline-block align-bottom min-w-[180px] ${mediaInp} ${SIG_W_WIDE}`}
              value={m.consentorNameOnLine}
              onChange={(ev) => patchConsent({ consentorNameOnLine: ev.target.value })}
              disabled={ro}
            />
          ) : (
            <span className={`inline-block border-b border-black align-bottom ${SIG_W_WIDE}`}>&nbsp;</span>
          )}
        </p>
        <p className="mt-0.5 text-left text-[8pt] font-semibold">Name of person giving consent</p>
        <p className="mt-2 leading-snug">
          Consent to the use of photographs or video footage for use on the SKYLINE INSTITUTE OF TECHNOLOGY website, social
          media, in newsletters and publications as well as promotional material for the Institute.
        </p>
        <p className="mt-2 leading-snug">
          Consent to the use of photographs or video footage being used to promote future events by SKYLINE INSTITUTE OF
          TECHNOLOGY.
        </p>
        <p className="mt-2 leading-snug">
          I further understand that this consent may be withdrawn by me at any time, upon written notice. I give this
          consent voluntarily.
        </p>
        <div className="mt-4 text-left">
          {interactive && m ? (
            <>
              <input
                type="text"
                className={`block w-full max-w-[240px] ${mediaInp}`}
                value={m.name}
                onChange={(ev) => patchConsent({ name: ev.target.value })}
                disabled={ro}
              />
              <p className="mt-0.5 text-left text-[8pt] font-semibold">Name of person giving consent</p>
            </>
          ) : (
            <>
              <span className={`block w-[240px] border-b border-black`}>&nbsp;</span>
              <p className="mt-0.5 text-left text-[8pt] font-semibold">Name of person giving consent</p>
            </>
          )}
        </div>
        <div className="mt-2 text-left">
          {interactive && m ? (
            <>
              <input
                type="text"
                className={`block w-full max-w-[240px] ${SIG_INPUT_BASE}`}
                value={m.signature}
                onChange={(ev) => patchConsent({ signature: ev.target.value })}
                disabled={ro}
              />
              <p className="mt-0.5 text-left text-[8pt] font-semibold">Signature of person giving consent</p>
            </>
          ) : (
            <>
              <span className={`block w-[240px] border-b border-black`}>&nbsp;</span>
              <p className="mt-0.5 text-left text-[8pt] font-semibold">Signature of person giving consent</p>
            </>
          )}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">Date:</span>
          {interactive && m ? (
            <InductionInlineDatePicker value={m.date} onChange={(iso) => patchConsent({ date: iso })} disabled={ro} />
          ) : (
            <span className={`inline-block border-b border-black ${SIG_W}`}>&nbsp;</span>
          )}
        </p>
      </div>
    </div>
  );
}

function inductionChecklistTopicCell(key: ChecklistTopicKey): React.ReactNode {
  switch (key) {
    case 'course_module':
      return (
        <>
          <span className="font-semibold">1) Course/module information</span>
          <ul className="mt-0.5 list-none pl-0 text-[7.5pt] leading-tight">
            <li>→ Introduction of key teaching and support staff</li>
            <li>→ Module outline and student certificates upon completion</li>
            <li>→ Students provided with timetables/training plan</li>
          </ul>
        </>
      );
    case 'refund':
      return <span className="underline">2) Refund policy</span>;
    case 'deferment':
      return <span className="underline">3) Deferment policy</span>;
    case 'credit_transfer':
      return <span className="underline">4) Credit transfer policy</span>;
    case 'transfer':
      return <span className="underline">5) Transfer policy</span>;
    case 'fees':
      return <span className="underline">6) Fees policy</span>;
    case 'access_records':
      return <span className="underline">7) Access to records</span>;
    case 'complaints':
      return <span className="underline">8) Complaints policy</span>;
    case 'attendance':
      return <span className="underline">9) Attendance policy</span>;
    case 'reassessment':
      return <span className="underline">10) Reassessment policy</span>;
    case 'ethics':
      return <span className="underline">11) Ethics (SLIT)</span>;
    case 'ohs':
      return <span className="font-semibold">15) Occupational health and safety procedures</span>;
    case 'location':
      return (
        <>
          <span className="font-semibold">19) Location of</span>
          <ul className="mt-0.5 list-none pl-0 text-[7.5pt] leading-tight">
            <li>→ Classrooms</li>
            <li>→ Kitchen and recreation areas</li>
            <li>→ Toilets</li>
            <li>→ Public transport</li>
          </ul>
        </>
      );
    case 'student_support':
      return <span className="underline">20) Student support services</span>;
    case 'visa':
      return <span className="underline">21) Student visa conditions</span>;
    case 'melbourne':
      return <span className="underline">22) Adjusting to life in Melbourne</span>;
    case 'handbook':
      return <span className="underline">23) Student handbook</span>;
    default:
      return key;
  }
}

function checklistRowHighlight(key: ChecklistTopicKey): boolean {
  return key === 'course_module' || key === 'location';
}

export const InductionDocumentPages: React.FC<{
  title: string;
  startAt: string;
  endAt: string;
  interactive?: InductionInteractiveBindings;
}> = ({ startAt, interactive }) => {
  const period = melbourneMonthYear(startAt);
  const totalPages = 4;
  const [uploadingDoc, setUploadingDoc] = useState<InductionDocumentKey | null>(null);
  /** Immediate UI after file pick (before / during storage upload). */
  const [pendingDocFiles, setPendingDocFiles] = useState<
    Partial<Record<InductionDocumentKey, { fileName: string }[]>>
  >({});

  const patchLogin = (p: Partial<InductionFormPayload['loginSetup']>) => {
    if (!interactive) return;
    interactive.onChange({
      ...interactive.value,
      loginSetup: { ...interactive.value.loginSetup, ...p },
    });
  };

  const applyFormChange = (build: (prev: InductionFormPayload) => InductionFormPayload) => {
    if (!interactive) return;
    interactive.onChange(build);
  };

  const patchDoc = (key: InductionDocumentKey, p: Partial<InductionFormPayload['documents'][InductionDocumentKey]>) => {
    applyFormChange((prev) => ({
      ...prev,
      documents: {
        ...prev.documents,
        [key]: { ...prev.documents[key], ...p },
      },
    }));
  };

  return (
    <div className="induction-doc-print text-[12pt] leading-snug text-black [font-family:Calibri,'Calibri_Light',Arial,Helvetica,sans-serif]">
      <style>{`
        @media print {
          .induction-doc-print { background: white !important; }
          .induction-doc-print section:not(.induction-doc-page-breakable) { page-break-inside: avoid; }
          .induction-media-consent { break-inside: avoid; page-break-inside: avoid; }
        }
        .induction-doc-print ul.induction-ul { list-style: disc; padding-left: 1.25rem; margin: 0.2rem 0 0.45rem; }
        .induction-doc-print ul.induction-ul-nested { list-style: circle; padding-left: 1.25rem; margin: 0.15rem 0; }
        .induction-doc-print .induction-step-title {
          font-weight: 700; text-decoration: underline; text-transform: uppercase;
          margin-top: 0.55rem; margin-bottom: 0.2rem; font-size: 12pt;
        }
        .induction-doc-print .induction-checklist-table { font-size: 8pt; }
        .induction-doc-print .induction-checklist-table th,
        .induction-doc-print .induction-checklist-table td { padding: 3px 5px; }
        .induction-checklist-yn-cell label { display: inline-flex; align-items: center; gap: 0.35rem; }
        /* Screen-only: mobile-friendly induction form */
        @media screen and (max-width: 640px) {
          .induction-doc-print { font-size: 11pt; }
          .induction-checklist-table { font-size: 9pt; }
          .induction-checklist-table thead { display: none; }
          .induction-checklist-table tbody tr {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 0.35rem 0.5rem;
            margin-bottom: 0.65rem;
            padding: 0.5rem;
            border: 1px solid #000;
            background: #fff;
          }
          .induction-checklist-table tbody tr td:first-child {
            grid-column: 1 / -1;
            border: none !important;
            padding: 0 0 0.35rem 0 !important;
            margin-bottom: 0.25rem;
            border-bottom: 1px solid #e5e7eb !important;
          }
          .induction-checklist-table tbody tr td:not(:first-child) {
            border: none !important;
            padding: 0.25rem !important;
            text-align: center;
            vertical-align: middle;
          }
          .induction-checklist-yn-cell::before {
            display: block;
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
            margin-bottom: 0.2rem;
          }
          .induction-checklist-yn-cell--yes::before { content: 'Yes'; }
          .induction-checklist-yn-cell--no::before { content: 'No'; }
          .induction-checklist-initial-cell::before {
            display: block;
            font-size: 8pt;
            font-weight: 700;
            text-transform: uppercase;
            margin-bottom: 0.2rem;
            content: 'Initial';
          }
          .induction-checklist-table input[type="radio"] {
            height: 1.125rem;
            width: 1.125rem;
            min-height: 2.75rem;
            min-width: 2.75rem;
          }
          .induction-checklist-table input[type="text"] {
            min-height: 2.5rem;
            font-size: 10pt !important;
            border: 1px solid #d1d5db !important;
            border-radius: 0.25rem;
            padding: 0.35rem !important;
          }
          .induction-declaration-sign-date {
            flex-direction: column;
            align-items: stretch !important;
          }
          .induction-declaration-sign-date > span {
            display: flex;
            flex-direction: column;
            gap: 0.35rem;
            width: 100%;
          }
          .induction-declaration-sign-date input {
            width: 100% !important;
            max-width: 100% !important;
            min-width: 0 !important;
          }
        }
        /* Screen-only: stack enrolment-style tables on narrow viewports */
        @media screen and (max-width: 640px) {
          .induction-enrol-table { display: block; width: 100%; }
          .induction-enrol-table tbody { display: block; width: 100%; }
          .induction-enrol-table tr { display: block; width: 100%; border-bottom: 1px solid #000; }
          .induction-enrol-table td {
            display: block;
            width: 100% !important;
            border: none !important;
            border-left: 1px solid #000 !important;
            border-right: 1px solid #000 !important;
            box-sizing: border-box;
          }
          .induction-enrol-table tr:first-child td { border-top: 1px solid #000 !important; }
          .induction-enrol-table td[colspan="2"] { border: 1px solid #000 !important; }
          .induction-enrol-table td:first-child:not([colspan]) {
            font-weight: 600;
            background: #f8fafc;
            padding-top: 0.5rem;
          }
          .induction-enrol-table td + td { border-top: 1px dashed #e5e7eb !important; }
        }
      `}</style>

      {/* Page 1 — full induction instructions (single sheet) */}
      <DocPage pageNum={1} totalPages={totalPages} showWatermark>
        <SlitDocumentHeader />
        <h2 className="mt-2 text-center text-[16pt] font-bold uppercase underline">Induction instruction</h2>
        <div className="mt-3 text-[12pt]">
          <p className="induction-step-title">Step 1: Login setup</p>
          <ul className="induction-ul">
            <li>Install the following apps.</li>
          </ul>
          <ul className="induction-ul-nested ml-4 space-y-2">
            <li className="list-none pl-0">
              <strong>Microsoft Outlook</strong>
              {interactive ? (
                <span className="mt-1 block sm:mt-0 sm:ml-2 sm:inline sm:align-middle">
                  <span className="mr-2 text-[10pt] font-semibold">Logged in?</span>
                  <label className="mr-3 inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="induction-login-outlook"
                      checked={interactive.value.loginSetup.outlookLoggedIn === 'yes'}
                      onChange={() => patchLogin({ outlookLoggedIn: 'yes' })}
                      disabled={interactive.readOnly}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="induction-login-outlook"
                      checked={interactive.value.loginSetup.outlookLoggedIn === 'no'}
                      onChange={() => patchLogin({ outlookLoggedIn: 'no' })}
                      disabled={interactive.readOnly}
                    />
                    No
                  </label>
                </span>
              ) : null}
            </li>
            <li className="list-none pl-0">
              <strong>Microsoft Teams</strong>
              {interactive ? (
                <span className="mt-1 block sm:mt-0 sm:ml-2 sm:inline sm:align-middle">
                  <span className="mr-2 text-[10pt] font-semibold">Logged in?</span>
                  <label className="mr-3 inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="induction-login-teams"
                      checked={interactive.value.loginSetup.teamsLoggedIn === 'yes'}
                      onChange={() => patchLogin({ teamsLoggedIn: 'yes' })}
                      disabled={interactive.readOnly}
                    />
                    Yes
                  </label>
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="induction-login-teams"
                      checked={interactive.value.loginSetup.teamsLoggedIn === 'no'}
                      onChange={() => patchLogin({ teamsLoggedIn: 'no' })}
                      disabled={interactive.readOnly}
                    />
                    No
                  </label>
                </span>
              ) : null}
            </li>
          </ul>
          <ul className="induction-ul mt-1">
            <li>
              Log in using the student login details sent to your personal email with the subject &quot;Student Login&quot;.
            </li>
          </ul>

          <p className="induction-step-title">Step 2: Forms</p>
          <ul className="induction-ul">
            <li>
              <strong>Fill out and sign</strong> the following forms:
              <ul className="induction-ul-nested">
                <li>
                  <strong>Student Induction Checklist</strong>
                </li>
                <li>
                  <strong>Student Enrolment Form</strong>
                </li>
                <li>
                  <strong>Media Consent Form</strong>
                </li>
              </ul>
            </li>
          </ul>

          <p className="induction-step-title">Step 3: LLN quiz</p>
          <ul className="induction-ul">
            <li>
              Complete the <strong>LLN quiz</strong>
            </li>
          </ul>
          <p className="mt-1 pl-1 text-[11pt]">
            <strong>Note:</strong> Link to the quiz is shared via email. If unable to find it, please contact the
            administrator.
          </p>

          <p className="induction-step-title">Step 4: Submit documents</p>
          <ul className="induction-ul">
            <li>
              Share the following documents to the email address {linkMail('studentsupport@slit.edu.au')}. For each line,
              select <strong>Yes</strong> or <strong>No</strong>. If you select <strong>Yes</strong>, you must attach the file
              below; if <strong>No</strong>, no attachment is needed.
            </li>
          </ul>
          {interactive ? (
            <ul className="mt-2 list-none space-y-3 pl-0">
              {INDUCTION_DOCUMENT_KEYS.map((key) => {
                const label = INDUCTION_DOCUMENT_LABELS[key];
                const row = interactive.value.documents[key];
                const multi = inductionDocumentAllowsMultiple(key);
                const savedAttached = getInductionDocumentAttachments(row, key);
                const pending = pendingDocFiles[key] ?? [];
                const pickedName = row.fileName?.trim() ?? '';
                const attached =
                  savedAttached.length > 0
                    ? savedAttached
                    : pending.length > 0
                      ? pending.map((p) => ({ fileUrl: '', fileName: p.fileName }))
                      : pickedName
                        ? [{ fileUrl: '', fileName: pickedName }]
                        : [];
                const hasFile =
                  inductionDocumentHasAttachment(row, key) || pending.length > 0 || attached.length > 0;
                const isUploading = uploadingDoc === key;
                const folder = interactive.inductionSubmissionFolder;
                const canUpload =
                  !interactive.readOnly &&
                  ((typeof folder === 'number' && folder > 0) || (typeof folder === 'string' && folder.trim().length > 0));

                const stageSelectedFiles = (files: File[]) => {
                  const names = files.map((f) => ({ fileName: f.name }));
                  setPendingDocFiles((prev) => ({
                    ...prev,
                    [key]: multi ? [...(prev[key] ?? []), ...names] : names,
                  }));
                  const label = multi ? files.map((f) => f.name).join(', ') : files[0]?.name ?? '';
                  applyFormChange((prev) => ({
                    ...prev,
                    documents: {
                      ...prev.documents,
                      [key]: { ...prev.documents[key], fileName: label },
                    },
                  }));
                };

                const uploadFiles = async (files: File[]) => {
                  if (!files.length) return;
                  if (!canUpload || folder == null) {
                    toast.error(
                      'Sign in with your institutional email and unlock the induction before attaching files.'
                    );
                    return;
                  }

                  setUploadingDoc(key);
                  const uploaded: { fileUrl: string; fileName: string }[] = [];
                  for (const f of files) {
                    const slot = multi
                      ? `${Date.now()}_${f.name.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40)}`
                      : undefined;
                    const { url, error } = await uploadInductionDocument(folder, key, f, slot);
                    if (error || !url) {
                      toast.error(error || `Upload failed: ${f.name}`);
                      continue;
                    }
                    uploaded.push({ fileUrl: url, fileName: f.name });
                  }
                  setUploadingDoc(null);

                  if (!uploaded.length) {
                    toast.error(
                      'Upload failed. Your file is listed below — tap Attach to try again, or check storage policies in Supabase (photomedia bucket).'
                    );
                    return;
                  }

                  applyFormChange((prev) => {
                    const existing = getInductionDocumentAttachments(prev.documents[key], key);
                    const merged = multi ? [...existing, ...uploaded] : uploaded.slice(0, 1);
                    return {
                      ...prev,
                      documents: {
                        ...prev.documents,
                        [key]: {
                          ...prev.documents[key],
                          ...syncInductionDocumentRowFiles(merged, key),
                        },
                      },
                    };
                  });

                  setPendingDocFiles((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });

                  toast.success(
                    uploaded.length === 1
                      ? `Attached: ${uploaded[0].fileName}`
                      : `${uploaded.length} files attached.`
                  );
                };
                return (
                  <li key={key} className="border-b border-gray-200 pb-3">
                    <div className="flex flex-col gap-2">
                      <strong>{label}</strong>
                      {multi ? (
                        <p className="text-[9pt] text-gray-600">
                          You can attach multiple files (e.g. certificates from different years).
                        </p>
                      ) : null}
                      <div className="flex flex-col gap-3 text-[11pt]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-gray-200 bg-gray-50/90 px-2 py-1.5">
                          <span className="w-full text-[10pt] font-semibold sm:w-auto">Submitted?</span>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name={`ind-doc-sub-${key}`}
                              checked={row.submitted === 'yes'}
                              onChange={() => patchDoc(key, { submitted: 'yes' })}
                              disabled={interactive.readOnly}
                              className="h-4 w-4"
                            />
                            Yes
                          </label>
                          <label className="inline-flex items-center gap-1.5">
                            <input
                              type="radio"
                              name={`ind-doc-sub-${key}`}
                              checked={row.submitted === 'no'}
                              onChange={() => {
                                setPendingDocFiles((prev) => {
                                  const next = { ...prev };
                                  delete next[key];
                                  return next;
                                });
                                patchDoc(key, {
                                  submitted: 'no',
                                  fileUrl: '',
                                  fileName: '',
                                  attachments: undefined,
                                });
                              }}
                              disabled={interactive.readOnly}
                              className="h-4 w-4"
                            />
                            No
                          </label>
                        </div>
                        <div className="flex min-w-0 flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              id={`ind-doc-${key}`}
                              type="file"
                              className="hidden"
                              multiple={multi}
                              accept="image/*,.pdf,.doc,.docx,application/pdf"
                              disabled={isUploading}
                              onChange={(ev) => {
                                const list = ev.target.files;
                                if (!list?.length) return;
                                const files = Array.from(list);
                                ev.target.value = '';
                                stageSelectedFiles(files);
                                void uploadFiles(files);
                              }}
                            />
                            <button
                              type="button"
                              disabled={isUploading}
                              onClick={() => {
                                if (!canUpload) {
                                  toast.error(
                                    'Sign in with your institutional email and unlock the induction before attaching files.'
                                  );
                                  return;
                                }
                                if (isUploading) return;
                                document.getElementById(`ind-doc-${key}`)?.click();
                              }}
                              className={`rounded border border-gray-400 bg-gray-50 px-3 py-1.5 text-[10pt] font-medium ${
                                !isUploading ? 'cursor-pointer hover:bg-gray-100' : 'cursor-not-allowed opacity-50'
                              }`}
                            >
                              {isUploading ? 'Uploading…' : multi && hasFile ? 'Add more files' : 'Attach'}
                            </button>
                            {hasFile ? (
                              <span className="text-[9pt] font-medium text-emerald-800">
                                {isUploading && pending.length > 0
                                  ? `Uploading ${pending.length} file${pending.length === 1 ? '' : 's'}…`
                                  : `${savedAttached.length || attached.length} file${(savedAttached.length || attached.length) === 1 ? '' : 's'} attached`}
                              </span>
                            ) : row.submitted === 'yes' ? (
                              <span className="text-[9pt] font-medium text-red-700">
                                {pickedName ? 'Upload failed — try Attach again' : 'Attachment required'}
                              </span>
                            ) : (
                              <span className="text-[9pt] text-gray-500">No attachment if No</span>
                            )}
                          </div>
                          {attached.length > 0 ? (
                            <ul className="list-none space-y-2 pl-0" aria-label={`Attached files for ${label}`}>
                              {attached.map((f, idx) => {
                                const saved = savedAttached[idx];
                                const pendingOnly = !saved?.fileUrl;
                                return (
                                  <li
                                    key={`${f.fileName}-${idx}`}
                                    className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-2 ${
                                      pendingOnly
                                        ? 'border-amber-200 bg-amber-50/90'
                                        : 'border-emerald-200 bg-emerald-50/80'
                                    }`}
                                  >
                                    <span
                                      className="min-w-0 flex-1 break-all text-[10pt] font-medium text-gray-900"
                                      title={f.fileName}
                                    >
                                      {f.fileName || `File ${idx + 1}`}
                                      {pendingOnly ? (
                                        <span className="ml-1 text-[9pt] font-normal text-amber-800">(uploading…)</span>
                                      ) : null}
                                    </span>
                                    {saved?.fileUrl ? (
                                      <a
                                        href={saved.fileUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        download={saved.fileName || undefined}
                                        className="shrink-0 text-[10pt] font-medium text-blue-700 underline"
                                      >
                                        View
                                      </a>
                                    ) : null}
                                    {canUpload && !isUploading ? (
                                      <button
                                        type="button"
                                        className="shrink-0 text-[10pt] text-red-700 underline"
                                        onClick={() => {
                                          if (pendingOnly) {
                                            setPendingDocFiles((prev) => {
                                              const list = [...(prev[key] ?? [])];
                                              list.splice(idx, 1);
                                              const next = { ...prev };
                                              if (list.length) next[key] = list;
                                              else delete next[key];
                                              return next;
                                            });
                                            return;
                                          }
                                          applyFormChange((prev) => {
                                            const list = getInductionDocumentAttachments(prev.documents[key], key);
                                            const nextList = list.filter((_, i) => i !== idx);
                                            return {
                                              ...prev,
                                              documents: {
                                                ...prev.documents,
                                                [key]: {
                                                  ...prev.documents[key],
                                                  ...syncInductionDocumentRowFiles(nextList, key),
                                                },
                                              },
                                            };
                                          });
                                        }}
                                      >
                                        Remove
                                      </button>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="induction-ul-nested ml-4">
              <li>
                <strong>Health insurance</strong>
              </li>
              <li>
                <strong>Passport sized photograph</strong> for student ID card
              </li>
              <li>
                <strong>Academic records</strong> (previous from grade 10)
              </li>
              <li>
                <strong>Current visa copy</strong>
              </li>
              <li>
                <strong>PTE or IELTS score</strong> (if given any)
              </li>
            </ul>
          )}

          <div className="mx-auto mt-4 border border-black p-3 text-[11pt]">
            <p className="text-center text-[12pt] font-bold uppercase underline">Important information</p>
            <ul className="induction-ul mt-2">
              <li>
                From now onwards, every email regarding the course or related to the student will be sent to the
                institutional email. So, always check emails regularly.
              </li>
              <li>Training plan and payment plan will be shared via the institutional email after the induction.</li>
              <li>Instructions and link to LMS will be provided shortly after induction.</li>
              <li>
                In case of any query, please contact <strong>03 9125 1661</strong> or email us on{' '}
                <strong>{linkMail('studentsupport@slit.edu.au')}</strong>
              </li>
            </ul>
          </div>
        </div>
        <p className="relative z-[1] mt-3 text-center text-[9pt] font-semibold uppercase text-[#4b5563]">{period}</p>
      </DocPage>

      {/* Page 2 — checklist (single sheet) */}
      <DocPage pageNum={2} totalPages={totalPages}>
        <SlitDocumentHeader />
        <h2 className="mt-2 text-center text-[14pt] font-bold uppercase text-gray-700">Student induction checklist</h2>
        <div className="mt-2 space-y-3 text-[10pt] sm:space-y-1">
          <ChecklistHeaderField label="Student full name:">
            {interactive ? (
              <input
                type="text"
                className={checklistHeaderInputClass}
                value={interactive.value.checklistHeader.fullName}
                onChange={(ev) =>
                  interactive.onChange(
                    (prev) => ({
                      ...prev,
                      checklistHeader: { ...prev.checklistHeader, fullName: ev.target.value },
                    }),
                    { activeNameField: 'checklist_full_name' }
                  )
                }
                disabled={interactive.readOnly}
                autoComplete="name"
              />
            ) : (
              <span className="block min-h-[1.25rem] border-b border-dotted border-gray-400 sm:inline-block sm:min-w-[200px]" />
            )}
          </ChecklistHeaderField>
          <ChecklistHeaderField label="Student ID:">
            {interactive ? (
              <input
                type="text"
                className={checklistHeaderInputClass}
                value={interactive.value.checklistHeader.studentId}
                onChange={(ev) =>
                  interactive.onChange({
                    ...interactive.value,
                    checklistHeader: { ...interactive.value.checklistHeader, studentId: ev.target.value },
                  })
                }
                disabled={interactive.readOnly}
                required
              />
            ) : (
              <span className="block min-h-[1.25rem] border-b border-dotted border-gray-400 sm:inline-block sm:min-w-[200px]" />
            )}
          </ChecklistHeaderField>
          <ChecklistHeaderField label="Email:">
            {interactive ? (
              <input
                type="email"
                inputMode="email"
                className={checklistHeaderInputClass}
                value={interactive.value.checklistHeader.email}
                onChange={(ev) =>
                  interactive.onChange({
                    ...interactive.value,
                    checklistHeader: { ...interactive.value.checklistHeader, email: ev.target.value },
                  })
                }
                disabled={interactive.readOnly}
                autoComplete="email"
              />
            ) : (
              <span className="block min-h-[1.25rem] border-b border-dotted border-gray-400 sm:inline-block sm:min-w-[180px]" />
            )}
          </ChecklistHeaderField>
          <ChecklistHeaderField label="Mobile:">
            {interactive ? (
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                className={checklistHeaderInputClass}
                value={interactive.value.checklistHeader.mobile}
                onChange={(ev) =>
                  interactive.onChange({
                    ...interactive.value,
                    checklistHeader: {
                      ...interactive.value.checklistHeader,
                      mobile: sanitizeInductionPhoneInput(ev.target.value),
                    },
                  })
                }
                disabled={interactive.readOnly}
                autoComplete="tel"
              />
            ) : (
              <span className="block min-h-[1.25rem] border-b border-dotted border-gray-400 sm:inline-block sm:min-w-[120px]" />
            )}
          </ChecklistHeaderField>
          <ChecklistHeaderField label="Course:">
            {interactive ? (
              <input
                type="text"
                className={checklistHeaderInputClass}
                value={interactive.value.checklistHeader.course}
                onChange={(ev) =>
                  interactive.onChange({
                    ...interactive.value,
                    checklistHeader: { ...interactive.value.checklistHeader, course: ev.target.value },
                  })
                }
                disabled={interactive.readOnly}
              />
            ) : (
              <span className="block min-h-[1.25rem] border-b border-dotted border-gray-400 sm:inline-block sm:min-w-[240px]" />
            )}
          </ChecklistHeaderField>
        </div>

        {interactive && !interactive.readOnly ? (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50/80 px-3 py-2.5 text-[9pt] leading-snug text-gray-800">
            <Checkbox
              label="Use the same initials for every topic (recommended). Type in any initials box once — all rows update. Untick to enter different initials per row."
              checked={interactive.value.checklistSyncInitials !== false}
              onChange={(checked) => {
                const v = interactive.value;
                if (checked) {
                  let seed = '';
                  for (const k of CHECKLIST_TOPIC_KEYS) {
                    const t = String(v.checklistRows[k]?.initial ?? '').trim();
                    if (t) {
                      seed = t;
                      break;
                    }
                  }
                  const nextRows = { ...v.checklistRows };
                  if (seed) {
                    for (const k of CHECKLIST_TOPIC_KEYS) {
                      nextRows[k] = { ...nextRows[k], initial: seed };
                    }
                  }
                  interactive.onChange({
                    ...v,
                    checklistSyncInitials: true,
                    checklistRows: seed ? nextRows : v.checklistRows,
                  });
                } else {
                  interactive.onChange({ ...v, checklistSyncInitials: false });
                }
              }}
            />
          </div>
        ) : null}

        <div className="mt-3 -mx-1 overflow-x-auto px-1 sm:mx-0 sm:px-0">
          <table className="induction-checklist-table w-full min-w-[280px] border-collapse border border-black sm:min-w-0">
            <thead>
              <tr className="bg-[#F28E40] text-black">
                <th className="border border-black px-1.5 py-1 text-left font-bold uppercase">Information topic</th>
                <th className="border border-black px-0.5 py-1 text-center font-bold uppercase w-[44px]">Yes</th>
                <th className="border border-black px-0.5 py-1 text-center font-bold uppercase w-[44px]">No</th>
                <th className="border border-black px-0.5 py-1 text-center font-bold uppercase w-[88px]">Student initial</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const patchChecklistRow = (rowKey: ChecklistTopicKey, p: Partial<ChecklistRowState>) => {
                  if (!interactive) return;
                  const v = interactive.value;
                  const sync = v.checklistSyncInitials !== false;
                  if (sync && p.initial !== undefined && p.answer === undefined) {
                    const nextRows = { ...v.checklistRows };
                    const val = String(p.initial ?? '');
                    for (const k of CHECKLIST_TOPIC_KEYS) {
                      nextRows[k] = { ...nextRows[k], initial: val };
                    }
                    interactive.onChange({ ...v, checklistRows: nextRows });
                    return;
                  }
                  interactive.onChange({
                    ...v,
                    checklistRows: {
                      ...v.checklistRows,
                      [rowKey]: { ...v.checklistRows[rowKey], ...p },
                    },
                  });
                };
                return CHECKLIST_TOPIC_KEYS.map((rowKey) => {
                  const hi = checklistRowHighlight(rowKey);
                  const row = interactive?.value.checklistRows[rowKey];
                  const ro = interactive?.readOnly;
                  return (
                    <tr key={rowKey}>
                      <td className="border border-black px-1.5 py-1 align-top">{inductionChecklistTopicCell(rowKey)}</td>
                      <td
                        className={`induction-checklist-yn-cell induction-checklist-yn-cell--yes border border-black text-center align-middle ${hi ? 'bg-blue-50/50' : ''}`}
                      >
                        {interactive && row ? (
                          <label className="justify-center py-1 sm:py-0">
                            <input
                              type="radio"
                              name={`chk-${rowKey}-yn`}
                              aria-label={`Yes — ${rowKey}`}
                              checked={row.answer === 'yes'}
                              onChange={() => patchChecklistRow(rowKey, { answer: 'yes' })}
                              disabled={ro}
                              className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5"
                            />
                          </label>
                        ) : null}
                      </td>
                      <td
                        className={`induction-checklist-yn-cell induction-checklist-yn-cell--no border border-black text-center align-middle ${hi ? 'bg-blue-50/50' : ''}`}
                      >
                        {interactive && row ? (
                          <label className="justify-center py-1 sm:py-0">
                            <input
                              type="radio"
                              name={`chk-${rowKey}-yn`}
                              aria-label={`No — ${rowKey}`}
                              checked={row.answer === 'no'}
                              onChange={() => patchChecklistRow(rowKey, { answer: 'no' })}
                              disabled={ro}
                              className="h-4 w-4 shrink-0 sm:h-3.5 sm:w-3.5"
                            />
                          </label>
                        ) : null}
                      </td>
                      <td
                        className={`induction-checklist-initial-cell border border-black px-0.5 align-middle ${hi ? 'bg-blue-50/50' : ''}`}
                      >
                        {interactive && row ? (
                          <input
                            type="text"
                            maxLength={8}
                            className="w-full min-w-0 border-0 bg-transparent px-0.5 py-0.5 text-center text-[8pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-80"
                            value={row.initial}
                            onChange={(ev) => patchChecklistRow(rowKey, { initial: ev.target.value })}
                            disabled={ro}
                            autoComplete="off"
                          />
                        ) : null}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-[10pt]">
          <p className="font-bold uppercase">Declaration</p>
          <p className="mt-1 leading-snug">
            I have attended the induction program at Skyline Institute of Technology. I acknowledge that I have understood
            the information mentioned above.
          </p>
          <p className="induction-declaration-sign-date mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-4 sm:gap-y-2">
            <span className="block w-full sm:inline sm:w-auto">
              <span className="font-semibold">Signature:</span>{' '}
              {interactive ? (
                <input
                  type="text"
                  className={`mt-1 block w-full min-w-0 sm:mt-0 sm:ml-1 sm:inline-block sm:min-w-[200px] ${SIG_INPUT_BASE}`}
                  value={interactive.value.checklistDeclaration.signature}
                  onChange={(ev) =>
                    interactive.onChange(
                      (prev) => ({
                        ...prev,
                        checklistDeclaration: { ...prev.checklistDeclaration, signature: ev.target.value },
                      }),
                      { activeSignatureField: 'checklist_declaration' }
                    )
                  }
                  disabled={interactive.readOnly}
                />
              ) : (
                <span className="inline-block min-w-[220px] border-b border-gray-800" />
              )}
            </span>
            <span className="block w-full sm:inline-flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
              <span className="font-semibold">Date:</span>
              {interactive ? (
                <InductionInlineDatePicker
                  value={interactive.value.checklistDeclaration.date}
                  onChange={(iso) =>
                    interactive.onChange(
                      (prev) => ({
                        ...prev,
                        checklistDeclaration: { ...prev.checklistDeclaration, date: iso },
                      }),
                      { activeDateField: 'checklist_declaration' }
                    )
                  }
                  disabled={interactive.readOnly}
                  className="mt-1 w-full max-w-full sm:mt-0 sm:max-w-[148px]"
                />
              ) : (
                <span className="mt-1 inline-block min-h-[1.25rem] w-full border-b border-gray-800 sm:mt-0 sm:min-w-[100px] sm:w-auto" />
              )}
            </span>
          </p>
        </div>
      </DocPage>

      {/* Page 3 — Student Enrolment Form (International) */}
      <DocPage pageNum={3} totalPages={totalPages} allowBreakInside>
        <SlitDocumentHeader />
        <h2 className="mt-2 text-left text-[18pt] font-bold text-black">Student Enrolment Form (International)</h2>
        <EnrolmentFormTable interactive={interactive} />
      </DocPage>

      {/* Page 4 — F12 Photographic / Media Consent (compact — single print sheet) */}
      <DocPage pageNum={4} totalPages={totalPages}>
        <SlitDocumentHeader />
        <h2 className="mt-1 text-center text-[12pt] font-bold text-black leading-tight">
          F12 Photographic / Media Consent Form
        </h2>
        <MediaConsentContent interactive={interactive} />
      </DocPage>
    </div>
  );
};
