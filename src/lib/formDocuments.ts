import { supabase } from './supabase';

// Project uses a single media bucket (photomedia/skyline/...). Learning materials live under:
// photomedia/Learning/<formname-id>/<filename>
export const LEARNING_BUCKET = 'photomedia';
const LEARNING_ROOT = 'Learning';

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

export async function listLearningDocs(input: { formId: number; formName?: string | null }): Promise<LearningDoc[]> {
  const folder = getLearningFolder(input);
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

export async function uploadLearningDoc(input: {
  formId: number;
  formName?: string | null;
  file: File;
  upsert?: boolean;
}): Promise<void> {
  const folder = getLearningFolder(input);
  const safeName = String(input.file.name || 'document').replace(/[\/\\]+/g, '_');
  const path = `${folder}/${safeName}`;
  const { error } = await supabase.storage.from(LEARNING_BUCKET).upload(path, input.file, {
    upsert: Boolean(input.upsert ?? true),
    contentType: input.file.type || undefined,
  });
  if (error) throw error;
}

export async function deleteLearningDoc(path: string): Promise<void> {
  const p = String(path ?? '').trim();
  if (!p) return;
  const { error } = await supabase.storage.from(LEARNING_BUCKET).remove([p]);
  if (error) throw error;
}

export function getLearningDocPublicUrl(path: string): string {
  const { data } = supabase.storage.from(LEARNING_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

