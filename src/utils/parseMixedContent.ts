/**
 * Parser for mixed content (paragraphs + tables) pasted from Word, Google Docs, etc.
 * Supports: paragraphs, heading+paragraph, 2-column assessment-info tables, standard multi-column tables.
 */

export type ParsedParagraphBlock = { type: 'paragraph'; content: string; heading?: string };
export type ParsedTableBlock = {
  type: 'table';
  headers: string[];
  rows: string[][];
  meta?: { rowNumbers?: string[]; sourcePattern?: 'assessment-info' | 'standard-table' };
};
export type ParsedBlock = ParsedParagraphBlock | ParsedTableBlock;

const NON_BREAKING_SPACE = '\u00A0';
const KNOWN_HEADERS = [
  'Assessment Information',
  'Description',
  'Evidence to submit',
  'Estimated Cost (AUD)',
  'Budget Consideration',
  'Cost Category',
  'Risk Category',
  'Identified Risk',
  'Potential Impact on Team',
  'Required Team Response',
  'Task',
  'Instructions',
];

const ASSESSMENT_INFO_ROW_LABELS = [
  'assessment method',
  'assessment type',
  'assessment description',
  'assessment instructions',
  'assessment date/s and timing/s',
  'assessment dates and timings',
  'assessment date and timing',
  'assessment information',
  'purpose (objective) of the assessment',
  'purpose (objective) of assessment',
  'purpose',
  'specifications',
  'required resources',
  'evidence requirements',
  'evidence requirements/',
  'evidence to submit',
];

function normalizeLabelForMatch(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\s_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickLongestMatchingPrefixLabel(rest: string): string | null {
  const r = normalizeLabelForMatch(rest);
  if (!r) return null;
  let best: string | null = null;
  for (const label of ASSESSMENT_INFO_ROW_LABELS) {
    const l = normalizeLabelForMatch(label);
    if (!l) continue;
    if (r.startsWith(l) && (!best || l.length > normalizeLabelForMatch(best).length)) {
      best = label;
    }
  }
  return best;
}

function tryParseHeaderlessAssessmentInfoTable(lines: string[]): ParsedTableBlock | null {
  // Heuristic: many consecutive lines start with 1/2/3... and known assessment-info row labels.
  const trimmed = lines.map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  if (trimmed.length < 3) return null;
  const headerMaybe = trimmed[0] ?? '';
  if (/assessment information/i.test(headerMaybe) && /description/i.test(headerMaybe)) return null; // already handled by normal table path

  const rowStarts: Array<{ idx: number; rowNum: string; labelRaw: string; contentRaw: string }> = [];
  for (let i = 0; i < trimmed.length; i++) {
    const line = trimmed[i] ?? '';
    const m = line.match(/^(\d+)[.)]?\s+(.*)$/);
    if (!m) continue;
    const rowNum = m[1] ?? '';
    const rest = (m[2] ?? '').trim();
    const label = pickLongestMatchingPrefixLabel(rest);
    if (!label) continue;
    const normalizedLabel = normalizeLabelForMatch(label);
    const normalizedRest = normalizeLabelForMatch(rest);
    // Map cutLen back onto original rest by taking the same number of words from the label match
    // (labels are short + stable; this is good enough for pasted plain text).
    const labelWordCount = normalizedLabel.split(' ').filter(Boolean).length;
    const restWords = rest.split(/\s+/);
    const labelRaw = restWords.slice(0, labelWordCount).join(' ').trim();
    const contentRaw = restWords.slice(labelWordCount).join(' ').trim();
    if (!normalizedRest.startsWith(normalizedLabel)) continue;
    if (!rowNum.trim() || !labelRaw) continue;
    rowStarts.push({ idx: i, rowNum, labelRaw, contentRaw });
  }
  if (rowStarts.length < 2) return null;

  // Build rows by consuming lines until next start; append continuations to the right cell.
  const rows: string[][] = [];
  const rowNumbers: string[] = [];
  for (let r = 0; r < rowStarts.length; r++) {
    const start = rowStarts[r]!;
    const end = rowStarts[r + 1]?.idx ?? trimmed.length;
    const blockLines = trimmed.slice(start.idx, end);
    const firstLine = blockLines[0] ?? '';
    const firstMatch = firstLine.match(/^(\d+)[.)]?\s+(.*)$/);
    const firstRest = (firstMatch?.[2] ?? '').trim();
    const label = pickLongestMatchingPrefixLabel(firstRest);
    if (!label) continue;
    const normalizedLabel = normalizeLabelForMatch(label);
    const labelWordCount = normalizedLabel.split(' ').filter(Boolean).length;
    const restWords = firstRest.split(/\s+/);
    const labelRaw = restWords.slice(0, labelWordCount).join(' ').trim();
    let right = restWords.slice(labelWordCount).join(' ').trim();

    // If (What?)/(How?)/(When?) exists on first line, attach to left cell.
    const paren = right.match(/^(\([^)]{1,80}\))\s*(.*)$/);
    let left = labelRaw;
    if (paren) {
      left = `${labelRaw}\n${paren[1]}`.trim();
      right = (paren[2] ?? '').trim();
    }

    // Append continuation lines (wrapped text, bullets, list items) into right cell.
    if (blockLines.length > 1) {
      const cont = blockLines
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (cont.length > 0) {
        right = [right, ...cont].filter(Boolean).join('\n');
      }
    }

    rowNumbers.push(start.rowNum);
    rows.push([left.trim(), right.trim()]);
  }

  if (rows.length < 2) return null;
  return {
    type: 'table',
    headers: ['Assessment Information', 'Description'],
    rows,
    meta: { rowNumbers, sourcePattern: 'assessment-info' },
  };
}

// ---------------------------------------------------------------------------
// A. NORMALIZATION
// ---------------------------------------------------------------------------

/** Normalize pasted text: remove \r, convert non-breaking spaces, trim. Preserves internal newlines. */
export function normalizePastedText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(new RegExp(NON_BREAKING_SPACE, 'g'), ' ')
    .trim();
}

/** Split a line into cells using tab or 2+ spaces. Trims each cell. */
export function splitTableRow(line: string, useTabs: boolean): string[] {
  if (useTabs) {
    return line.split(/\t+/).map((c) => c.trim());
  }
  return line.split(/\s{2,}/).map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// H. HEADER NORMALIZATION
// ---------------------------------------------------------------------------

/** Normalize header: collapse spaces, replace _/- with space, trim, Title Case. Keep known labels. */
export function normalizeHeader(raw: string, index: number): string {
  let s = raw
    .replace(/[\s_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return `Column ${index + 1}`;
  const normalized = s.replace(/\b\w/g, (c) => c.toUpperCase());
  const match = KNOWN_HEADERS.find(
    (k) => k.toLowerCase().replace(/\s+/g, ' ') === normalized.toLowerCase().replace(/\s+/g, ' ')
  );
  return match ?? normalized;
}

// ---------------------------------------------------------------------------
// ROW NUMBER & BRACKET HELPERS
// ---------------------------------------------------------------------------

/** Extract leading row number if first cell is "1", "2", "3.", "4)", etc. */
export function extractLeadingRowNumber(cell: string): { isRowNumber: boolean; value?: string } {
  const t = String(cell ?? '').trim();
  if (!t) return { isRowNumber: false };
  if (/^\d+$/.test(t)) return { isRowNumber: true, value: t };
  if (/^\d+\.$/.test(t)) return { isRowNumber: true, value: t.replace(/\.$/, '') };
  if (/^\d+\)$/.test(t)) return { isRowNumber: true, value: t.replace(/\)$/, '') };
  return { isRowNumber: false };
}

/** Check if text is bracket-only (e.g. "(What?)", "(How?)", "(What resources, equipment...)"). */
export function isBracketOnlyText(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return false;
  return /^\([^)]{1,80}\)\s*$/.test(t);
}

function isParentheticalCell(cell: string): boolean {
  const t = (cell ?? '').trim();
  return t.startsWith('(') && t.includes(')');
}

// ---------------------------------------------------------------------------
// LIST / CONTINUATION DETECTION
// ---------------------------------------------------------------------------

/** Check if line is a bullet or numbered list item (continuation, not a new row). */
export function isLikelyContinuationLine(line: string): boolean {
  const t = line.trimStart();
  return (
    /^[•\-–*]\s/.test(t) ||
    /^\d+[\.\)]\s/.test(t) ||
    /^\d+[\.\)]\t/.test(t) ||
    /^[a-z][\.\)]\s/i.test(t) ||
    /^\([iIvVxXdDlLcCmM]+\)\s/i.test(t) ||
    /^\(\d+\)\s/.test(t) ||
    /^Note:\s/i.test(t)
  );
}

function isListContinuation(line: string): boolean {
  return isLikelyContinuationLine(line);
}

/** Check if line is ONLY a bare list number (e.g. "1." or "2)") with no content - skip to avoid redundant numbering. */
function isBareListNumberOnly(line: string): boolean {
  const t = line.trim();
  return /^\d+[\.\)]\s*$/.test(t) || /^[a-z][\.\)]\s*$/i.test(t) || /^\([iIvVxXdDlLcCmM]+\)\s*$/i.test(t);
}

/** Check if line starts with a list marker: 1. 2. 1) 2) a. b. (i) (ii) etc. */
export function isListItemLine(line: string): boolean {
  const t = line.trimStart();
  return (
    /^[•\-–*]\s/.test(t) ||
    /^\d+[\.\)]\s/.test(t) ||
    /^\d+[\.\)]\t/.test(t) ||
    /^[a-z][\.\)]\s/i.test(t) ||
    /^\([iIvVxXdDlLcCmM]+\)\s/i.test(t) ||
    /^\(\d+\)\s/.test(t) ||
    /^Note:\s/i.test(t)
  );
}

const DESCRIPTION_CONTINUATION_LABELS = [
  'assessment instructions',
  'instructions',
  'specifications',
  'required resources',
  'evidence requirements',
];

/** Check if current row's left column suggests the next line should append to Description (instruction-style content). */
function shouldAppendToDescription(
  currentRow: string[] | null,
  line: string,
  cells: string[],
  opts?: { isAssessmentInfo?: boolean },
  useTabs?: boolean
): boolean {
  if (!currentRow || !opts?.isAssessmentInfo) return false;
  if (cells.length >= 2 && isTrueAssessmentRowStart(cells, useTabs ?? true)) return false;
  const leftIdx = currentRow.length >= 3 ? 1 : 0;
  const leftContent = (currentRow[leftIdx] ?? '').toLowerCase();
  const firstCell = (cells[0] ?? '').trim();
  const secondCell = (cells[1] ?? '').trim();

  const leftHasInstructionLabel = DESCRIPTION_CONTINUATION_LABELS.some((p) => leftContent.includes(p));

  const looksLikeInstructionListItem =
    isListItemLine(line.trim()) ||
    (cells.length >= 2 &&
      extractLeadingRowNumber(firstCell).isRowNumber &&
      secondCell.length > 0 &&
      !/^assessment\s+(method|type|description|date|information)(\s|$)/i.test(secondCell) &&
      !/^(purpose|evidence)(\s|$)/i.test(secondCell));

  return leftHasInstructionLabel && looksLikeInstructionListItem;
}

/** Check if line matches full assessment row structure (row id + label + content), not just a list item. */
function isTrueAssessmentRowStart(cells: string[], _useTabs: boolean): boolean {
  if (cells.length < 2) return false;
  const first = (cells[0] ?? '').trim();
  const second = (cells[1] ?? '').trim();
  const hasRowNumber = extractLeadingRowNumber(first).isRowNumber;
  const secondLooksLikeLabel =
    second.length >= 10 &&
    (/^assessment\s+/i.test(second) ||
      /^(purpose|evidence|specifications|required resources|evidence requirements|instructions)(\s|$)/i.test(
        second
      ));
  return hasRowNumber && secondLooksLikeLabel;
}

function isBulletChar(s: string): boolean {
  const t = (s ?? '').trim();
  return /^[•\-–*]\s*$/.test(t) || t === '•' || t === '–';
}

/** Check if a 2-cell row is a bulleted list item inside Description, not a new table row. */
function isBulletedListInDescription(cells: string[], currentRow: string[] | null): boolean {
  if (!currentRow || cells.length < 2) return false;
  const first = (cells[0] ?? '').trim();
  const second = (cells[1] ?? '').trim();
  if (!isBulletChar(first)) return false;
  return second.length >= 10;
}

/** Check if a 2-cell row is a numbered list item inside Description, not a new table row. */
function isNumberedListInDescription(cells: string[], currentRow: string[] | null): boolean {
  if (!currentRow || cells.length < 2) return false;
  const first = (cells[0] ?? '').trim();
  const second = (cells[1] ?? '').trim();
  if (!extractLeadingRowNumber(first).isRowNumber) return false;
  if (second.length < 15) return false;
  const secondLower = second.toLowerCase();
  if (
    /^assessment\s+(method|type|description|instructions|information|date|timing)/i.test(second) ||
    secondLower.startsWith('assessment date') ||
    secondLower.startsWith('assessment method') ||
    secondLower.startsWith('assessment type') ||
    secondLower.startsWith('assessment description') ||
    secondLower.startsWith('assessment instructions') ||
    secondLower.startsWith('assessment information') ||
    /^(purpose|evidence|specifications|required resources|evidence requirements)(\s|$)/i.test(second)
  )
    return false;
  return (
    /^(review|read|provide|conduct|complete|submit|document|see|continue|any|this|the|specified|learner|simulated|access|computer|workspace|case study|follow|identify|participate)/i.test(
      second
    ) || second.length > 35
  );
}

/** Check if header row looks like list content (numbered or bullet) - not a real table header. */
function isLikelyListContentAsHeader(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const first = (cells[0] ?? '').trim();
  const second = (cells[1] ?? '').trim();
  if (second.length < 15) return false;
  if (extractLeadingRowNumber(first).isRowNumber) return true;
  if (isBulletChar(first)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// B. HEADING / SECTION TITLE DETECTION
// ---------------------------------------------------------------------------

/** Check if a short standalone line could be a section heading (e.g. "Project Risks", "Project Budget"). */
function isLikelySectionHeading(line: string): boolean {
  const t = line.trim();
  if (t.length > 60) return false;
  if (t.includes('\t')) return false;
  if (/^[•\-–*]\s/.test(t)) return false;
  if (/^\d+[\.\)]\s/.test(t)) return false;
  if (t.endsWith('.') && t.split(' ').length > 8) return false;
  return t.length > 0 && /^[A-Za-z0-9\s\-_]+$/.test(t);
}

// ---------------------------------------------------------------------------
// C. TABLE DETECTION
// ---------------------------------------------------------------------------

/** Check if block is likely a table: at least 2 rows, consistent column separators. */
export function isLikelyTableBlock(
  lines: string[],
  useTabs: boolean
): { valid: boolean; numCols?: number; maxCols?: number } {
  if (lines.length < 2) return { valid: false };
  const firstCells = splitTableRow(lines[0], useTabs);
  let numCols = firstCells.length;
  let maxCols = numCols;
  for (const line of lines) {
    const n = splitTableRow(line, useTabs).length;
    if (n > maxCols) maxCols = n;
  }
  if (numCols < 2) return { valid: false };
  const firstHasSeparator = useTabs ? lines[0].includes('\t') : /\s{2,}/.test(lines[0]);
  if (!firstHasSeparator) return { valid: false };
  let consistentRows = 0;
  const minColsNeeded = Math.min(numCols, 2);
  for (const line of lines) {
    const cells = splitTableRow(line, useTabs);
    if (cells.length >= minColsNeeded && cells.some((c) => c.length > 0)) consistentRows++;
  }
  if (consistentRows < 2) return { valid: false };
  return { valid: true, numCols, maxCols };
}

/** Check if header row matches assessment-info pattern (Assessment Information | Description). */
export function isAssessmentInfoSchema(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const joined = cells.map((c) => c.toLowerCase()).join(' ');
  return /assessment/.test(joined) && /description/.test(joined);
}

function isAssessmentInfoHeader(cells: string[]): boolean {
  return isAssessmentInfoSchema(cells);
}

/** Check if header row matches Task | Instructions | Evidence pattern. */
function isTaskInstructionsHeader(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const joined = cells.map((c) => c.toLowerCase()).join(' ');
  return (/task/i.test(joined) || /instruction/i.test(joined)) && /evidence/i.test(joined);
}

/** Check if header suggests standard table (Risk, Budget, Task/Instructions). */
function isStandardTableHeader(cells: string[]): boolean {
  const joined = cells.map((c) => c.toLowerCase()).join(' ');
  return (
    /risk|category|identified|impact|response/i.test(joined) ||
    /cost|budget|category|estimated|aud/i.test(joined) ||
    (/task/i.test(joined) && /instruction|evidence/i.test(joined))
  );
}

// ---------------------------------------------------------------------------
// F. MERGE CONTINUATION LINES
// ---------------------------------------------------------------------------

/**
 * Merge continuation lines into rows. A new row starts only when the line matches valid row structure.
 * Bracket-only → left; bullets/numbered → right.
 */
export function mergeContinuationLinesIntoRows(
  lines: string[],
  useTabs: boolean,
  numCols: number,
  opts?: { isAssessmentInfo?: boolean; isTaskInstructions?: boolean }
): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] | null = null;

  const minColsForFullRow = opts?.isAssessmentInfo ? Math.min(2, numCols) : numCols;
  for (const line of lines) {
    let cells = splitTableRow(line, useTabs);
    if (opts?.isAssessmentInfo && cells.length === 1 && line.includes('  ') && !line.includes('\t')) {
      cells = splitTableRow(line, false);
    }
    const hasFullRow = cells.length >= minColsForFullRow && cells.some((c) => c.length > 0);
    const firstCellIsBracketOnly =
      opts?.isAssessmentInfo && cells.length >= 1 && isBracketOnlyText(cells[0] ?? '');
    const firstCellIsLongBracket =
      opts?.isAssessmentInfo &&
      cells.length >= 3 &&
      isParentheticalCell(cells[0] ?? '') &&
      extractLeadingRowNumber(cells[1] ?? '').isRowNumber;
    const looksLikeNewRow =
      cells.length >= 2 &&
      extractLeadingRowNumber(cells[0] ?? '').isRowNumber &&
      !opts?.isAssessmentInfo;
    const numberedListInDescription =
      opts?.isAssessmentInfo && isNumberedListInDescription(cells, currentRow);
    const bulletedListInDescription =
      opts?.isAssessmentInfo && isBulletedListInDescription(cells, currentRow);
    const appendToDescription =
      opts?.isAssessmentInfo && shouldAppendToDescription(currentRow, line, cells, opts, useTabs);
    const isContinuation =
      (!hasFullRow &&
        !looksLikeNewRow &&
        (isListContinuation(line) ||
          isBracketOnlyText(line.trim()) ||
          (currentRow && line.trim().length > 0))) ||
      (hasFullRow && (firstCellIsBracketOnly || firstCellIsLongBracket) && currentRow) ||
      ((numberedListInDescription || bulletedListInDescription) && currentRow) ||
      appendToDescription;

    if ((hasFullRow || looksLikeNewRow) && !isContinuation) {
      if (currentRow) rows.push(currentRow);
      let padded: string[];
      if (
        opts?.isAssessmentInfo &&
        numCols >= 3 &&
        cells.length >= 4 &&
        extractLeadingRowNumber(cells[0] ?? '').isRowNumber
      ) {
        const rowNum = cells[0];
        const leftParts = cells.slice(1, -1).filter((c) => (c ?? '').trim());
        const right = cells[cells.length - 1] ?? '';
        padded = [rowNum ?? '', leftParts.join('\n'), right];
      } else {
        padded = [...cells.slice(0, numCols)];
      }
      while (padded.length < numCols) padded.push('');
      if (
        opts?.isAssessmentInfo &&
        numCols >= 3 &&
        padded.length >= 3 &&
        cells.length === 3 &&
        isBracketOnlyText(padded[2] ?? '') &&
        (padded[1] ?? '').trim().length > 0
      ) {
        const leftCell = ((padded[1] ?? '').trim() + '\n' + (padded[2] ?? '').trim()).trim();
        padded = [padded[0], leftCell, ''];
      }
      currentRow = padded.map((c) => c.trim());
    } else if (isContinuation && currentRow) {
      if ((numberedListInDescription || bulletedListInDescription || appendToDescription) && cells.length >= 2) {
        const rightIdx = opts?.isAssessmentInfo && numCols >= 3 ? 2 : numCols - 1;
        const listItem = [(cells[0] ?? '').trim(), (cells[1] ?? '').trim()].filter(Boolean).join(' ');
        if (!isBareListNumberOnly(listItem)) {
          currentRow[rightIdx] = (currentRow[rightIdx] || '') + '\n' + listItem;
        }
      } else if (firstCellIsLongBracket && cells.length >= 3) {
        const leftIdx = opts?.isAssessmentInfo && numCols >= 2 ? 1 : 0;
        const rightIdx = opts?.isAssessmentInfo && numCols >= 2 ? 2 : 1;
        const base = (currentRow[leftIdx] || '').trimEnd();
        currentRow[leftIdx] = base + (base ? '\n' : '') + (cells[0] ?? '').trim();
        currentRow[rightIdx] =
          (currentRow[rightIdx] || '') +
          '\n' +
          cells
            .slice(1)
            .map((c) => (c ?? '').trim())
            .filter(Boolean)
            .join(' ');
      } else if (firstCellIsBracketOnly && cells.length >= 2) {
        const leftIdx = opts?.isAssessmentInfo && numCols >= 2 ? 1 : 0;
        const rightIdx = opts?.isAssessmentInfo && numCols >= 2 ? 2 : 1;
        const base = (currentRow[leftIdx] || '').trimEnd();
        currentRow[leftIdx] = base + (base ? '\n' : '') + (cells[0] ?? '').trim();
        currentRow[rightIdx] =
          (currentRow[rightIdx] || '') + '\n' + cells.slice(1).join(' ').trim();
      } else {
        let targetIdx = numCols - 1;
        if (opts?.isAssessmentInfo && numCols >= 3 && isBracketOnlyText(line.trim())) {
          targetIdx = 1;
        } else if (opts?.isTaskInstructions && numCols >= 3 && isListContinuation(line)) {
          targetIdx = 1;
        }
        if (cells.length >= 2 && targetIdx < numCols - 1) {
          const base = (currentRow[targetIdx] || '').trimEnd();
          const fragment = (cells[0] ?? '').trim();
          const isBracket = opts?.isAssessmentInfo && isBracketOnlyText(fragment);
          currentRow[targetIdx] = base + (isBracket ? (base ? '\n' : '') : '\n') + fragment;
          for (let i = 1; i < cells.length && targetIdx + i < numCols; i++) {
            currentRow[targetIdx + i] =
              (currentRow[targetIdx + i] || '') +
              (i > 1 ? '\n' : '') +
              (cells[i] ?? '').trim();
          }
        } else {
          const toAppend = line.trim();
          if (!isBareListNumberOnly(toAppend)) {
            currentRow[targetIdx] = (currentRow[targetIdx] || '') + '\n' + toAppend;
          }
        }
      }
    } else if (!hasFullRow && currentRow == null && line.trim()) {
      currentRow = [line.trim(), ...Array(numCols - 1).fill('')];
    }
  }
  if (currentRow) rows.push(currentRow);
  return rows;
}

function normalizeTableRows(rows: string[][], numCols: number): string[][] {
  return rows.map((row) => {
    const padded = [...row.slice(0, numCols)];
    while (padded.length < numCols) padded.push('');
    return padded.map((c) => String(c ?? '').trim());
  });
}

// ---------------------------------------------------------------------------
// E. PARSE 2-COLUMN ASSESSMENT TABLE
// ---------------------------------------------------------------------------

/**
 * Parse assessment-info table (2 visible cols). Rows may have leading numeric prefix.
 * Rule 11: 3+ cells → left = merge all except last with newline, right = last.
 * Rule 12: Bracket-only text attaches to left column.
 */
function parseAssessmentInfoTable(
  headerRow: string[],
  dataRows: string[][]
): { headers: string[]; rows: string[][]; rowNumbers: string[] } {
  const headers = [
    normalizeHeader(headerRow[0] ?? '', 0),
    normalizeHeader(headerRow[1] ?? '', 1),
  ];
  const rowNumbers: string[] = [];
  const rows: string[][] = [];

  for (const rawRow of dataRows) {
    let cells = [...rawRow].map((c) => String(c ?? '').trim()).filter((c, i, arr) => c || i < arr.length - 1);
    let rowNum: string | undefined;

    const first = extractLeadingRowNumber(cells[0] ?? '');
    if (first.isRowNumber && first.value && cells.length >= 2) {
      rowNum = first.value;
      cells = cells.slice(1);
    }

    if (rowNum != null) rowNumbers.push(rowNum);

    let left = '';
    let right = '';
    if (cells.length >= 1) {
      if (cells.length === 2) {
        left = cells[0] ?? '';
        right = cells[1] ?? '';
      } else if (cells.length >= 3) {
        left = cells.slice(0, -1).filter(Boolean).join('\n');
        right = cells[cells.length - 1] ?? '';
      } else {
        left = cells[0] ?? '';
        right = '';
      }
    }
    if (left.trim() || right.trim()) rows.push([left.trim(), right.trim()]);
  }
  return { headers, rows, rowNumbers };
}

// ---------------------------------------------------------------------------
// D. PARSE STANDARD TABLE
// ---------------------------------------------------------------------------

function parseStandardTable(
  headerRow: string[],
  dataRows: string[][]
): { headers: string[]; rows: string[][] } {
  const numCols = headerRow.length;
  const headers = headerRow.map((h, i) => normalizeHeader(h, i));
  const rows = normalizeTableRows(dataRows, numCols);
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// B. DETECT HEADING BEFORE TABLE
// ---------------------------------------------------------------------------

/** Detect if chunk has short section heading immediately before table. */
export function detectHeadingBeforeTable(chunk: string): { heading: string; tableLines: string[] } | null {
  const lines = chunk.split('\n');
  if (lines.length < 2) return null;
  const first = lines[0]!.trim();
  if (!first) return null;
  if (first.includes('\t') || /\s{2,}/.test(first)) return null;
  if (!isLikelySectionHeading(first)) return null;

  const rest = lines.slice(1).join('\n');
  const hasTabs = rest.includes('\t');
  const useTabs = hasTabs;
  const restLines = lines.slice(1).filter((l) => l.trim().length > 0);
  if (restLines.length < 2) return null;

  const firstRestCells = splitTableRow(restLines[0] ?? '', useTabs);
  if (firstRestCells.length < 2) return null;
  const firstRestHasSeparator = useTabs
    ? (restLines[0] ?? '').includes('\t')
    : /\s{2,}/.test(restLines[0] ?? '');
  if (!firstRestHasSeparator) return null;

  const { valid } = isLikelyTableBlock(restLines, useTabs);
  if (!valid) {
    const headerCells = splitTableRow(restLines[0] ?? '', useTabs).map((c) => c.trim()).filter(Boolean);
    const knownMatch =
      isAssessmentInfoHeader(headerCells) ||
      isTaskInstructionsHeader(headerCells) ||
      isStandardTableHeader(headerCells);
    if (!knownMatch) return null;
  }

  return { heading: first, tableLines: lines.slice(1) };
}

// ---------------------------------------------------------------------------
// TABLE CONTINUATION BOUNDARY (don't split table on blank between label and list)
// ---------------------------------------------------------------------------

function isTableCellContinuationBoundary(lastLine: string, nextNonBlankLine: string): boolean {
  const last = lastLine.trim();
  const next = nextNonBlankLine.trim();
  if (!last.endsWith(')') || last.length < 3) return false;
  if (!/^\d+[.)]\s/.test(next)) return false;
  return true;
}

function isHeaderlessAssessmentInfoRowStart(line: string): boolean {
  const t = (line ?? '').trim();
  if (!t) return false;
  // Common Word/PDF copy: "1 Assessment Method ..." (single spaces, no table separators)
  return /^\d+[.)]?\s+assessment\s+/i.test(t) || /^\d+[.)]?\s+purpose\s+/i.test(t) || /^\d+[.)]?\s+specifications\s+/i.test(t);
}

// ---------------------------------------------------------------------------
// SPLIT INTO LOGICAL BLOCKS
// ---------------------------------------------------------------------------

/**
 * Split content into logical blocks by blank lines.
 * Does NOT split when blank line falls between table label like "(How?)" and numbered list.
 */
function splitIntoLogicalBlocks(normalized: string): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  const lineSplit = normalized.split('\n');

  for (let i = 0; i < lineSplit.length; i++) {
    const line = lineSplit[i];
    const isBlank = line.trim().length === 0;
    if (isBlank) {
      if (current.length > 0) {
        const lastLine = current[current.length - 1] ?? '';
        let nextNonBlank = '';
        for (let j = i + 1; j < lineSplit.length; j++) {
          const l = lineSplit[j];
          if (l.trim().length > 0) {
            nextNonBlank = l;
            break;
          }
        }
        if (isTableCellContinuationBoundary(lastLine, nextNonBlank)) {
          current.push(line);
          continue;
        }
        // Don't split headerless Assessment Information tables when Word inserts blank lines between numbered rows.
        if (isHeaderlessAssessmentInfoRowStart(lastLine) && isHeaderlessAssessmentInfoRowStart(nextNonBlank)) {
          current.push(line);
          continue;
        }
        chunks.push(current.join('\n').trim());
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    chunks.push(current.join('\n').trim());
  }
  return chunks.filter((c) => c.length > 0);
}

// ---------------------------------------------------------------------------
// PARSE CHUNK (single block)
// ---------------------------------------------------------------------------

function parseChunk(chunk: string): ParsedBlock[] {
  const lines = chunk.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return [{ type: 'paragraph', content: '' }];

  const headingBefore = detectHeadingBeforeTable(chunk);
  let tableLines = lines;
  let headingBlock: ParsedParagraphBlock | null = null;

  if (headingBefore) {
    headingBlock = { type: 'paragraph', heading: headingBefore.heading, content: '' };
    tableLines = headingBefore.tableLines.filter((l) => l.trim().length > 0);
  }

  const hasTabs = tableLines.some((l) => l.includes('\t'));
  const useTabs = hasTabs;

  let { valid, numCols, maxCols } = isLikelyTableBlock(tableLines, useTabs);
  const headerCellsFromFirst = splitTableRow(tableLines[0] ?? '', useTabs)
    .map((c) => c.trim())
    .filter(Boolean);
  const knownHeaderMatch =
    headerCellsFromFirst.length >= 2 &&
    (isAssessmentInfoHeader(headerCellsFromFirst) ||
      isTaskInstructionsHeader(headerCellsFromFirst) ||
      isStandardTableHeader(headerCellsFromFirst));

  if (!valid && knownHeaderMatch && tableLines.length >= 2) {
    numCols = headerCellsFromFirst.length;
    maxCols = Math.max(...tableLines.map((l) => splitTableRow(l, useTabs).length), numCols);
    valid = true;
  }

  if (valid && numCols != null) {
    const isAssessmentInfo =
      headerCellsFromFirst.length >= 2 && isAssessmentInfoHeader(headerCellsFromFirst);
    let mergeCols = isAssessmentInfo && (maxCols ?? numCols) > numCols ? (maxCols ?? numCols) : numCols;
    if (isAssessmentInfo && mergeCols < 3) mergeCols = 3;

    const isTaskInstructions =
      headerCellsFromFirst.length >= 2 && isTaskInstructionsHeader(headerCellsFromFirst);
    const merged = mergeContinuationLinesIntoRows(tableLines, useTabs, mergeCols, {
      isAssessmentInfo: isAssessmentInfo && numCols >= 2,
      isTaskInstructions: isTaskInstructions && numCols >= 3,
    });
    if (merged.length < 2) {
      if (headingBlock)
        return [headingBlock, { type: 'paragraph', content: tableLines.join('\n') }];
      return [{ type: 'paragraph', content: chunk }];
    }

    const normalized = normalizeTableRows(merged, mergeCols);
    const headerRow = normalized[0]!;
    const dataRows = normalized.slice(1);
    const headerCells = headerRow.map((c) => c.trim()).filter(Boolean);

    if (headerCells.length >= 2 && isAssessmentInfoHeader(headerCells)) {
      const { headers, rows, rowNumbers } = parseAssessmentInfoTable(headerRow, dataRows);
      const tableBlock: ParsedTableBlock = {
        type: 'table',
        headers,
        rows,
        meta: { rowNumbers, sourcePattern: 'assessment-info' },
      };
      if (headingBlock) return [headingBlock, tableBlock];
      return [tableBlock];
    }

    if (isLikelyListContentAsHeader(headerCells)) {
      if (headingBlock)
        return [headingBlock, { type: 'paragraph', content: tableLines.join('\n') }];
      return [{ type: 'paragraph', content: chunk }];
    }

    const { headers, rows } = parseStandardTable(headerRow, dataRows);
    const tableBlock: ParsedTableBlock = {
      type: 'table',
      headers,
      rows,
      meta: { sourcePattern: 'standard-table' },
    };
    if (headingBlock) return [headingBlock, tableBlock];
    return [tableBlock];
  }

  if (headingBlock && tableLines.length > 0) {
    headingBlock.content = tableLines.join('\n');
    return [headingBlock];
  }
  const headerlessAssessment = tryParseHeaderlessAssessmentInfoTable(lines);
  if (headerlessAssessment) {
    if (headingBlock) return [headingBlock, headerlessAssessment];
    return [headerlessAssessment];
  }
  return [{ type: 'paragraph', content: chunk }];
}

// ---------------------------------------------------------------------------
// MAIN PARSER
// ---------------------------------------------------------------------------

/**
 * Parse mixed content (paragraphs + tables) from pasted text.
 */
export function parseMixedContent(input: string): ParsedBlock[] {
  const normalized = normalizePastedText(input);
  if (!normalized) return [];

  const chunks = splitIntoLogicalBlocks(normalized);
  const result: ParsedBlock[] = [];

  for (const chunk of chunks) {
    const parsed = parseChunk(chunk);
    for (const b of parsed) {
      if (b.type === 'paragraph') {
        if (b.content.length > 0 || (b.heading && b.heading.length > 0)) {
          result.push(b);
        }
      } else if (b.rows.length > 0) {
        result.push(b);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// I. UI AUTO-CREATE ROWS - STRIP LEADING ROW NUMBER
// ---------------------------------------------------------------------------

function stripHtmlForCheck(s: string): string {
  return String(s ?? '').replace(/<[^>]*>/g, '').trim();
}

/**
 * Strip leading numeric column and map to 2 visible columns for assessment tables.
 * Rule 21: 2 cells → direct; 3 cells + first numeric → ignore numeric, map 2; 4+ cells + first numeric → merge middle into left, last into right.
 */
export function stripLeadingRowNumberColumn(
  rows: Array<{ cells?: string[] }>,
  expectedCols: number
): Array<{ cells: string[] }> {
  if (expectedCols !== 2) return rows.map((r) => ({ cells: r.cells ?? [] }));

  return rows.map((r) => {
    const cells = r.cells ?? [];
    if (cells.length === 2) {
      return { cells: [cells[0] ?? '', cells[1] ?? ''] };
    }
    if (cells.length >= 3) {
      const firstPlain = stripHtmlForCheck(cells[0] ?? '');
      if (extractLeadingRowNumber(firstPlain).isRowNumber) {
        if (cells.length === 3) {
          return { cells: [cells[1] ?? '', cells[2] ?? ''] };
        }
        const middle = cells.slice(1, -1).filter((c) => (c ?? '').trim());
        const left = middle.join('\n');
        const right = cells[cells.length - 1] ?? '';
        return { cells: [left, right] };
      }
    }
    if (cells.length >= 2) return { cells: [cells[0] ?? '', cells[1] ?? ''] };
    if (cells.length === 1) return { cells: [cells[0] ?? '', ''] };
    return { cells: ['', ''] };
  });
}
