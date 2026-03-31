/** Induction web form payload (checklist, enrolment, media) — stored in skyline_induction_submissions.payload */

import { format, isValid, parse } from 'date-fns';

const ISO_DATE = 'yyyy-MM-dd';

/** Normalize stored / legacy dates to ISO yyyy-MM-dd for DatePicker. */
export function normalizeInductionDateToIso(input: string): string {
  const t = String(input ?? '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const formats = ['dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy', 'd-M-yyyy', 'dd/MM/yy', 'd/M/yy'];
  for (const f of formats) {
    const d = parse(t, f, new Date());
    if (isValid(d)) return format(d, ISO_DATE);
  }
  return t;
}

function normalizePayloadDates(p: InductionFormPayload): InductionFormPayload {
  const cd = normalizeInductionDateToIso(p.checklistDeclaration.date);
  const e = p.enrolment;
  const a = p.mediaAck;
  const m = p.mediaConsent;
  return {
    ...p,
    checklistDeclaration: { ...p.checklistDeclaration, date: cd },
    enrolment: {
      ...e,
      dateOfBirth: normalizeInductionDateToIso(e.dateOfBirth),
      visaExpiry: normalizeInductionDateToIso(e.visaExpiry),
      declarationDate: normalizeInductionDateToIso(e.declarationDate),
      officeSmsDate: normalizeInductionDateToIso(e.officeSmsDate),
      officePrismsDate: normalizeInductionDateToIso(e.officePrismsDate),
    },
    mediaAck: { ...a, date: normalizeInductionDateToIso(a.date) },
    mediaConsent: { ...m, date: normalizeInductionDateToIso(m.date) },
  };
}

/**
 * Prefer the longest non-empty value; when lengths tie, the **last** field in document order wins (e.g. later page).
 * While the user types in one box, shorter values elsewhere are treated as prefixes and update — fixes "only first letter" stuck sync.
 */
function pickPrimaryMirrorSource(orderedValues: string[]): string {
  const trimmed = orderedValues.map((v) => String(v ?? '').trim());
  let maxLen = 0;
  for (const t of trimmed) {
    if (t.length > maxLen) maxLen = t.length;
  }
  if (maxLen === 0) return '';
  for (let i = trimmed.length - 1; i >= 0; i--) {
    if (trimmed[i].length === maxLen) return trimmed[i];
  }
  return '';
}

/**
 * Mirror target should update to primary when identical, or still a prefix of primary (user typing ahead).
 * For empty targets: mirror when all non-empty siblings agree (one distinct value), so e.g. checklist + enrolment
 * can both show the same signature and the third field still receives it. If multiple different values exist,
 * do not fill empties (avoids fighting intentional edits or deletes).
 */
function shouldMirrorFromPrimary(primary: string, fieldValue: string, allValues: string[]): boolean {
  const p = primary.trim();
  const f = String(fieldValue ?? '').trim();
  if (!p) return false;
  if (!f) {
    const nonEmptyVals = allValues.map((v) => String(v ?? '').trim()).filter(Boolean);
    const unique = new Set(nonEmptyVals);
    return unique.size <= 1;
  }
  if (f === p) return true;
  if (p.startsWith(f)) return true;
  return false;
}

function mirrorTextGroup(
  primary: string,
  mutators: Array<{ read: () => string; write: (v: string) => void }>
): void {
  if (!primary.trim()) return;
  const allValues = mutators.map((m) => m.read());
  for (const { read, write } of mutators) {
    if (shouldMirrorFromPrimary(primary, read(), allValues)) write(primary);
  }
}

function mirrorDeclDates(next: InductionFormPayload, primary: string): void {
  if (!primary.trim()) return;
  /* Exclude optional consent date — clearing it must not be overwritten by mirrored student/ack dates. */
  const mutators = [
    { read: () => next.checklistDeclaration.date, write: (v: string) => { next.checklistDeclaration.date = v; } },
    { read: () => next.enrolment.declarationDate, write: (v: string) => { next.enrolment.declarationDate = v; } },
    { read: () => next.mediaAck.date, write: (v: string) => { next.mediaAck.date = v; } },
  ];
  const allValues = mutators.map((m) => m.read());
  for (const { read, write } of mutators) {
    if (shouldMirrorFromPrimary(primary, read(), allValues)) write(primary);
  }
}

/**
 * Copy student name / signatures / declaration dates across matching fields (checklist ↔ enrolment ↔ CCTV ack).
 * Optional consent block names and consent date are not mirrored so users can clear or edit them independently.
 */
export function synchronizeInductionDerivedFields(p: InductionFormPayload): InductionFormPayload {
  const next: InductionFormPayload = {
    ...p,
    checklistHeader: { ...p.checklistHeader },
    checklistDeclaration: { ...p.checklistDeclaration },
    enrolment: { ...p.enrolment },
    mediaAck: { ...p.mediaAck },
    mediaConsent: { ...p.mediaConsent },
  };

  /* Student identity only — optional consent “I …” / printed name lines are independent (otherwise clearing them
   * refills from checklist / acknowledgement via mirror). */
  const namePrimary = pickPrimaryMirrorSource([next.checklistHeader.fullName, next.mediaAck.studentName]);
  mirrorTextGroup(namePrimary, [
    { read: () => next.checklistHeader.fullName, write: (v) => { next.checklistHeader.fullName = v; } },
    { read: () => next.mediaAck.studentName, write: (v) => { next.mediaAck.studentName = v; } },
  ]);

  /* Student signatures only — optional media consent signature may be a different person; do not mirror. */
  const sigPrimary = pickPrimaryMirrorSource([
    next.checklistDeclaration.signature,
    next.enrolment.declarationSignature,
    next.mediaAck.studentSignature,
  ]);
  mirrorTextGroup(sigPrimary, [
    { read: () => next.checklistDeclaration.signature, write: (v) => { next.checklistDeclaration.signature = v; } },
    { read: () => next.enrolment.declarationSignature, write: (v) => { next.enrolment.declarationSignature = v; } },
    { read: () => next.mediaAck.studentSignature, write: (v) => { next.mediaAck.studentSignature = v; } },
  ]);

  const declDatePrimary = pickPrimaryMirrorSource([
    next.checklistDeclaration.date,
    next.enrolment.declarationDate,
    next.mediaAck.date,
  ]);
  mirrorDeclDates(next, declDatePrimary);

  return next;
}

export const CHECKLIST_TOPIC_KEYS = [
  'course_module',
  'refund',
  'deferment',
  'credit_transfer',
  'transfer',
  'fees',
  'access_records',
  'complaints',
  'attendance',
  'reassessment',
  'ethics',
  'ohs',
  'location',
  'student_support',
  'visa',
  'melbourne',
  'handbook',
] as const;

export type ChecklistTopicKey = (typeof CHECKLIST_TOPIC_KEYS)[number];

export type ChecklistAnswer = 'yes' | 'no' | '';

export interface ChecklistRowState {
  answer: ChecklistAnswer;
  initial: string;
}

export interface ChecklistHeaderState {
  fullName: string;
  studentId: string;
  email: string;
  mobile: string;
  course: string;
}

export interface ChecklistDeclarationState {
  signature: string;
  date: string;
}

export interface EnrolmentFormState {
  familyName: string;
  givenNames: string;
  dateOfBirth: string;
  gender: '' | 'male' | 'female';
  studentId: string;
  passportNumber: string;
  visaNumber: string;
  visaExpiry: string;
  residentialAddress: string;
  phone: string;
  email: string;
  usiNumber: string;
  emergencyName: string;
  emergencyAddress: string;
  emergencyPhone: string;
  emergencyRelationship: string;
  declarationSignature: string;
  declarationDate: string;
  officeSmsBy: string;
  officeSmsDate: string;
  officePrismsBy: string;
  officePrismsDate: string;
}

export interface MediaAckState {
  studentName: string;
  studentSignature: string;
  date: string;
}

export interface MediaConsentState {
  consentorNameOnLine: string;
  name: string;
  signature: string;
  date: string;
}

export interface InductionFormPayload {
  version: 1;
  checklistHeader: ChecklistHeaderState;
  checklistRows: Record<ChecklistTopicKey, ChecklistRowState>;
  /** When true (default), typing initials in any row updates every topic — same as assessment forms. */
  checklistSyncInitials?: boolean;
  checklistDeclaration: ChecklistDeclarationState;
  enrolment: EnrolmentFormState;
  mediaAck: MediaAckState;
  mediaConsent: MediaConsentState;
}

export function emptyChecklistRow(): ChecklistRowState {
  return { answer: '', initial: '' };
}

export function emptyInductionFormPayload(): InductionFormPayload {
  const rows = {} as Record<ChecklistTopicKey, ChecklistRowState>;
  for (const k of CHECKLIST_TOPIC_KEYS) rows[k] = emptyChecklistRow();
  return {
    version: 1,
    checklistHeader: { fullName: '', studentId: '', email: '', mobile: '', course: '' },
    checklistRows: rows,
    checklistSyncInitials: true,
    checklistDeclaration: { signature: '', date: '' },
    enrolment: {
      familyName: '',
      givenNames: '',
      dateOfBirth: '',
      gender: '',
      studentId: '',
      passportNumber: '',
      visaNumber: '',
      visaExpiry: '',
      residentialAddress: '',
      phone: '',
      email: '',
      usiNumber: '',
      emergencyName: '',
      emergencyAddress: '',
      emergencyPhone: '',
      emergencyRelationship: '',
      declarationSignature: '',
      declarationDate: '',
      officeSmsBy: '',
      officeSmsDate: '',
      officePrismsBy: '',
      officePrismsDate: '',
    },
    mediaAck: { studentName: '', studentSignature: '', date: '' },
    mediaConsent: { consentorNameOnLine: '', name: '', signature: '', date: '' },
  };
}

function nonEmpty(s: string): boolean {
  return String(s ?? '').trim().length > 0;
}

function nonEmptyIsoDate(s: string): boolean {
  if (!nonEmpty(s)) return false;
  const d = parse(String(s).trim(), ISO_DATE, new Date());
  return isValid(d);
}

/** Returns first validation error message or null if valid. */
export function validateInductionFormPayload(p: InductionFormPayload): string | null {
  const h = p.checklistHeader;
  if (!nonEmpty(h.fullName)) return 'Enter your full name on the checklist.';
  if (!nonEmpty(h.studentId)) return 'Enter your student ID on the checklist.';
  if (!nonEmpty(h.email)) return 'Enter your email on the checklist.';
  if (!nonEmpty(h.mobile)) return 'Enter your mobile on the checklist.';
  if (!nonEmpty(h.course)) return 'Enter your course on the checklist.';

  for (const key of CHECKLIST_TOPIC_KEYS) {
    const row = p.checklistRows[key];
    if (!row || row.answer !== 'yes') {
      return 'For every checklist topic, select Yes and add your initials.';
    }
    if (!nonEmpty(row.initial)) return 'Add your initials for every checklist topic.';
  }

  const d = p.checklistDeclaration;
  if (!nonEmpty(d.signature)) return 'Sign the checklist declaration.';
  if (!nonEmptyIsoDate(d.date)) return 'Choose a valid date on the checklist declaration.';

  const e = p.enrolment;
  if (!nonEmpty(e.familyName)) return 'Enter family name on the enrolment form.';
  if (!nonEmpty(e.givenNames)) return 'Enter given name(s) on the enrolment form.';
  if (!nonEmptyIsoDate(e.dateOfBirth)) return 'Choose a valid date of birth on the enrolment form.';
  if (e.gender !== 'male' && e.gender !== 'female') return 'Select gender on the enrolment form.';
  if (!nonEmpty(e.studentId)) return 'Enter student ID on the enrolment form.';
  if (!nonEmpty(e.passportNumber)) return 'Enter passport number.';
  if (nonEmpty(e.visaExpiry) && !nonEmptyIsoDate(e.visaExpiry)) {
    return 'Choose a valid visa expiry date, or clear it.';
  }
  if (!nonEmpty(e.residentialAddress)) return 'Enter residential address.';
  if (!nonEmpty(e.phone)) return 'Enter phone on the enrolment form.';
  if (!nonEmpty(e.email)) return 'Enter email on the enrolment form.';
  if (!nonEmpty(e.usiNumber)) return 'Enter your USI number on the enrolment form.';
  if (!nonEmpty(e.emergencyName)) return 'Enter emergency contact name.';
  if (!nonEmpty(e.emergencyAddress)) return 'Enter emergency contact address.';
  if (!nonEmpty(e.emergencyPhone)) return 'Enter emergency contact telephone.';
  if (!nonEmpty(e.emergencyRelationship)) return 'Enter relationship to emergency contact.';
  if (!nonEmpty(e.declarationSignature)) return 'Sign the enrolment declaration.';
  if (!nonEmptyIsoDate(e.declarationDate)) return 'Choose a valid date on the enrolment declaration.';

  const a = p.mediaAck;
  if (!nonEmpty(a.studentName)) return 'Enter your name in the CCTV / surveillance acknowledgement section.';
  if (!nonEmpty(a.studentSignature)) return 'Sign the CCTV / surveillance acknowledgement.';
  if (!nonEmptyIsoDate(a.date)) return 'Choose a valid date in the acknowledgement section.';

  /* Media consent (promotional use) — optional; entire block may be left blank. */
  const m = p.mediaConsent;
  if (nonEmpty(m.date) && !nonEmptyIsoDate(m.date)) {
    return 'Choose a valid date on the optional consent form, or clear it.';
  }

  return null;
}

export function parseInductionPayload(raw: unknown): InductionFormPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return null;
  if (!o.checklistRows || typeof o.checklistRows !== 'object') return null;
  try {
    const base = emptyInductionFormPayload();
    const rawRows = o.checklistRows as Record<string, Partial<ChecklistRowState> | undefined>;
    const rows = { ...base.checklistRows };
    for (const k of CHECKLIST_TOPIC_KEYS) {
      const r = rawRows[k];
      if (r && typeof r === 'object') {
        const ans = r.answer;
        rows[k] = {
          answer: ans === 'yes' || ans === 'no' ? ans : '',
          initial: String(r.initial ?? ''),
        };
      }
    }
    const merged: InductionFormPayload = {
      ...base,
      checklistHeader: { ...base.checklistHeader, ...(o.checklistHeader as ChecklistHeaderState) },
      checklistRows: rows,
      checklistSyncInitials: o.checklistSyncInitials === false ? false : true,
      checklistDeclaration: { ...base.checklistDeclaration, ...(o.checklistDeclaration as ChecklistDeclarationState) },
      enrolment: { ...base.enrolment, ...(o.enrolment as EnrolmentFormState) },
      mediaAck: { ...base.mediaAck, ...(o.mediaAck as MediaAckState) },
      mediaConsent: { ...base.mediaConsent, ...(o.mediaConsent as MediaConsentState) },
    };
    return normalizePayloadDates(merged);
  } catch {
    return null;
  }
}
