/**
 * Primary parsing path for task instructions input.
 *
 * IMPORTANT:
 * - We DO NOT change storage schema or PDF generation expectations.
 * - Output is already mapped into the existing `instructions.blocks` structure:
 *   - paragraph blocks -> `content` is HTML made of <p>...</p>
 *   - table blocks -> `rows[].cells[]` are HTML strings made of <p>...</p>
 *
 * DOCX / HTML are parsed first because they preserve real structure (tables, rows, paragraphs).
 * Plain-text heuristics remain as a fallback for flattened clipboard text.
 */

import { parseMixedContent } from './parseMixedContent';
import type { ParsedBlock } from './parseMixedContent';

export type InstructionBlockType = 'paragraph' | 'table';

export type InstructionTableRow = {
  heading?: string;
  content?: string;
  cells?: string[];
};

export type InstructionBlock = {
  id: string;
  type: InstructionBlockType;
  heading?: string;
  content?: string;
  rows?: InstructionTableRow[];
  columnHeaders?: string[];
};

export function escapeHtml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeWs(s: string): string {
  return String(s ?? '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeForCompare(s: string): string {
  return normalizeWs(String(s ?? '')).toLowerCase();
}

/** Convert text into HTML where each logical paragraph becomes its own <p>. */
export function toHtmlParagraphsPreserveLines(text: string): string {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = raw.split('\n');
  const paras: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    const t = buf.map((x) => normalizeWs(x)).filter(Boolean).join(' ').trim();
    if (t) paras.push(`<p>${escapeHtml(t)}</p>`);
    buf = [];
  };

  for (const line of lines) {
    if (String(line ?? '').trim().length === 0) {
      flush();
      continue;
    }
    // Keep each line as its own paragraph unless it is clearly a wrapped continuation.
    // For Word/PDF copy, "Assessment Description" + "(What?)" should become two <p>.
    if (buf.length > 0) flush();
    buf.push(line);
  }
  flush();
  return paras.join('');
}

function htmlTextContent(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return String(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  // Avoid including script/style.
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style') return '';
  return String(el.textContent ?? '');
}

function extractParagraphLikeTexts(container: Element): string[] {
  // Prefer explicit paragraphs/headings/list-items. If none, fall back to container text.
  const blocks = Array.from(container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, div'));
  const texts: string[] = [];
  for (const b of blocks) {
    // Skip nested tables completely (handled elsewhere).
    if (b.closest('table') && b.closest('table') !== container.closest('table')) continue;
    const t = normalizeWs(htmlTextContent(b));
    if (t) texts.push(t);
  }
  if (texts.length > 0) return texts;
  const t = normalizeWs(htmlTextContent(container));
  return t ? [t] : [];
}

function cellElementToHtml(cell: Element): string {
  const paras = extractParagraphLikeTexts(cell);
  return paras.map((t) => `<p>${escapeHtml(t)}</p>`).join('');
}

function isNumericLike(s: string): boolean {
  return /^\d+$/.test(String(s ?? '').trim());
}

function looksLikeAssessmentInfoHeader(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const joined = cells.map((c) => String(c ?? '').toLowerCase()).join(' ');
  return joined.includes('assessment') && joined.includes('description');
}

function firstRowLooksLikeHeader(cells: Element[], textCells: string[]): boolean {
  if (cells.length < 2) return false;
  if (looksLikeAssessmentInfoHeader(textCells)) return true;
  // Mammoth often outputs header rows as <td> with bold/strong content.
  const hasStrongEverywhere =
    cells.length > 0 &&
    cells.every((c) => c.tagName.toLowerCase() === 'th' || !!c.querySelector('strong, b'));
  if (hasStrongEverywhere) return true;
  // Heuristic: short, title-like cells in first row.
  const nonEmpty = textCells.filter(Boolean);
  if (nonEmpty.length < 2) return false;
  const shortEnough = nonEmpty.every((t) => t.length <= 48);
  return shortEnough;
}

function tableToInstructionBlock(table: HTMLTableElement, idBase: string, idx: number): InstructionBlock | null {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length === 0) return null;

  const firstRowCells = Array.from(rows[0].querySelectorAll('th,td'));
  const firstRowTextCells = firstRowCells.map((c) => normalizeWs(htmlTextContent(c))).filter(Boolean);
  const firstRowIsHeader = firstRowLooksLikeHeader(firstRowCells, firstRowTextCells);

  let headers = firstRowIsHeader ? firstRowTextCells : [];

  const dataRows = rows.slice(firstRowIsHeader ? 1 : 0);
  const parsedRowsRaw: InstructionTableRow[] = [];
  for (const tr of dataRows) {
    const cells = Array.from(tr.querySelectorAll('th,td'));
    if (cells.length === 0) continue;
    const htmlCells = cells.map((c) => cellElementToHtml(c));
    const hasAny = htmlCells.some((c) => c.replace(/<[^>]*>/g, '').trim().length > 0);
    if (!hasAny) continue;
    parsedRowsRaw.push({ cells: htmlCells });
  }

  if (parsedRowsRaw.length === 0) return null;

  // Special case: Word assessment info tables often include a leading row-number column.
  // If we have 3 columns and first column is numeric for most rows, drop it to match existing 2-col renderer/storage.
  const shouldDropLeadingNumbers =
    (headers.length === 2 && parsedRowsRaw[0]?.cells?.length === 3) ||
    (headers.length === 0 && parsedRowsRaw[0]?.cells?.length === 3);
  if (shouldDropLeadingNumbers) {
    const numericCount = parsedRowsRaw.filter((r) => {
      const firstCellText = String(r.cells?.[0] ?? '').replace(/<[^>]*>/g, '').trim();
      return isNumericLike(firstCellText);
    }).length;
    if (numericCount >= Math.max(1, Math.floor(parsedRowsRaw.length * 0.6))) {
      for (const r of parsedRowsRaw) {
        if (Array.isArray(r.cells) && r.cells.length >= 3) r.cells = r.cells.slice(1);
      }
    }
  }

  // FINAL MAPPING CONTRACT for editor/storage:
  // - 2 columns => keep as 2-cell row (`cells.length === 2`), no columnHeaders required.
  // - 3+ columns => keep multi-column (`cells.length === headers.length`), and set `columnHeaders`.
  //   This enables the existing editor multi-column grid.
  const maxCols = Math.max(...parsedRowsRaw.map((r) => (r.cells?.length ?? 0)));
  const colCount = Math.max(0, maxCols);
  if (colCount >= 3) {
    if (headers.length === 0) headers = Array.from({ length: colCount }, (_, i) => `Column ${i + 1}`);
    if (headers.length !== colCount) {
      // Pad or trim headers to match detected column count.
      headers = Array.from({ length: colCount }, (_, i) => headers[i] ?? `Column ${i + 1}`);
    }
  }

  const mappedRows: InstructionTableRow[] = [];
  for (const r of parsedRowsRaw) {
    const cells = Array.isArray(r.cells) ? r.cells : [];
    if (colCount >= 3) {
      const padded = Array.from({ length: colCount }, (_, i) => cells[i] ?? '');
      const any = padded.some((c) => c.replace(/<[^>]*>/g, '').trim().length > 0);
      if (any) mappedRows.push({ cells: padded });
    } else {
      const left = cells[0] ?? '';
      const right = cells[1] ?? '';
      const any = [left, right].some((c) => String(c ?? '').replace(/<[^>]*>/g, '').trim().length > 0);
      if (any) mappedRows.push({ cells: [left, right] });
    }
  }

  const valid = mappedRows.filter((r) => (r.cells ?? []).some((c) => c.replace(/<[^>]*>/g, '').trim().length > 0));
  if (valid.length === 0) return null;

  return {
    id: `${idBase}-table-${idx}`,
    type: 'table',
    columnHeaders: colCount >= 3 ? headers : undefined,
    rows: valid,
  };
}

export function parseHtmlToInstructionBlocks(html: string, opts?: { idBase?: string }): InstructionBlock[] {
  const idBase = opts?.idBase ?? `smart-${Date.now()}`;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;
  if (!body) return [];

  type Semantic =
    | { type: 'heading'; text: string }
    | { type: 'paragraph'; text: string }
    | { type: 'list'; items: string[] }
    | { type: 'table'; table: HTMLTableElement };

  const semantic: Semantic[] = [];
  let lastNorm = '';

  const emitText = (type: 'heading' | 'paragraph', text: string) => {
    const t = normalizeWs(text);
    if (!t) return;
    const norm = normalizeForCompare(`${type}:${t}`);
    if (norm === lastNorm) return;
    lastNorm = norm;
    semantic.push({ type, text: t });
  };

  const emitList = (items: string[]) => {
    const cleaned = items.map((x) => normalizeWs(x)).filter(Boolean);
    if (cleaned.length === 0) return;
    const norm = normalizeForCompare(`list:${cleaned.join('|')}`);
    if (norm === lastNorm) return;
    lastNorm = norm;
    semantic.push({ type: 'list', items: cleaned });
  };

  const emitTable = (table: HTMLTableElement) => {
    const norm = normalizeForCompare(`table:${(table.textContent ?? '').slice(0, 2000)}`);
    // Dedupe only adjacent identical tables (mammoth sometimes repeats).
    if (norm === lastNorm) return;
    lastNorm = norm;
    semantic.push({ type: 'table', table });
  };

  const isHeadingParagraph = (p: HTMLParagraphElement): boolean => {
    const t = normalizeWs(p.textContent ?? '');
    if (!t) return false;
    if (t.length > 80) return false;
    const strongish = p.querySelector('strong, b');
    if (!strongish) return false;
    // If most of the text is bold, treat as heading.
    const boldText = normalizeWs(strongish.textContent ?? '');
    return boldText.length >= Math.min(t.length, 12);
  };

  const walk = (root: Element) => {
    for (const child of Array.from(root.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'table') {
        emitTable(child as HTMLTableElement);
        continue;
      }
      if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(child.querySelectorAll(':scope > li')).map((li) => (li.textContent ?? '').trim());
        emitList(items);
        continue;
      }
      if (tag.startsWith('h')) {
        emitText('heading', child.textContent ?? '');
        continue;
      }
      if (tag === 'p') {
        const p = child as HTMLParagraphElement;
        if (isHeadingParagraph(p)) emitText('heading', p.textContent ?? '');
        else emitText('paragraph', p.textContent ?? '');
        continue;
      }
      // Container: recurse; DO NOT emit container text to avoid duplicates.
      walk(child);
    }
  };

  walk(body);

  // Pass 2: map semantic blocks into InstructionBlocks with label/value detection and correct grouping.
  const blocks: InstructionBlock[] = [];
  let pendingHeading: string | null = null;
  let paraHtmlBuf: string[] = [];

  const flushParagraphBlock = () => {
    const htmlOut = paraHtmlBuf.join('');
    if (htmlOut.replace(/<[^>]*>/g, '').trim()) {
      blocks.push({
        id: `${idBase}-p-${blocks.length}`,
        type: 'paragraph',
        content: htmlOut,
      });
    }
    paraHtmlBuf = [];
  };

  const textToP = (t: string) => `<p>${escapeHtml(normalizeWs(t))}</p>`;

  const labelValueBlock = (labelLines: string[], valueLines: string[]) => {
    const leftHtml = labelLines.map(textToP).join('');
    const rightHtml = valueLines.map(textToP).join('');
    blocks.push({
      id: `${idBase}-lv-${blocks.length}`,
      type: 'table',
      // keep as 2-cell row using `cells` (PDF/storage compatible). UI now supports 2-cell `cells` even without headers.
      rows: [{ cells: [leftHtml, rightHtml] }],
    });
  };

  const isLabelLike = (t: string) => {
    const s = normalizeWs(t);
    if (!s) return false;
    if (s.length > 70) return false;
    // labels often have no trailing period and few sentences
    const sentenceLike = (s.match(/[.!?]/g) ?? []).length;
    return sentenceLike <= 1;
  };

  for (let i = 0; i < semantic.length; i++) {
    const b = semantic[i]!;
    if (b.type === 'heading') {
      // Heading starts a new section; flush prior paragraph content.
      flushParagraphBlock();
      pendingHeading = b.text;
      continue;
    }

    if (b.type === 'table') {
      flushParagraphBlock();
      const tb = tableToInstructionBlock(b.table, idBase, blocks.length);
      if (tb) {
        if (pendingHeading) tb.heading = pendingHeading;
        blocks.push(tb);
      }
      pendingHeading = null;
      continue;
    }

    // label/value detection: short label paragraph followed by list or long paragraph
    if (b.type === 'paragraph' && isLabelLike(b.text)) {
      const next = semantic[i + 1];
      if (next && (next.type === 'list' || (next.type === 'paragraph' && normalizeWs(next.text).length > 90))) {
        flushParagraphBlock();
        const labelLines = b.text.split('\n').map((x) => x.trim()).filter(Boolean);
        const valueLines =
          next.type === 'list'
            ? next.items
            : normalizeWs(next.text)
                .split(/\n+/)
                .map((x) => x.trim())
                .filter(Boolean);
        // include pending heading as part of label (if present) to avoid duplicating.
        if (pendingHeading) labelLines.unshift(pendingHeading);
        pendingHeading = null;
        labelValueBlock(labelLines, valueLines);
        i += 1;
        continue;
      }
    }

    // Normal paragraph/list content: group into paragraph blocks until next heading/table/labelvalue.
    if (pendingHeading) {
      paraHtmlBuf.push(textToP(pendingHeading));
      pendingHeading = null;
    }
    if (b.type === 'paragraph') {
      paraHtmlBuf.push(textToP(b.text));
    } else if (b.type === 'list') {
      for (const item of b.items) paraHtmlBuf.push(textToP(item));
    }
  }

  flushParagraphBlock();
  // If we ended on a heading with no body, emit it as a paragraph block.
  if (pendingHeading) {
    blocks.push({
      id: `${idBase}-p-${blocks.length}`,
      type: 'paragraph',
      content: `<p>${escapeHtml(pendingHeading)}</p>`,
    });
  }

  return blocks;
}

export async function parseDocxFileToHtml(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  // Use browser bundle to avoid Node polyfills in Vite.
  const mammoth = await import('mammoth/mammoth.browser');
  const res = await mammoth.convertToHtml({ arrayBuffer });
  return String(res.value ?? '');
}

function parsedBlocksToInstructionBlocks(parsed: ParsedBlock[], idBase: string): InstructionBlock[] {
  const blocks: InstructionBlock[] = [];
  let i = 0;
  for (const b of parsed) {
    if (b.type === 'paragraph') {
      const text = [b.heading, b.content].filter(Boolean).join('\n\n').trim();
      const content = toHtmlParagraphsPreserveLines(text);
      if (content.replace(/<[^>]*>/g, '').trim().length > 0) {
        blocks.push({ id: `${idBase}-p-${i++}`, type: 'paragraph', content });
      }
    } else {
      const rows = (b.rows || []).map((cells) => ({
        cells: cells.map((c) => toHtmlParagraphsPreserveLines(c)),
      }));
      const valid = rows.filter((r) => (r.cells ?? []).some((c) => c.replace(/<[^>]*>/g, '').trim().length > 0));
      if (valid.length > 0) {
        blocks.push({
          id: `${idBase}-t-${i++}`,
          type: 'table',
          columnHeaders: Array.isArray(b.headers) && b.headers.length > 0 ? b.headers : undefined,
          rows: valid,
        });
      }
    }
  }
  return blocks;
}

export async function parseInputToInstructionBlocks(input: {
  file?: File | null;
  html?: string | null;
  text?: string | null;
  idBase?: string;
}): Promise<InstructionBlock[]> {
  const idBase = input.idBase ?? `smart-${Date.now()}`;

  // 1) DOCX upload parsing (primary)
  if (input.file) {
    const name = String(input.file.name ?? '').toLowerCase();
    if (name.endsWith('.docx')) {
      const html = await parseDocxFileToHtml(input.file);
      const fromHtml = parseHtmlToInstructionBlocks(html, { idBase });
      if (fromHtml.length > 0) return fromHtml;
    }
  }

  // 2) HTML paste parsing (primary)
  const html = String(input.html ?? '').trim();
  if (html) {
    const fromHtml = parseHtmlToInstructionBlocks(html, { idBase });
    if (fromHtml.length > 0) return fromHtml;
  }

  // 3) Plain-text fallback (existing heuristic parser)
  const text = String(input.text ?? '').trim();
  if (!text) return [];
  const parsed = parseMixedContent(text);
  return parsedBlocksToInstructionBlocks(parsed, idBase);
}

