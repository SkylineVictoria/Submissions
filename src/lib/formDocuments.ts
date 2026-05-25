import JSZip from 'jszip';
import { supabase } from './supabase';
import { fetchForm, updateForm, getEffectiveStoredUser } from './formEngine';

// Project uses a single media bucket (photomedia/skyline/...). Learning materials live under:
// photomedia/Learning/<formname-id>/<filename>  — student-facing (also legacy uploads)
// photomedia/Learning/<formname-id>/trainer/<filename>  — trainers/assessors only (not listed to students)
export const LEARNING_BUCKET = 'photomedia';
const LEARNING_ROOT = 'Learning';
/** Folder name under each form folder; excluded from student document listing. */
export const TRAINER_LEARNING_SEGMENT = 'trainer';

export type LearningAudience = 'student' | 'trainer';

function slugify(input: string): string {
  const s = String(input ?? '').trim().toLowerCase();
  const cleaned = s
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'form';
}

export function getLearningFolder(input: { formId: number; formName?: string | null }): string {
  const id = Number(input.formId);
  const name = slugify(String(input.formName ?? 'form'));
  // Uniqueness: name + id.
  return `${LEARNING_ROOT}/${name}-${id}`;
}

export type LearningDoc = {
  name: string;
  path: string;
  updatedAt: string | null;
  size: number | null;
};

async function mapListToDocs(folder: string): Promise<LearningDoc[]> {
  const { data, error } = await supabase.storage.from(LEARNING_BUCKET).list(folder, {
    limit: 200,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;
  const rows = (data ?? []).filter((x) => x && x.name && x.name !== '.emptyFolderPlaceholder');
  return rows.map((x) => ({
    name: x.name,
    path: `${folder}/${x.name}`,
    updatedAt: (x.updated_at as string | null) ?? null,
    size: (x.metadata as { size?: number } | null)?.size ?? null,
  }));
}

export async function listLearningDocs(input: {
  formId: number;
  formName?: string | null;
  audience: LearningAudience;
}): Promise<LearningDoc[]> {
  const base = getLearningFolder(input);
  if (input.audience === 'trainer') {
    return mapListToDocs(`${base}/${TRAINER_LEARNING_SEGMENT}`);
  }
  // Student: files directly under the form folder (legacy + current), but not the trainer subfolder.
  const { data, error } = await supabase.storage.from(LEARNING_BUCKET).list(base, {
    limit: 200,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  });
  if (error) throw error;
  const rows = (data ?? []).filter(
    (x) =>
      x &&
      x.name &&
      x.name !== '.emptyFolderPlaceholder' &&
      x.name !== TRAINER_LEARNING_SEGMENT
  );
  return rows.map((x) => ({
    name: x.name,
    path: `${base}/${x.name}`,
    updatedAt: (x.updated_at as string | null) ?? null,
    size: (x.metadata as { size?: number } | null)?.size ?? null,
  }));
}

export async function uploadLearningDoc(input: {
  formId: number;
  formName?: string | null;
  file: File;
  upsert?: boolean;
  audience?: LearningAudience;
}): Promise<void> {
  const base = getLearningFolder(input);
  const audience = input.audience ?? 'student';
  const dir = audience === 'trainer' ? `${base}/${TRAINER_LEARNING_SEGMENT}` : base;
  const safeName = String(input.file.name || 'document').replace(/[\/\\]+/g, '_');
  const path = `${dir}/${safeName}`;
  const { error } = await supabase.storage.from(LEARNING_BUCKET).upload(path, input.file, {
    upsert: Boolean(input.upsert ?? true),
    contentType: input.file.type || undefined,
  });
  if (error) throw error;

  const publicUrl = getLearningDocPublicUrl(path);
  if (audience === 'student') {
    await appendLearningMaterialUrl(input.formId, publicUrl);
  }
  void logDocActivity(input.formId, 'upload', { filePath: path, fileName: safeName, publicUrl, audience });
}

export async function deleteLearningDoc(path: string, formId?: number): Promise<void> {
  const p = String(path ?? '').trim();
  if (!p) return;
  const fileName = p.split('/').pop() ?? p;
  const isTrainer = p.includes(`/${TRAINER_LEARNING_SEGMENT}/`);
  const { error } = await supabase.storage.from(LEARNING_BUCKET).remove([p]);
  if (error) throw error;

  const publicUrl = getLearningDocPublicUrl(p);
  if (formId != null && !isTrainer) {
    await removeLearningMaterialUrl(formId, publicUrl);
  }
  if (formId != null) {
    void logDocActivity(formId, 'delete', { filePath: p, fileName, publicUrl, audience: isTrainer ? 'trainer' : 'student' });
  }
}

export function getLearningDocPublicUrl(path: string): string {
  const { data } = supabase.storage.from(LEARNING_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function downloadLearningDocBlob(storagePath: string): Promise<Blob> {
  const p = String(storagePath ?? '').trim();
  if (!p) throw new Error('Missing storage path');
  const { data, error } = await supabase.storage.from(LEARNING_BUCKET).download(p);
  if (error) throw error;
  return data;
}

/** Paths inside the zip: `student/…` vs `trainer/…` so filenames never collide across sections. */
export function zipEntryNameForLearningDoc(doc: LearningDoc): string {
  const isTrainer = doc.path.includes(`/${TRAINER_LEARNING_SEGMENT}/`);
  const prefix = isTrainer ? 'trainer' : 'student';
  const safe = doc.name.replace(/[/\\]+/g, '_');
  return `${prefix}/${safe}`;
}

function slugForZipDownloadBase(name: string): string {
  const s = String(name ?? 'documents')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return s || 'documents';
}

/** Builds a zip from storage using the authenticated client (works when the bucket is not public). */
export async function zipAndDownloadLearningDocs(docs: LearningDoc[], zipBaseName: string): Promise<void> {
  if (docs.length === 0) return;
  const zip = new JSZip();
  const used = new Set<string>();
  for (const doc of docs) {
    const blob = await downloadLearningDocBlob(doc.path);
    let entry = zipEntryNameForLearningDoc(doc);
    let n = 2;
    while (used.has(entry)) {
      const base = doc.name.replace(/[/\\]+/g, '_');
      const dot = base.lastIndexOf('.');
      const stem = dot > 0 ? base.slice(0, dot) : base;
      const ext = dot > 0 ? base.slice(dot) : '';
      const prefix = entry.startsWith('trainer/') ? 'trainer' : 'student';
      entry = `${prefix}/${stem}-${n}${ext}`;
      n++;
    }
    used.add(entry);
    zip.file(entry, blob);
  }
  const out = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(out);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugForZipDownloadBase(zipBaseName)}-documents.zip`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function appendLearningMaterialUrl(formId: number, url: string): Promise<void> {
  try {
    const form = await fetchForm(formId, { allowInactiveForAdmin: true });
    if (!form) return;
    const existing = form.learning_material_urls ?? [];
    if (existing.includes(url)) return;
    await updateForm(formId, { learning_material_urls: [...existing, url] });
  } catch {
    // Best-effort; upload already succeeded so don't throw
  }
}

async function removeLearningMaterialUrl(formId: number, url: string): Promise<void> {
  try {
    const form = await fetchForm(formId, { allowInactiveForAdmin: true });
    if (!form) return;
    const existing = form.learning_material_urls ?? [];
    const next = existing.filter((u) => u !== url);
    if (next.length === existing.length) return;
    await updateForm(formId, { learning_material_urls: next });
  } catch {
    // Best-effort; delete already succeeded so don't throw
  }
}

export async function logDocActivity(
  formId: number,
  action: 'upload' | 'delete' | 'add_url' | 'remove_url',
  details: { filePath?: string; fileName?: string; publicUrl?: string; audience?: LearningAudience }
): Promise<void> {
  try {
    const user = getEffectiveStoredUser();
    await supabase.from('skyline_learning_doc_activity').insert({
      form_id: formId,
      action,
      file_path: details.filePath ?? null,
      file_name: details.fileName ?? null,
      public_url: details.publicUrl ?? null,
      audience: details.audience ?? null,
      performed_by: user?.id ?? null,
      performed_by_name: user?.full_name ?? user?.email ?? null,
    });
  } catch {
    // Best-effort logging; don't break the main operation
  }
}
