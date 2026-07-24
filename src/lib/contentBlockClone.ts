/**
 * Content-block (isAdditionalBlockOf) identity helpers.
 *
 * Child grid/text blocks must have UNIQUE question IDs. Multiple parents must never
 * share the same contentBlocks[].questionId — that causes answer cross-talk.
 */

export type ContentBlockLike = {
  type?: string;
  questionId?: number;
  [key: string]: unknown;
};

export type PdfMetaLike = {
  isAdditionalBlockOf?: number;
  contentBlocks?: ContentBlockLike[];
  [key: string]: unknown;
};

/** Remap question id references inside pdf_meta after cloning questions. */
export function remapPdfMetaQuestionIds(
  pdfMeta: unknown,
  idMap: Map<number, number> | Record<number, number>
): PdfMetaLike | null {
  if (!pdfMeta || typeof pdfMeta !== 'object' || Array.isArray(pdfMeta)) return null;
  const get = (id: number): number | undefined =>
    idMap instanceof Map ? idMap.get(id) : idMap[id];

  const pm = { ...(pdfMeta as PdfMetaLike) };
  let changed = false;

  if (typeof pm.isAdditionalBlockOf === 'number') {
    const mapped = get(pm.isAdditionalBlockOf);
    if (mapped != null && mapped !== pm.isAdditionalBlockOf) {
      pm.isAdditionalBlockOf = mapped;
      changed = true;
    }
  }

  if (Array.isArray(pm.contentBlocks)) {
    const nextBlocks = pm.contentBlocks.map((block) => {
      if (!block || typeof block !== 'object') return block;
      const b = { ...block };
      if (typeof b.questionId === 'number') {
        const mapped = get(b.questionId);
        if (mapped != null && mapped !== b.questionId) {
          b.questionId = mapped;
          changed = true;
        }
      }
      return b;
    });
    if (changed) pm.contentBlocks = nextBlocks;
  }

  return changed ? pm : null;
}

/**
 * Find content-block questionIds that are referenced by more than one parent.
 * Returns Map<sharedChildQuestionId, parentQuestionIds[]>.
 */
export function findSharedContentBlockQuestionIds(
  questions: Array<{ id: number; pdf_meta?: unknown }>
): Map<number, number[]> {
  const childToParents = new Map<number, number[]>();
  for (const q of questions) {
    const pm = q.pdf_meta as PdfMetaLike | null | undefined;
    const blocks = Array.isArray(pm?.contentBlocks) ? pm!.contentBlocks! : [];
    for (const block of blocks) {
      const cid = Number(block?.questionId);
      if (!Number.isFinite(cid) || cid <= 0) continue;
      const list = childToParents.get(cid) ?? [];
      if (!list.includes(q.id)) list.push(q.id);
      childToParents.set(cid, list);
    }
  }
  const shared = new Map<number, number[]>();
  for (const [childId, parents] of childToParents) {
    if (parents.length > 1) shared.set(childId, parents);
  }
  return shared;
}

/**
 * Decide which parent "owns" a shared child (isAdditionalBlockOf match), and which
 * parents need a private clone of that child.
 */
export function planSharedContentBlockRepairs(
  questions: Array<{ id: number; pdf_meta?: unknown }>,
  shared: Map<number, number[]>
): Array<{
  sharedChildId: number;
  ownerParentId: number | null;
  parentsNeedingClone: number[];
}> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const plans: Array<{
    sharedChildId: number;
    ownerParentId: number | null;
    parentsNeedingClone: number[];
  }> = [];

  for (const [childId, parentIds] of shared) {
    const child = byId.get(childId);
    const childPm = child?.pdf_meta as PdfMetaLike | null | undefined;
    const declaredOwner =
      typeof childPm?.isAdditionalBlockOf === 'number' ? childPm.isAdditionalBlockOf : null;
    const ownerParentId =
      declaredOwner != null && parentIds.includes(declaredOwner) ? declaredOwner : parentIds[0] ?? null;
    const parentsNeedingClone = parentIds.filter((pid) => pid !== ownerParentId);
    if (parentsNeedingClone.length > 0) {
      plans.push({ sharedChildId: childId, ownerParentId, parentsNeedingClone });
    }
  }
  return plans;
}

/**
 * Read-only diagnostic table for content-block child usage:
 * Parent | Block | Child Question | Usage Count | Row IDs
 */
export function buildContentBlockGridDiagnostic(
  questions: Array<{
    id: number;
    label?: string | null;
    sort_order?: number;
    pdf_meta?: unknown;
    rows?: Array<{ id: number }>;
  }>
): Array<{
  parentQuestionId: number;
  parentLabel: string;
  blockIndex: number;
  childQuestionId: number;
  usageCount: number;
  rowIds: number[];
}> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const usage = new Map<number, number>();
  for (const q of questions) {
    const pm = q.pdf_meta as PdfMetaLike | null | undefined;
    const blocks = Array.isArray(pm?.contentBlocks) ? pm!.contentBlocks! : [];
    for (const block of blocks) {
      const cid = Number(block?.questionId);
      if (!Number.isFinite(cid) || cid <= 0) continue;
      usage.set(cid, (usage.get(cid) ?? 0) + 1);
    }
  }
  const rows: Array<{
    parentQuestionId: number;
    parentLabel: string;
    blockIndex: number;
    childQuestionId: number;
    usageCount: number;
    rowIds: number[];
  }> = [];
  for (const q of questions) {
    const pm = q.pdf_meta as PdfMetaLike | null | undefined;
    const blocks = Array.isArray(pm?.contentBlocks) ? pm!.contentBlocks! : [];
    blocks.forEach((block, blockIndex) => {
      const cid = Number(block?.questionId);
      if (!Number.isFinite(cid) || cid <= 0) return;
      const child = byId.get(cid);
      rows.push({
        parentQuestionId: q.id,
        parentLabel: String(q.label ?? '').slice(0, 80),
        blockIndex,
        childQuestionId: cid,
        usageCount: usage.get(cid) ?? 0,
        rowIds: (child?.rows ?? []).map((r) => r.id),
      });
    });
  }
  return rows.sort(
    (a, b) =>
      b.usageCount - a.usageCount ||
      a.childQuestionId - b.childQuestionId ||
      a.parentQuestionId - b.parentQuestionId
  );
}
