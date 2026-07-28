/**
 * Pure helpers for duplicating form-builder questions without shared object identity.
 *
 * Root cause of label/config cross-talk after Duplicate:
 * - shallow spreads of pdf_meta / role_* left nested object references shared
 * - post-insert UI sometimes re-attached the source pdf_meta shallow copy onto the new row
 */

export type CloneableQuestionFields = {
  id?: number;
  type: string;
  code?: string | null;
  label?: string | null;
  help_text?: string | null;
  required?: boolean | null;
  sort_order?: number | null;
  role_visibility?: unknown;
  role_editability?: unknown;
  pdf_meta?: unknown;
};

/** Deep-clone JSON-compatible values; falls back when structuredClone is unavailable. */
export function deepCloneJson<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch {
      // Fall through for non-cloneable values.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildDuplicatedQuestionLabel(label: string | null | undefined, type: string): string {
  const base = String(label || type || 'Question').replace(/\s*\(Copy\)\s*$/i, '').trim();
  return `${base || 'Question'} (Copy)`;
}

/**
 * Build an insert payload for a duplicated question.
 * - Never copies the source primary key
 * - Deep-clones nested JSON so later edits cannot mutate the source
 * - Optionally clears contentBlocks.questionId so callers can rewire after cloning children
 */
export function buildQuestionDuplicateInsertPayload(
  source: CloneableQuestionFields,
  args: {
    sectionId: number;
    sortOrder: number;
    clearContentBlockQuestionIds?: boolean;
    clearCode?: boolean;
  }
): Record<string, unknown> {
  const pdfMeta = deepCloneJson((source.pdf_meta ?? {}) as Record<string, unknown>);
  if (args.clearContentBlockQuestionIds !== false && Array.isArray(pdfMeta.contentBlocks)) {
    pdfMeta.contentBlocks = (pdfMeta.contentBlocks as Array<Record<string, unknown>>).map((block) => {
      const next = { ...block };
      delete next.questionId;
      return next;
    });
  }

  return {
    section_id: args.sectionId,
    type: source.type,
    code: args.clearCode ? null : source.code ?? null,
    label: buildDuplicatedQuestionLabel(source.label, source.type),
    help_text: source.help_text ?? null,
    required: source.required ?? false,
    sort_order: args.sortOrder,
    role_visibility: deepCloneJson(source.role_visibility ?? {}),
    role_editability: deepCloneJson(source.role_editability ?? {}),
    pdf_meta: pdfMeta,
  };
}

/** Apply a field patch to one question in a list; all other questions keep identity. */
export function applyQuestionFieldUpdate<T extends { id: number }>(
  questions: T[],
  questionId: number,
  updates: Partial<T>
): T[] {
  return questions.map((q) => {
    if (q.id !== questionId) return q;
    const nextUpdates = { ...updates } as Partial<T> & { pdf_meta?: unknown };
    if ('pdf_meta' in nextUpdates && nextUpdates.pdf_meta != null) {
      nextUpdates.pdf_meta = deepCloneJson(nextUpdates.pdf_meta);
    }
    if ('role_visibility' in nextUpdates && (nextUpdates as { role_visibility?: unknown }).role_visibility != null) {
      (nextUpdates as { role_visibility: unknown }).role_visibility = deepCloneJson(
        (nextUpdates as { role_visibility: unknown }).role_visibility
      );
    }
    if ('role_editability' in nextUpdates && (nextUpdates as { role_editability?: unknown }).role_editability != null) {
      (nextUpdates as { role_editability: unknown }).role_editability = deepCloneJson(
        (nextUpdates as { role_editability: unknown }).role_editability
      );
    }
    return { ...q, ...nextUpdates };
  });
}

/**
 * Assert original/duplicate are independent after a label edit simulation.
 * Used by regression tests.
 */
export function simulateDuplicateThenEditLabel(
  original: CloneableQuestionFields & { id: number },
  duplicateId: number
): { originalLabel: string; duplicateLabel: string; sharedPdfMetaRef: boolean } {
  const insertPayload = buildQuestionDuplicateInsertPayload(original, {
    sectionId: 1,
    sortOrder: (original.sort_order ?? 0) + 1,
  });
  const duplicate = {
    id: duplicateId,
    type: String(insertPayload.type),
    label: String(insertPayload.label),
    help_text: insertPayload.help_text as string | null,
    required: Boolean(insertPayload.required),
    pdf_meta: insertPayload.pdf_meta,
    role_visibility: insertPayload.role_visibility,
    role_editability: insertPayload.role_editability,
  };

  let questions = [original, duplicate] as Array<CloneableQuestionFields & { id: number }>;
  questions = applyQuestionFieldUpdate(questions, duplicateId, {
    label: 'Where do you live?',
  } as Partial<CloneableQuestionFields & { id: number }>);

  const orig = questions.find((q) => q.id === original.id)!;
  const dup = questions.find((q) => q.id === duplicateId)!;

  return {
    originalLabel: String(orig.label ?? ''),
    duplicateLabel: String(dup.label ?? ''),
    sharedPdfMetaRef: orig.pdf_meta != null && orig.pdf_meta === dup.pdf_meta,
  };
}
