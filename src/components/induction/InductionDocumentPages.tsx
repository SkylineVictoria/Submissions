import React, { useState } from 'react';
import { SlitDocumentHeader } from '../SlitDocumentHeader';
import { Checkbox } from '../ui/Checkbox';
import { DatePicker } from '../ui/DatePicker';
import { DateTime } from 'luxon';
import type { ChecklistRowState, ChecklistTopicKey, InductionDocumentKey, InductionFormPayload } from '../../lib/inductionForm';
import { CHECKLIST_TOPIC_KEYS, INDUCTION_DOCUMENT_KEYS, INDUCTION_DOCUMENT_LABELS } from '../../lib/inductionForm';
import { uploadInductionDocument } from '../../lib/storage';
import { toast } from '../../utils/toast';
const ZONE = 'Australia/Melbourne';

export interface InductionInteractiveBindings {
  value: InductionFormPayload;
  onChange: (next: InductionFormPayload) => void;
  readOnly?: boolean;
  /** When false (default), OFFICE USE ONLY is read-only (student induction). Set true for admin/trainer tools. */
  allowOfficeUseEdit?: boolean;
  /** Skyline induction row id — uploads go to `photomedia/skyline/induction/{id}/`. */
  inductionId?: number;
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

function EnrolmentFormTable({ interactive }: { interactive?: InductionInteractiveBindings }) {
  const empty = <span className="block min-h-[1.25rem]">&nbsp;</span>;
  const e = interactive?.value.enrolment;
  const ro = interactive?.readOnly;
  const officeLocked = ro || !interactive?.allowOfficeUseEdit;
  const patch = (p: Partial<InductionFormPayload['enrolment']>) => {
    if (!interactive) return;
    interactive.onChange({ ...interactive.value, enrolment: { ...interactive.value.enrolment, ...p } });
  };

  const textCell = (field: keyof InductionFormPayload['enrolment']) =>
    interactive && e ? (
      <input
        type="text"
        className={enrolInp}
        value={e[field] as string}
        onChange={(ev) => patch({ [field]: ev.target.value } as Partial<InductionFormPayload['enrolment']>)}
        disabled={ro}
        autoComplete="off"
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
                  onChange={(ev) => patch({ declarationSignature: ev.target.value })}
                  disabled={ro}
                  autoComplete="off"
                />
                <span className="font-semibold">Date:</span>
                <InductionInlineDatePicker
                  value={e.declarationDate}
                  onChange={(iso) => patch({ declarationDate: iso })}
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
  const patchAck = (p: Partial<InductionFormPayload['mediaAck']>) => {
    if (!interactive) return;
    interactive.onChange({ ...interactive.value, mediaAck: { ...interactive.value.mediaAck, ...p } });
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
              onChange={(ev) => patchAck({ studentName: ev.target.value })}
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
              onChange={(ev) => patchAck({ studentSignature: ev.target.value })}
              disabled={ro}
            />
          ) : (
            <span className={`inline-block border-b border-black ${SIG_W_WIDE}`}>&nbsp;</span>
          )}
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">Date:</span>
          {interactive && a ? (
            <InductionInlineDatePicker value={a.date} onChange={(iso) => patchAck({ date: iso })} disabled={ro} />
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

  const patchLogin = (p: Partial<InductionFormPayload['loginSetup']>) => {
    if (!interactive) return;
    interactive.onChange({
      ...interactive.value,
      loginSetup: { ...interactive.value.loginSetup, ...p },
    });
  };

  const patchDoc = (key: InductionDocumentKey, p: Partial<InductionFormPayload['documents'][InductionDocumentKey]>) => {
    if (!interactive) return;
    interactive.onChange({
      ...interactive.value,
      documents: {
        ...interactive.value.documents,
        [key]: { ...interactive.value.documents[key], ...p },
      },
    });
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
              Share the following documents to the email address {linkMail('studentsupport@slit.edu.au')}. Attachment below is
              optional; you must select <strong>Yes</strong> or <strong>No</strong> for each line (whether you have submitted
              or shared that item).
            </li>
          </ul>
          {interactive ? (
            <ul className="mt-2 list-none space-y-3 pl-0">
              {INDUCTION_DOCUMENT_KEYS.map((key) => {
                const label = INDUCTION_DOCUMENT_LABELS[key];
                const row = interactive.value.documents[key];
                const iid = interactive.inductionId;
                const canUpload = !interactive.readOnly && typeof iid === 'number' && iid > 0;
                return (
                  <li key={key} className="border-b border-gray-200 pb-3">
                    <div className="flex flex-col gap-2">
                      <strong>{label}</strong>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11pt]">
                          <input
                            id={`ind-doc-${key}`}
                            type="file"
                            className="hidden"
                            accept="image/*,.pdf,.doc,.docx,application/pdf"
                            disabled={!canUpload || uploadingDoc === key}
                            onChange={async (ev) => {
                              const f = ev.target.files?.[0];
                              ev.target.value = '';
                              if (!f || !canUpload || iid == null) return;
                              setUploadingDoc(key);
                              const { url, error } = await uploadInductionDocument(iid, key, f);
                              setUploadingDoc(null);
                              if (error || !url) {
                                toast.error(error || 'Upload failed.');
                                return;
                              }
                              patchDoc(key, { fileUrl: url, fileName: f.name });
                              toast.success('File attached.');
                            }}
                          />
                          <label
                            htmlFor={`ind-doc-${key}`}
                            className={`rounded border border-gray-400 bg-gray-50 px-2 py-0.5 text-[10pt] ${
                              canUpload ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
                            }`}
                          >
                            {uploadingDoc === key ? 'Uploading…' : 'Attach'}
                          </label>
                          {row.fileUrl && canUpload ? (
                            <button
                              type="button"
                              className="text-[10pt] text-red-600 underline"
                              onClick={() => patchDoc(key, { fileUrl: '', fileName: '' })}
                            >
                              Remove file
                            </button>
                          ) : (
                            <span className="text-[9pt] text-gray-500">Optional</span>
                          )}
                        </div>
                        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 text-[11pt]">
                          <span className="text-[10pt] font-semibold">Submitted?</span>
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name={`ind-doc-sub-${key}`}
                              checked={row.submitted === 'yes'}
                              onChange={() => patchDoc(key, { submitted: 'yes' })}
                              disabled={interactive.readOnly}
                            />
                            Yes
                          </label>
                          <label className="inline-flex items-center gap-1">
                            <input
                              type="radio"
                              name={`ind-doc-sub-${key}`}
                              checked={row.submitted === 'no'}
                              onChange={() => patchDoc(key, { submitted: 'no' })}
                              disabled={interactive.readOnly}
                            />
                            No
                          </label>
                          {row.submitted === 'yes' && row.fileUrl ? (
                            <a
                              href={row.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                              download={row.fileName || undefined}
                              className="text-blue-600 underline"
                            >
                              Download
                            </a>
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
        <div className="mt-2 text-[10pt] space-y-1">
          <p>
            <span className="font-semibold">Student full name:</span>{' '}
            {interactive ? (
              <input
                type="text"
                className="ml-1 inline-block min-w-[200px] border-b border-dotted border-gray-500 bg-transparent px-1 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-80"
                value={interactive.value.checklistHeader.fullName}
                onChange={(ev) =>
                  interactive.onChange({
                    ...interactive.value,
                    checklistHeader: { ...interactive.value.checklistHeader, fullName: ev.target.value },
                  })
                }
                disabled={interactive.readOnly}
                autoComplete="name"
              />
            ) : (
              <span className="inline-block min-w-[200px] border-b border-dotted border-gray-400" />
            )}
          </p>
          <p>
            <span className="font-semibold">Student ID:</span>{' '}
            {interactive ? (
              <input
                type="text"
                className="ml-1 inline-block min-w-[200px] border-b border-dotted border-gray-500 bg-transparent px-1 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-80"
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
              <span className="inline-block min-w-[200px] border-b border-dotted border-gray-400" />
            )}
          </p>
          <p>
            <span className="font-semibold">Email:</span>{' '}
            {interactive ? (
              <input
                type="email"
                className="ml-1 inline-block min-w-[160px] border-b border-dotted border-gray-500 bg-transparent px-1 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-80"
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
              <span className="inline-block min-w-[180px] border-b border-dotted border-gray-400" />
            )}{' '}
            <span className="font-semibold">Mobile:</span>{' '}
            {interactive ? (
              <input
                type="text"
                className="ml-1 inline-block min-w-[100px] border-b border-dotted border-gray-500 bg-transparent px-1 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-80"
                value={interactive.value.checklistHeader.mobile}
                onChange={(ev) =>
                  interactive.onChange({
                    ...interactive.value,
                    checklistHeader: { ...interactive.value.checklistHeader, mobile: ev.target.value },
                  })
                }
                disabled={interactive.readOnly}
                autoComplete="tel"
              />
            ) : (
              <span className="inline-block min-w-[120px] border-b border-dotted border-gray-400" />
            )}
          </p>
          <p>
            <span className="font-semibold">Course:</span>{' '}
            {interactive ? (
              <input
                type="text"
                className="ml-1 inline-block min-w-[220px] border-b border-dotted border-gray-500 bg-transparent px-1 py-0.5 text-[10pt] outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-80"
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
              <span className="inline-block min-w-[240px] border-b border-dotted border-gray-400" />
            )}
          </p>
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

        <div className="mt-3 overflow-x-auto">
          <table className="induction-checklist-table w-full border-collapse border border-black">
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
                      <td className={`border border-black text-center align-middle ${hi ? 'bg-blue-50/50' : ''}`}>
                        {interactive && row ? (
                          <input
                            type="radio"
                            name={`chk-${rowKey}-yn`}
                            aria-label={`Yes — ${rowKey}`}
                            checked={row.answer === 'yes'}
                            onChange={() => patchChecklistRow(rowKey, { answer: 'yes' })}
                            disabled={ro}
                            className="h-3.5 w-3.5"
                          />
                        ) : null}
                      </td>
                      <td className={`border border-black text-center align-middle ${hi ? 'bg-blue-50/50' : ''}`}>
                        {interactive && row ? (
                          <input
                            type="radio"
                            name={`chk-${rowKey}-yn`}
                            aria-label={`No — ${rowKey}`}
                            checked={row.answer === 'no'}
                            onChange={() => patchChecklistRow(rowKey, { answer: 'no' })}
                            disabled={ro}
                            className="h-3.5 w-3.5"
                          />
                        ) : null}
                      </td>
                      <td className={`border border-black px-0.5 align-middle ${hi ? 'bg-blue-50/50' : ''}`}>
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
          <p className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
            <span>
              <span className="font-semibold">Signature:</span>{' '}
              {interactive ? (
                <input
                  type="text"
                  className={`ml-1 inline-block min-w-[200px] ${SIG_INPUT_BASE}`}
                  value={interactive.value.checklistDeclaration.signature}
                  onChange={(ev) =>
                    interactive.onChange({
                      ...interactive.value,
                      checklistDeclaration: { ...interactive.value.checklistDeclaration, signature: ev.target.value },
                    })
                  }
                  disabled={interactive.readOnly}
                />
              ) : (
                <span className="inline-block min-w-[220px] border-b border-gray-800" />
              )}
            </span>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold">Date:</span>
              {interactive ? (
                <InductionInlineDatePicker
                  value={interactive.value.checklistDeclaration.date}
                  onChange={(iso) =>
                    interactive.onChange({
                      ...interactive.value,
                      checklistDeclaration: { ...interactive.value.checklistDeclaration, date: iso },
                    })
                  }
                  disabled={interactive.readOnly}
                />
              ) : (
                <span className="inline-block min-w-[100px] border-b border-gray-800" />
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
