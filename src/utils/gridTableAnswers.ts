/** Helpers for grid_table answers, including legacy question-level text saved before rows existed. */

export type GridAnswersMap = Record<
  string,
  string | number | boolean | Record<string, unknown> | string[] | undefined
>;

export function getGridAnswerKey(questionId: number, rowId: number | null): string {
  if (rowId === null) return `q-${questionId}`;
  return `q-${questionId}-${rowId}`;
}

export type GridQuestionLike = {
  id: number;
  pdf_meta?: unknown;
  rows?: Array<{ id: number }>;
};

type GridColumnType = 'question' | 'answer';

function normalizeGridColumnType(raw: unknown): GridColumnType {
  return String(raw ?? '').trim().toLowerCase() === 'question' ? 'question' : 'answer';
}

export function getGridAnswerColumnIndexes(q: GridQuestionLike): number[] {
  const pm = (q.pdf_meta as Record<string, unknown>) || {};
  const colsMeta = pm.columnsMeta;
  if (Array.isArray(colsMeta) && colsMeta.length > 0) {
    return colsMeta
      .map((entry, idx) => {
        if (!entry || typeof entry !== 'object') return idx;
        const e = entry as Record<string, unknown>;
        return normalizeGridColumnType(e.type) === 'answer' ? idx : -1;
      })
      .filter((idx) => idx >= 0);
  }
  const columns = Array.isArray(pm.columns) ? (pm.columns as unknown[]) : [];
  const types = Array.isArray(pm.columnTypes) ? (pm.columnTypes as unknown[]) : [];
  if (columns.length > 0) {
    return columns
      .map((_, idx) => (normalizeGridColumnType(types[idx]) === 'answer' ? idx : -1))
      .filter((idx) => idx >= 0);
  }
  return [0];
}

/** Text saved at question level (row_id null) before grid rows were added to the template. */
export function getLegacyGridQuestionText(q: GridQuestionLike, answers: GridAnswersMap): string {
  const legacy = answers[getGridAnswerKey(q.id, null)];
  if (legacy == null) return '';
  if (typeof legacy === 'string') return legacy.trim();
  return '';
}

export function rowLevelGridHasContent(q: GridQuestionLike, answers: GridAnswersMap): boolean {
  if (!q.rows?.length) return false;
  for (const r of q.rows) {
    const v = answers[getGridAnswerKey(q.id, r.id)];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (Object.values(v as Record<string, unknown>).some((x) => String(x ?? '').trim())) return true;
    }
  }
  return false;
}

export type ParsedLegacyLine = { left: string; right: string } | { single: string };

/** Split legacy textarea content into lines like "Shovel : Used for mixing…". */
export function parseLegacyGridLines(text: string): ParsedLegacyLine[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*:+\s*(.+)$/);
      if (match) return { left: match[1].trim(), right: match[2].trim() };
      return { single: line };
    });
}

function isToolUseLine(entry: ParsedLegacyLine): entry is { left: string; right: string } {
  return 'left' in entry && 'right' in entry;
}

function isPackedMultilineRow(merged: Record<string, string>, q: GridQuestionLike): boolean {
  if (!q.rows?.length) return false;
  const answerCols = getGridAnswerColumnIndexes(q);
  if (answerCols.length < 2) return false;
  const firstRow = q.rows[0];
  const k0 = `r${firstRow.id}_c${answerCols[0]}`;
  const k1 = `r${firstRow.id}_c${answerCols[1]}`;
  const v0 = String(merged[k0] ?? '');
  const v1 = String(merged[k1] ?? '');
  if (!v0.includes('\n') && !v1.includes('\n')) return false;
  const otherRowsUsed = q.rows.slice(1).some((r) => {
    for (const c of answerCols) {
      if (String(merged[`r${r.id}_c${c}`] ?? '').trim()) return true;
    }
    return false;
  });
  return !otherRowsUsed;
}

/**
 * When a type-2 grid answer was saved as newline-separated lists inside one row's cells
 * (Tool col: "A\\nB\\nC", Use col: "desc1\\ndesc2\\ndesc3"), spread across template rows.
 */
export function expandPackedMultilineGridRows(
  merged: Record<string, string>,
  q: GridQuestionLike
): Record<string, string> {
  if (!q.rows?.length || !isPackedMultilineRow(merged, q)) return merged;

  const answerCols = getGridAnswerColumnIndexes(q);
  const c0 = answerCols[0];
  const c1 = answerCols[1];
  const firstRow = q.rows[0];
  const k0 = `r${firstRow.id}_c${c0}`;
  const k1 = `r${firstRow.id}_c${c1}`;
  const v0 = String(merged[k0] ?? '').trim();
  const v1 = String(merged[k1] ?? '').trim();

  const lines0 = v0.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines1 = v1.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Parallel newline lists → one tool/use pair per row (type-2 table).
  if (lines0.length > 1 && lines1.length > 1 && lines0.length === lines1.length) {
    const out = { ...merged };
    delete out[k0];
    delete out[k1];
    for (let i = 0; i < Math.min(lines0.length, q.rows.length); i++) {
      out[`r${q.rows[i].id}_c${c0}`] = lines0[i];
      out[`r${q.rows[i].id}_c${c1}`] = lines1[i];
    }
    return out;
  }

  // All "Tool : Use" lines in the first column only.
  const combined = lines0.length > 1 ? v0 : v0 || v1;
  const toolUse = parseLegacyGridLines(combined).filter(isToolUseLine);
  if (toolUse.length > 1) {
    const out = { ...merged };
    delete out[k0];
    delete out[k1];
    for (let i = 0; i < Math.min(toolUse.length, q.rows.length); i++) {
      out[`r${q.rows[i].id}_c${c0}`] = toolUse[i].left;
      out[`r${q.rows[i].id}_c${c1}`] = toolUse[i].right;
    }
    return out;
  }

  return merged;
}

/**
 * Convert legacy question-level text into grid cell keys (`r{rowId}_c{col}`).
 * Supports multi-line "Tool : Use" tables and single-line / essay fallbacks.
 */
export function buildGridCellsFromLegacyText(q: GridQuestionLike, legacyText: string): Record<string, string> {
  if (!q.rows?.length || !legacyText.trim()) return {};

  const parsed = parseLegacyGridLines(legacyText);
  if (!parsed.length) return {};

  const answerColIndexes = getGridAnswerColumnIndexes(q);
  const toolUseLines = parsed.filter(isToolUseLine);
  const cells: Record<string, string> = {};

  // Multi-line Tool/Use table (e.g. Q4 tools list) → one row per line, split across answer columns.
  if (toolUseLines.length >= 1 && answerColIndexes.length >= 2) {
    for (let i = 0; i < Math.min(toolUseLines.length, q.rows.length); i++) {
      const row = q.rows[i];
      cells[`r${row.id}_c${answerColIndexes[0]}`] = toolUseLines[i].left;
      cells[`r${row.id}_c${answerColIndexes[1]}`] = toolUseLines[i].right;
    }
    return cells;
  }

  // Question+answer grid: one answer column per row; use the description after ":" when present.
  if (toolUseLines.length >= 1 && answerColIndexes.length === 1) {
    for (let i = 0; i < Math.min(toolUseLines.length, q.rows.length); i++) {
      const row = q.rows[i];
      cells[`r${row.id}_c${answerColIndexes[0]}`] = toolUseLines[i].right;
    }
    return cells;
  }

  // Single essay paragraph on a multi-row grid — show in the first row answer cell for copy/reference on resubmit.
  if (parsed.length === 1 && 'single' in parsed[0] && q.rows.length > 1) {
    const row = q.rows[0];
    const col = answerColIndexes[0] ?? 0;
    cells[`r${row.id}_c${col}`] = parsed[0].single;
    return cells;
  }

  // Single row / single block fallback.
  if (parsed.length === 1 && 'single' in parsed[0]) {
    const row = q.rows[0];
    const col = answerColIndexes[0] ?? 0;
    cells[`r${row.id}_c${col}`] = parsed[0].single;
    return cells;
  }

  return cells;
}

/** Merge per-row grid cells; parse legacy question-level text into proper columns when possible. */
export function mergeGridTableAnswers(q: GridQuestionLike, answers: GridAnswersMap): Record<string, string> {
  const merged: Record<string, string> = {};
  if (q.rows?.length) {
    for (const r of q.rows) {
      const v = answers[getGridAnswerKey(q.id, r.id)];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        Object.assign(merged, v as Record<string, string>);
      }
    }
  }

  const legacyText = getLegacyGridQuestionText(q, answers);
  const hasRowCells = Object.keys(merged).some((k) => String(merged[k] ?? '').trim());
  const packedInFirstRow = hasRowCells && isPackedMultilineRow(merged, q);

  // Legacy textarea (newline "Tool : Use" lines) → type-2 table cells, not one paragraph/cell.
  if (legacyText && q.rows?.length && (!hasRowCells || packedInFirstRow)) {
    Object.assign(merged, buildGridCellsFromLegacyText(q, legacyText));
  }

  return expandPackedMultilineGridRows(merged, q);
}

export function legacyGridQuestionHasContent(q: GridQuestionLike, answers: GridAnswersMap): boolean {
  return getLegacyGridQuestionText(q, answers).length > 0;
}

/** Legacy counts as answered only when it parses into grid rows (not a single essay paragraph). */
export function legacyGridCountsAsFilled(q: GridQuestionLike, answers: GridAnswersMap): boolean {
  const legacy = getLegacyGridQuestionText(q, answers);
  if (!legacy) return false;
  const parsed = parseLegacyGridLines(legacy);
  // Essay shown in first row for reference only — still require proper per-row fill on resubmit.
  if (parsed.length === 1 && 'single' in parsed[0] && (q.rows?.length ?? 0) > 1) {
    return false;
  }
  return Object.keys(buildGridCellsFromLegacyText(q, legacy)).length > 0;
}

function groupGridCellsByRow(cells: Record<string, string>): Map<number, Record<string, string>> {
  const byRow = new Map<number, Record<string, string>>();
  for (const [key, val] of Object.entries(cells)) {
    const match = /^r(\d+)_c/.exec(key);
    if (!match) continue;
    const rowId = Number(match[1]);
    if (!byRow.has(rowId)) byRow.set(rowId, {});
    byRow.get(rowId)![key] = val;
  }
  return byRow;
}

/** Persist parsed legacy grid text as per-row answers so the DB matches the UI. */
export async function migrateLegacyGridAnswersToRows(
  instanceId: number,
  questions: GridQuestionLike[],
  answers: GridAnswersMap,
  saveRow: (
    instanceId: number,
    questionId: number,
    rowId: number,
    payload: { json: Record<string, string> }
  ) => Promise<void>
): Promise<GridAnswersMap> {
  const next: GridAnswersMap = { ...answers };
  for (const q of questions) {
    if (!q.rows?.length) continue;
    if (rowLevelGridHasContent(q, next)) continue;
    const legacy = getLegacyGridQuestionText(q, next);
    if (!legacy) continue;
    const cells = buildGridCellsFromLegacyText(q, legacy);
    if (!Object.keys(cells).length) continue;

    const byRow = groupGridCellsByRow(cells);
    for (const [rowId, rowCells] of byRow) {
      await saveRow(instanceId, q.id, rowId, { json: rowCells });
      next[getGridAnswerKey(q.id, rowId)] = rowCells;
    }
  }
  return next;
}
