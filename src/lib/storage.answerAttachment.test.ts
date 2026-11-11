import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploaded: Array<{ bucket: string; path: string; contentType?: string }> = [];
const removed: string[][] = [];

vi.mock('./supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        upload: vi.fn(async (path: string, _file: File, opts: { contentType?: string }) => {
          uploaded.push({ bucket, path, contentType: opts?.contentType });
          return { error: null };
        }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
        remove: vi.fn(async (paths: string[]) => {
          removed.push(paths);
          return { error: null };
        }),
      }),
    },
  },
}));

import { deleteAnswerImageByPublicUrl, uploadAnswerImage } from './storage';
import { ANSWERABLE_TYPES } from './answerAttachment.fixtures';

describe('answer attachment storage — same bucket/path for every question type', () => {
  beforeEach(() => {
    uploaded.length = 0;
    removed.length = 0;
  });

  it.each(ANSWERABLE_TYPES.map((t, i) => [t, 300 + i] as const))(
    '%s (question %i): file is stored under photomedia/skyline/answers/{instance}/{question}/',
    async (_type, questionId) => {
      const file = new File([new Uint8Array([137, 80, 78, 71])], 'evidence photo.png', { type: 'image/png' });
      const res = await uploadAnswerImage(900, questionId, file);
      expect(res.error).toBeNull();
      expect(uploaded).toHaveLength(1);
      expect(uploaded[0].bucket).toBe('photomedia');
      expect(uploaded[0].path).toMatch(new RegExp(`^skyline/answers/900/${questionId}/evidence_photo_\\d+\\.png$`));
      expect(uploaded[0].contentType).toBe('image/png');
      expect(res.url).toBe(`https://example.supabase.co/storage/v1/object/public/photomedia/${uploaded[0].path}`);

      // Removing the attachment deletes exactly that object.
      const del = await deleteAnswerImageByPublicUrl(res.url!);
      expect(del.success).toBe(true);
      expect(removed).toEqual([[uploaded[0].path]]);
    }
  );
});
