import { ALLOWED_FILE_TYPES, FILE_SIZE_LIMITS } from '../constants/enrolmentOptions';
import { supabase } from './supabase';
import type { EnrolmentFileRef } from '../types/enrolment';

const BUCKET = 'student-enrolment-documents';
const PHOTOMEDIA_BUCKET = 'photomedia';
const ADMISSIONS_PREFIX = 'admissions/student-enrolments';

export function validateEnrolmentFile(
  file: File,
  maxBytes: number
): string | null {
  const mime = (file.type || '').toLowerCase();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const okMime =
    ALLOWED_FILE_TYPES.includes(mime) ||
    ['jpg', 'jpeg', 'png', 'gif', 'pdf'].includes(ext);
  if (!okMime) return 'Allowed file types: jpg, jpeg, png, gif, pdf';
  if (file.size > maxBytes) {
    return `File must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller`;
  }
  return null;
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

/** `fullPath` is stored as `bucket/object/path` (see uploadEnrolmentDocument). */
export function parseEnrolmentStoragePath(fullPath: string): { bucket: string; objectPath: string } | null {
  const trimmed = fullPath.trim();
  const slash = trimmed.indexOf('/');
  if (slash <= 0) return null;
  return { bucket: trimmed.slice(0, slash), objectPath: trimmed.slice(slash + 1) };
}

/** Best-effort delete when replacing an attachment (avoids orphaned duplicates in storage). */
export async function removeEnrolmentStorageObject(fullPath: string): Promise<void> {
  const parsed = parseEnrolmentStoragePath(fullPath);
  if (!parsed) return;
  const { error } = await supabase.storage.from(parsed.bucket).remove([parsed.objectPath]);
  if (error) console.warn('enrolment storage remove failed', fullPath, error.message);
}

async function uploadToBucket(
  bucket: string,
  path: string,
  file: File
): Promise<{ path: string; publicUrl: string; error: string | null }> {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) return { path: '', publicUrl: '', error: error.message };
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl, error: null };
}

/**
 * Upload to student-enrolment-documents; fallback to photomedia/admissions/… if bucket missing.
 */
export async function uploadEnrolmentDocument(
  applicationId: string,
  section: string,
  field: string,
  file: File
): Promise<{ ref: EnrolmentFileRef | null; error: string | null }> {
  const ts = Date.now();
  const fname = `${ts}_${safeName(file.name)}`;
  const primaryPath = `student-enrolments/${applicationId}/${section}/${fname}`;
  const fallbackPath = `${ADMISSIONS_PREFIX}/${applicationId}/${section}/${fname}`;

  // Always use a unique object key per upload (timestamp prefix). Callers replace DB refs and
  // should delete the previous object via removeEnrolmentStorageObject when re-uploading.
  let result = await uploadToBucket(BUCKET, primaryPath, file);
  let storagePath = primaryPath;
  let bucket = BUCKET;

  if (result.error) {
    result = await uploadToBucket(PHOTOMEDIA_BUCKET, fallbackPath, file);
    storagePath = fallbackPath;
    bucket = PHOTOMEDIA_BUCKET;
  }

  if (result.error) return { ref: null, error: result.error };

  return {
    ref: {
      section,
      field,
      path: `${bucket}/${storagePath}`,
      publicUrl: result.publicUrl,
      name: file.name,
      size: file.size,
      mimeType: file.type,
    },
    error: null,
  };
}

export function maxBytesForField(field: string): number {
  if (field === 'passport') return FILE_SIZE_LIMITS.passport;
  return FILE_SIZE_LIMITS.default;
}
