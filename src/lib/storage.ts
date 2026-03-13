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
