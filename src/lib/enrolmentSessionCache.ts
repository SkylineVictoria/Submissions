import { ENROLMENT_DRAFT_STORAGE_KEY } from '../constants/enrolmentOptions';
import { mergeEnrolmentPayload } from './enrolmentDefaults';
import type { EnrolmentFileRef, EnrolmentFormValues } from '../types/enrolment';

export const ENROLMENT_SESSION_CACHE_KEY = 'signflow.enrolment.session';
export const ENROLMENT_SUBMITTED_CACHE_KEY = 'signflow.enrolment.submitted';

/** Snapshot after submit — thank-you page messaging (not stored in DB). */
export interface EnrolmentSubmittedCache {
  applicationId: string;
  applicationNo: string | null;
  values: EnrolmentFormValues;
  fileRefs: EnrolmentFileRef[];
  courseLabels: string[];
  emailDeliveryNote?: string | null;
}

export interface EnrolmentSessionCache {
  applicationId: string | null;
  values: EnrolmentFormValues;
  fileRefs: EnrolmentFileRef[];
  updatedAt: number;
}

function canUseSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function readEnrolmentSession(): EnrolmentSessionCache | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(ENROLMENT_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EnrolmentSessionCache>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      applicationId: typeof parsed.applicationId === 'string' ? parsed.applicationId : null,
      values: mergeEnrolmentPayload(parsed.values),
      fileRefs: Array.isArray(parsed.fileRefs) ? parsed.fileRefs : [],
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function writeEnrolmentSession(cache: EnrolmentSessionCache): void {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(ENROLMENT_SESSION_CACHE_KEY, JSON.stringify(cache));
    if (cache.applicationId) {
      sessionStorage.setItem(ENROLMENT_DRAFT_STORAGE_KEY, cache.applicationId);
    }
  } catch {
    /* quota / private mode */
  }
}

export function clearEnrolmentSession(): void {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.removeItem(ENROLMENT_SESSION_CACHE_KEY);
    sessionStorage.removeItem(ENROLMENT_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(ENROLMENT_DRAFT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function writeEnrolmentSubmitted(cache: EnrolmentSubmittedCache): void {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(ENROLMENT_SUBMITTED_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export function readEnrolmentSubmitted(): EnrolmentSubmittedCache | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(ENROLMENT_SUBMITTED_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EnrolmentSubmittedCache>;
    if (!parsed?.applicationId || !parsed.values || typeof parsed.values !== 'object') return null;
    return {
      applicationId: parsed.applicationId,
      applicationNo: parsed.applicationNo ?? null,
      values: mergeEnrolmentPayload(parsed.values),
      fileRefs: Array.isArray(parsed.fileRefs) ? parsed.fileRefs : [],
      courseLabels: Array.isArray(parsed.courseLabels) ? parsed.courseLabels : [],
      emailDeliveryNote:
        typeof parsed.emailDeliveryNote === 'string' ? parsed.emailDeliveryNote : null,
    };
  } catch {
    return null;
  }
}

export function clearEnrolmentSubmitted(): void {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.removeItem(ENROLMENT_SUBMITTED_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** Legacy localStorage application id (migrate once into session). */
export function readLegacyApplicationId(): string | null {
  try {
    return sessionStorage.getItem(ENROLMENT_DRAFT_STORAGE_KEY) || localStorage.getItem(ENROLMENT_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function enrolmentSessionHasMeaningfulData(values: EnrolmentFormValues): boolean {
  return Boolean(
    values.personal.firstName.trim() ||
      values.personal.lastName.trim() ||
      values.personal.email.trim() ||
      values.personal.mobile.trim()
  );
}
