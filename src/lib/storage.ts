import { supabase } from './supabase';

const BUCKET = 'photomedia';
const FOLDER = 'skyline';

export interface UploadResult {
  url: string | null;
  error: string | null;
}

/** HEIC/HEIF (Apple) images are not displayable in PDF/browsers. Convert to JPEG before upload. */
async function ensurePdfCompatibleImage(file: File): Promise<File> {
  const heicTypes = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'];
  const isHeic =
    (file.type && heicTypes.includes(file.type.toLowerCase())) ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name);
  if (!isHeic) return file;

  try {
    const heic2any = (await import('heic2any')).default;
    const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(result) ? result[0] : result;
    const baseName = file.name.replace(/\.[^.]+$/, '');
    return new File([blob as Blob], `${baseName}.jpg`, { type: 'image/jpeg' });
  } catch (err) {
    console.warn('HEIC conversion failed, uploading original:', err);
    return file;
  }
}

/**
 * Upload form cover image to photomedia/skyline/{formId}_{filename}
 * Returns the public URL of the uploaded file.
 */
export async function uploadFormCoverImage(
  formId: number,
  file: File
): Promise<UploadResult> {
  const toUpload = await ensurePdfCompatibleImage(file);
  const ext = toUpload.name.split('.').pop() || 'jpg';
  const sanitizedName = file.name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 50);
  // Unique path to avoid upsert (UPDATE can trigger 42P17 with some policies)
  const path = `${FOLDER}/${formId}_${sanitizedName}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, toUpload, {
    upsert: false,
    contentType: toUpload.type,
  });

  if (error) {
    console.error('uploadFormCoverImage error', error);
    return { url: null, error: error.message };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

/**
 * Upload row image to photomedia/skyline/{formId}/rows/{rowId}_{timestamp}.{ext}
 * Stores the image in a folder structure by form ID and row ID.
 * Returns the public URL of the uploaded file.
 */
export async function uploadRowImage(
  formId: number,
  questionId: number,
  rowId: number,
  file: File
): Promise<UploadResult> {
  const toUpload = await ensurePdfCompatibleImage(file);
  const ext = toUpload.name.split('.').pop() || 'jpg';
  const path = `${FOLDER}/${formId}/questions/${questionId}/rows/${rowId}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, toUpload, {
    upsert: false,
    contentType: toUpload.type,
  });

  if (error) {
    console.error('uploadRowImage error', error);
    return { url: null, error: error.message };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

/**
 * Upload question image to photomedia/skyline/{questionId}/{timestamp}_{filename}.{ext}
 * Used for images embedded in questions (e.g. hierarchy diagrams, risk matrices).
 * Returns the public URL of the uploaded file.
 */
export async function uploadQuestionImage(
  questionId: number,
  file: File
): Promise<UploadResult> {
  const toUpload = await ensurePdfCompatibleImage(file);
  const ext = toUpload.name.split('.').pop() || 'jpg';
  const sanitizedName = toUpload.name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);
  const path = `${FOLDER}/${questionId}/${sanitizedName}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, toUpload, {
    upsert: false,
    contentType: toUpload.type,
  });

  if (error) {
    console.error('uploadQuestionImage error', error);
    return { url: null, error: error.message };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

/**
 * Upload instruction block image.
 * Used by Task Instructions (task row) and Additional Instructions (section).
 */
export async function uploadInstructionImage(
  scope: 'task_row' | 'section',
  id: number,
  file: File
): Promise<UploadResult> {
  const toUpload = await ensurePdfCompatibleImage(file);
  const ext = toUpload.name.split('.').pop() || 'jpg';
  const sanitizedName = toUpload.name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);
  const safeScope = scope === 'section' ? 'section' : 'task_row';
  const safeId = Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
  const path = `${FOLDER}/instructions/${safeScope}/${safeId}/${sanitizedName}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, toUpload, {
    upsert: false,
    contentType: toUpload.type,
  });

  if (error) {
    console.error('uploadInstructionImage error', error);
    return { url: null, error: error.message };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

/** Optional induction document — one object per `docKey` under `skyline/induction/{inductionId}/` (replaces previous upload). */
export async function uploadInductionDocument(
  inductionId: number,
  docKey: string,
  file: File
): Promise<UploadResult> {
  const toUpload = await ensurePdfCompatibleImage(file);
  const id = Number.isFinite(inductionId) && inductionId > 0 ? Math.floor(inductionId) : 0;
  const safeKey = String(docKey).replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
  /* Stable path (no timestamp) so re-upload replaces; no extension in key so PDF ↔ image swap does not leave two objects. */
  const path = `${FOLDER}/induction/${id}/${safeKey}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, toUpload, {
    upsert: true,
    contentType: toUpload.type || 'application/octet-stream',
  });

  if (error) {
    console.error('uploadInductionDocument error', error);
    return { url: null, error: error.message };
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

/**
 * Upload image answer for a form instance question.
 * Path: photomedia/skyline/answers/{instanceId}/{questionId}/{timestamp}_{filename}.{ext}
 */
export async function uploadAnswerImage(
  instanceId: number,
  questionId: number,
  file: File
): Promise<UploadResult> {
  const toUpload = await ensurePdfCompatibleImage(file);
  const ext = toUpload.name.split('.').pop() || 'jpg';
  const sanitizedName = toUpload.name
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9-_]/g, '_')
    .slice(0, 40);
  const iid = Number.isFinite(instanceId) && instanceId > 0 ? Math.floor(instanceId) : 0;
  const qid = Number.isFinite(questionId) && questionId > 0 ? Math.floor(questionId) : 0;
  const path = `${FOLDER}/answers/${iid}/${qid}/${sanitizedName}_${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, toUpload, {
    upsert: false,
    contentType: toUpload.type,
  });
  if (error) {
    console.error('uploadAnswerImage error', error);
    return { url: null, error: error.message };
  }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

function extractBucketPathFromPublicUrl(publicUrl: string): string | null {
  const raw = String(publicUrl ?? '').trim();
  if (!raw) return null;

  // If someone stored a bare bucket path already, accept it.
  if (raw.startsWith(`${FOLDER}/`)) return raw;

  // Supabase public URL format typically includes: /storage/v1/object/public/{bucket}/{path}
  // Signed URLs might include query params; always extract from pathname only.
  let pathname = raw;
  try {
    const u = new URL(raw);
    pathname = u.pathname || raw;
  } catch {
    // Not a full URL; keep as-is.
    pathname = raw;
  }

  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = pathname.indexOf(marker);
  if (idx < 0) return null;
  const path = pathname.slice(idx + marker.length);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** Delete an uploaded answer image by its public URL (best-effort). */
export async function deleteAnswerImageByPublicUrl(publicUrl: string): Promise<{ success: boolean; error?: string }> {
  const path = extractBucketPathFromPublicUrl(publicUrl);
  if (!path) return { success: false, error: 'Invalid image URL (cannot derive storage path).' };
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error('deleteAnswerImageByPublicUrl error', error);
    return { success: false, error: error.message };
  }
  return { success: true };
}
