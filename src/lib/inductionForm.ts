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
 * For empty targets: mirror when siblings share one distinct non-empty value — except when a *later* field still
 * holds that value while this field is empty: that means the user cleared this field (e.g. backspaced the
 * signature) and we must not refill it from duplicate copies on later pages.
 */
function shouldMirrorFromPrimary(primary: string, fieldValue: string, allValues: string[], fieldIndex: number): boolean {
  const p = primary.trim();
  const f = String(fieldValue ?? '').trim();
  if (!p) return false;
  if (!f) {
    const vals = allValues.map((v) => String(v ?? '').trim());
    const unique = new Set(vals.filter(Boolean));
    if (unique.size !== 1) return false;
    for (let j = fieldIndex + 1; j < vals.length; j++) {
      if (vals[j] === p) return false;
    }
    return true;
  }
  if (f === p) return true;
  if (p.startsWith(f)) return true;
  return false;
}

/** Same longest-field / last-wins rule as pickPrimaryMirrorSource but uses raw strings (no trim) so spaces and partial edits sync correctly.
 * When two+ fields still hold the longest value and another field is a strict prefix of it, treat that shorter value as
 * canonical (user backspaced in one box — mirror the same length to all three). */
function pickSignatureMirrorSource(orderedValues: string[]): string {
  const raw = orderedValues.map((v) => String(v ?? ''));
  let maxLen = 0;
  for (const s of raw) {
    if (s.length > maxLen) maxLen = s.length;
  }
  if (maxLen === 0) return '';
  let L = '';
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i].length === maxLen) {
      L = raw[i];
      break;
    }
  }
  const fullCount = raw.filter((v) => v === L).length;
  if (fullCount >= 2) {
    let shortestPrefix: string | null = null;
    for (const s of raw) {
      if (s.length === 0) continue;
      if (s.length >= L.length) continue;
      if (L.startsWith(s)) {
        if (shortestPrefix === null || s.length < shortestPrefix.length) shortestPrefix = s;
      }
    }
    if (shortestPrefix !== null) return shortestPrefix;
  }
  for (let i = raw.length - 1; i >= 0; i--) {
    if (raw[i].length === maxLen) return raw[i];
  }
  return '';
}

function shouldMirrorSignaturePrimary(primary: string, fieldValue: string, allValues: string[], fieldIndex: number): boolean {
  const p = primary;
  const f = String(fieldValue ?? '');
  if (!p.trim()) return false;
  const fEmpty = !f.trim();
  if (fEmpty) {
    const vals = allValues.map((v) => String(v ?? ''));
    const nonEmptyTrimmed = vals.map((s) => s.trim()).filter(Boolean);
    const unique = new Set(nonEmptyTrimmed);
    if (unique.size !== 1) return false;
    const pTrim = p.trim();
    for (let j = fieldIndex + 1; j < vals.length; j++) {
      if (vals[j].trim() === pTrim) return false;
    }
    return true;
  }
  if (f === p) return true;
  /* Shrink longer duplicates when primary is the shorter shared prefix (coordinated backspace). */
  if (f.startsWith(p) && p.length < f.length) return true;
  /* Forward typing: field is a prefix of primary. */
  if (p.startsWith(f) && f.length < p.length) return true;
  return false;
}

function mirrorSignatureGroup(
  primary: string,
  mutators: Array<{ read: () => string; write: (v: string) => void }>
): void {
  if (!primary.trim()) return;
  const allValues = mutators.map((m) => m.read());
  mutators.forEach(({ read, write }, fieldIndex) => {
    if (shouldMirrorSignaturePrimary(primary, read(), allValues, fieldIndex)) write(primary);
  });
}

/** Combined enrolment name for mirror read (same logical string as checklist full name / media student name). */
function joinEnrolmentNameRaw(e: EnrolmentFormState): string {
  const g = String(e.givenNames ?? '');
  const f = String(e.familyName ?? '');
  if (!f.trim()) return g;
  if (!g.trim()) return f;
  return `${g} ${f}`;
}

/** Write mirrored full name into enrolment fields (last whitespace-separated token = family name). */
function splitFullNameToEnrolment(primary: string): { givenNames: string; familyName: string } {
  const t = String(primary ?? '').trim();
  if (!t) return { givenNames: '', familyName: '' };
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { givenNames: parts[0], familyName: '' };
  const familyName = parts[parts.length - 1] ?? '';
  const givenNames = parts.slice(0, -1).join(' ');
  return { givenNames, familyName };
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
  mutators.forEach(({ read, write }, fieldIndex) => {
    if (shouldMirrorFromPrimary(primary, read(), allValues, fieldIndex)) write(primary);
  });
}

/**
 * Copy student full name (checklist header ↔ enrolment given+family ↔ CCTV student name), declaration signatures,
 * and declaration dates across the three places each. Uses the same raw-string mirror rules for names as for
 * signatures (backspace / spaces stay aligned). Enrolment stores the split last token as family name.
 * Optional consent block names and consent date are not mirrored.
 */
export function synchronizeInductionDerivedFields(p: InductionFormPayload): InductionFormPayload {
  const next: InductionFormPayload = {
    ...p,
    checklistHeader: { ...p.checklistHeader },
    checklistDeclaration: { ...p.checklistDeclaration },
    enrolment: { ...p.enrolment },
    mediaAck: { ...p.mediaAck },
    mediaConsent: { ...p.mediaConsent },
    loginSetup: { ...mergeLoginSetup(p.loginSetup) },
    documents: mergeInductionDocuments(p.documents),
  };

  /* Mirrored student names (checklist ↔ enrolment given+family ↔ CCTV ack): same raw-string rules as signatures. */
  {
    const nameVals = [
      String(next.checklistHeader.fullName ?? ''),
      joinEnrolmentNameRaw(next.enrolment),
      String(next.mediaAck.studentName ?? ''),
    ];
    const nameTrim = nameVals.map((s) => s.trim());
    const non = nameTrim.filter(Boolean);
    const emptyCount = nameTrim.filter((s) => !s).length;
    if (non.length === 2 && emptyCount === 1 && new Set(non).size === 1) {
      next.checklistHeader = { ...next.checklistHeader, fullName: '' };
      next.enrolment = { ...next.enrolment, givenNames: '', familyName: '' };
      next.mediaAck = { ...next.mediaAck, studentName: '' };
    }
  }

  /* Mirrored student signatures (checklist ↔ enrolment ↔ CCTV): if one field is cleared but two copies still hold
   * the same text, clear all three so backspace behaves like one shared field. */
  {
    const sigs = [
      String(next.checklistDeclaration.signature ?? '').trim(),
      String(next.enrolment.declarationSignature ?? '').trim(),
      String(next.mediaAck.studentSignature ?? '').trim(),
    ];
    const non = sigs.filter(Boolean);
    const emptyCount = sigs.filter((s) => !s).length;
    if (non.length === 2 && emptyCount === 1 && new Set(non).size === 1) {
      next.checklistDeclaration = { ...next.checklistDeclaration, signature: '' };
      next.enrolment = { ...next.enrolment, declarationSignature: '' };
      next.mediaAck = { ...next.mediaAck, studentSignature: '' };
    }
  }

  const namePrimary = pickSignatureMirrorSource([
    next.checklistHeader.fullName,
    joinEnrolmentNameRaw(next.enrolment),
    next.mediaAck.studentName,
  ]);
  mirrorSignatureGroup(namePrimary, [
    { read: () => next.checklistHeader.fullName, write: (v) => { next.checklistHeader.fullName = v; } },
    {
      read: () => joinEnrolmentNameRaw(next.enrolment),
      write: (v) => {
        const s = splitFullNameToEnrolment(v);
        next.enrolment = { ...next.enrolment, givenNames: s.givenNames, familyName: s.familyName };
      },
    },
    { read: () => next.mediaAck.studentName, write: (v) => { next.mediaAck.studentName = v; } },
  ]);

  /* Student signatures only — optional media consent signature may be a different person; do not mirror. */
  const sigPrimary = pickSignatureMirrorSource([
    next.checklistDeclaration.signature,
    next.enrolment.declarationSignature,
    next.mediaAck.studentSignature,
  ]);
  mirrorSignatureGroup(sigPrimary, [
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

export type InductionYesNo = 'yes' | 'no';

export const INDUCTION_DOCUMENT_KEYS = [
  'health_insurance',
  'passport_photo',
  'academic_records',
  'visa_copy',
  'pte_ielts',
] as const;
export type InductionDocumentKey = (typeof INDUCTION_DOCUMENT_KEYS)[number];

export const INDUCTION_DOCUMENT_LABELS: Record<InductionDocumentKey, string> = {
  health_insurance: 'Health insurance',
  passport_photo: 'Passport sized photograph for student ID card',
  academic_records: 'Academic records (previous from grade 10)',
  visa_copy: 'Current visa copy',
  pte_ielts: 'PTE or IELTS score (if given any)',
};

export interface InductionDocumentRowState {
  /** Public URL after optional upload — stored in submission JSON. */
  fileUrl: string;
  fileName: string;
  /** Required: confirm whether this item was submitted (email and/or attachment). */
  submitted: InductionYesNo | '';
}

export interface InductionLoginSetupState {
  outlookLoggedIn: InductionYesNo | '';
  teamsLoggedIn: InductionYesNo | '';
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
  /** Step 1 on instruction sheet — mandatory Yes/No for each app. */
  loginSetup: InductionLoginSetupState;
  /** Step 4 document list — optional file URL; mandatory submitted Yes/No per row. */
  documents: Record<InductionDocumentKey, InductionDocumentRowState>;
}

export function emptyChecklistRow(): ChecklistRowState {
  return { answer: '', initial: '' };
}

function emptyInductionDocuments(): Record<InductionDocumentKey, InductionDocumentRowState> {
  const o = {} as Record<InductionDocumentKey, InductionDocumentRowState>;
  for (const k of INDUCTION_DOCUMENT_KEYS) {
    o[k] = { fileUrl: '', fileName: '', submitted: '' };
  }
  return o;
}

function mergeInductionDocuments(raw: unknown): Record<InductionDocumentKey, InductionDocumentRowState> {
  const base = emptyInductionDocuments();
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  for (const k of INDUCTION_DOCUMENT_KEYS) {
    const row = obj[k];
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const sub = r.submitted;
    base[k] = {
      fileUrl: String(r.fileUrl ?? ''),
      fileName: String(r.fileName ?? ''),
      submitted: sub === 'yes' || sub === 'no' ? sub : '',
    };
  }
  return base;
}

function mergeLoginSetup(raw: unknown): InductionLoginSetupState {
  const empty: InductionLoginSetupState = { outlookLoggedIn: '', teamsLoggedIn: '' };
  if (!raw || typeof raw !== 'object') return empty;
  const o = raw as Record<string, unknown>;
  const out = o.outlookLoggedIn;
  const tm = o.teamsLoggedIn;
  return {
    outlookLoggedIn: out === 'yes' || out === 'no' ? out : '',
    teamsLoggedIn: tm === 'yes' || tm === 'no' ? tm : '',
  };
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
    loginSetup: { outlookLoggedIn: '', teamsLoggedIn: '' },
    documents: emptyInductionDocuments(),
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
  if (!nonEmpty(h.studentId)) return 'Enter your Student ID on the checklist.';
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
  if (!nonEmpty(e.givenNames)) return 'Enter given name(s) on the enrolment form.';
  /* Single-token legal names may leave family name empty; multi-word given without family still invalid. */
  if (!nonEmpty(e.familyName) && /\s/.test(String(e.givenNames).trim())) {
    return 'Enter family name on the enrolment form.';
  }
  if (!nonEmptyIsoDate(e.dateOfBirth)) return 'Choose a valid date of birth on the enrolment form.';
  if (e.gender !== 'male' && e.gender !== 'female') return 'Select gender on the enrolment form.';
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

  const ls = p.loginSetup;
  if (ls.outlookLoggedIn !== 'yes' && ls.outlookLoggedIn !== 'no') {
    return 'Under Step 1 (Login setup), select Yes or No for Microsoft Outlook.';
  }
  if (ls.teamsLoggedIn !== 'yes' && ls.teamsLoggedIn !== 'no') {
    return 'Under Step 1 (Login setup), select Yes or No for Microsoft Teams.';
  }

  for (const k of INDUCTION_DOCUMENT_KEYS) {
    const row = p.documents[k];
    if (!row || (row.submitted !== 'yes' && row.submitted !== 'no')) {
      return `Under Step 4 (Submit documents), select Yes or No for: ${INDUCTION_DOCUMENT_LABELS[k]}.`;
    }
  }

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
      loginSetup: mergeLoginSetup(o.loginSetup),
      documents: mergeInductionDocuments(o.documents),
    };
    return normalizePayloadDates(merged);
  } catch {
    return null;
  }
}
