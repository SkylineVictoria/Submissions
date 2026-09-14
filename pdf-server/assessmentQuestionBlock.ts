/**
 * Shared Skyline assessment question block (PDF HTML).
 * Used by both live `/pdf` (index.ts) and worker (htmlGenerator.ts) so
 * Assessment 1 / 2 / 3 share one professional workbook layout.
 *
 * Presentation only — does not alter question text, answers, or workflow.
 */

/** Print-safe CSS for question tables. Outer box owns the full rectangle. */
export const ASSESSMENT_QUESTION_BLOCK_CSS = `
    /* Shared assessment question block — print-safe borders + surface hierarchy */
    .task-q-question-box {
      border: 1px solid #BFC4CC;
      margin: 0 0 14px 0;
      padding: 0;
      background: #ffffff;
      box-sizing: border-box;
      page-break-inside: avoid;
      break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .task-q-question-box.task-q-first-question {
      page-break-before: avoid;
      break-before: avoid;
    }
    .task-q-question-box:last-child { margin-bottom: 0; }
    .task-q-question-box.page-break-after { page-break-after: always; }

    .task-q-question-box .task-questions-table {
      width: 100% !important;
      max-width: 100% !important;
      border-collapse: collapse !important;
      border-spacing: 0 !important;
      table-layout: fixed !important;
      margin: 0 !important;
      border: none !important;
      background: transparent !important;
    }
    .task-q-question-box .task-questions-table > tbody > tr {
      background: transparent !important;
    }
    .task-q-question-box .task-questions-table > tbody > tr.task-q-row-top {
      page-break-inside: avoid;
      break-inside: avoid;
      page-break-after: avoid;
      break-after: avoid;
    }

    /* Reset global th/td black borders inside the question shell */
    .task-q-question-box .task-questions-table > tbody > tr > th,
    .task-q-question-box .task-questions-table > tbody > tr > td {
      border: none !important;
      box-sizing: border-box !important;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .task-q-question-box .task-questions-table .task-q-num-cell {
      width: 9% !important;
      vertical-align: top !important;
      padding: 6pt 5pt !important;
      background: #F8F9FA !important;
      border-right: 1px solid #D1D5DB !important;
      border-bottom: 1px solid #D1D5DB !important;
      font-weight: 600;
      font-size: 10pt;
      color: #000000;
      text-align: left;
    }
    .task-q-question-box .task-questions-table .task-q-num {
      font-weight: 600;
      font-size: 10pt;
      line-height: 1.3;
      margin: 0;
      padding: 0;
    }

    .task-q-question-box .task-questions-table .task-q-question-label-cell {
      width: 71% !important;
      vertical-align: top !important;
      padding: 6pt 8pt !important;
      background: #F8F9FA !important;
      border-right: 1px solid #D1D5DB !important;
      border-bottom: 1px solid #D1D5DB !important;
      text-align: left;
    }

    .task-q-question-box .task-questions-table .task-q-satisfactory-cell {
      width: 20% !important;
      vertical-align: top !important;
      padding: 5pt 6pt !important;
      background: #F8F9FA !important;
      border-bottom: 1px solid #D1D5DB !important;
      border-right: none !important;
      text-align: center;
    }

    .task-q-question-box .task-questions-table .task-q-answer-cell,
    .task-q-question-box .task-questions-table .task-q-answer-full {
      width: 100% !important;
      vertical-align: top !important;
      padding: 0 !important;
      background: #F5F7FF !important;
      border: none !important;
    }

    .task-q-question-label {
      margin: 0;
      padding: 0;
      color: #000000;
      font-size: 10pt;
      line-height: 1.35;
      text-align: left;
    }
    .task-q-label-line {
      display: block;
      margin: 0;
      padding: 0;
      text-indent: 0;
      margin-left: 0;
      padding-left: 0;
      font-weight: 400;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .task-q-label-line + .task-q-label-line {
      margin-top: 2pt;
    }
    .task-q-label-line.task-q-label-main {
      font-weight: 600;
    }
    .task-q-label-line .task-q-note-label {
      font-weight: 600;
    }
    .task-q-text-above-header {
      font-weight: 600;
      font-size: 10pt;
      margin: 4pt 0 0 0;
      color: #000000;
    }

    .task-q-satisfactory-header {
      font-weight: 600;
      font-size: 9pt;
      line-height: 1.25;
      margin: 0 0 4pt 0;
      color: #000000;
    }
    .task-q-satisfactory-cell .task-q-radio-group {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 10pt;
    }
    .task-q-satisfactory-cell .task-q-radio {
      display: inline-flex;
      align-items: center;
      gap: 4pt;
      font-size: 9pt;
      font-weight: 500;
      white-space: nowrap;
    }
    .task-q-satisfactory-cell .task-q-radio .radio-circle {
      width: 15px;
      height: 15px;
      border: 1px solid #374151;
      border-radius: 50%;
      flex-shrink: 0;
      box-sizing: border-box;
      display: inline-block;
    }
    .task-q-satisfactory-cell .task-q-radio .radio-circle.filled {
      background: #000000;
      border-color: #000000;
    }

    .task-q-answer-block {
      padding: 10pt 12pt;
      min-height: 36px;
      font-size: 10pt;
      line-height: 1.35;
      background: #F5F7FF !important;
      box-sizing: border-box;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: pre-line;
      border: none;
      margin: 0;
    }
    .task-q-answer-block.task-q-answer-large {
      min-height: 96px;
    }

    .task-q-content-block,
    .task-q-additional-grid {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
    }
    .task-q-content-block.mt-3,
    .task-q-content-block {
      margin-top: 8pt;
      padding: 0 8pt 8pt 8pt;
    }
    .task-q-additional-grid table {
      min-width: 0;
      width: 100% !important;
      table-layout: fixed !important;
    }

    /* Inner grids keep their own solid borders; do not inherit question-shell resets */
    .task-q-question-box .task-questions-table .task-q-inner-table th,
    .task-q-question-box .task-questions-table .task-q-inner-table td,
    .task-q-question-box .task-q-inner-table th,
    .task-q-question-box .task-q-inner-table td {
      border: 1px solid #595959 !important;
      color: #000000;
      white-space: pre-line;
      background: #ffffff !important;
    }
    .task-q-question-box .task-questions-table .task-q-inner-table th,
    .task-q-question-box .task-q-inner-table th {
      background: #595959 !important;
      color: #ffffff !important;
      font-weight: 700;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .task-q-question-box .grid-table-no-border th,
    .task-q-question-box .grid-table-no-border td {
      border: 1px solid #000 !important;
    }
`;

/** Escape text for HTML text nodes (not attributes). */
export function escapePdfText(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render question label with each line as its own block so a)/b)/c)/Note:/URLs
 * share the same left edge inside the content column (never under the Q-number).
 * Does not alter wording — only wraps existing lines.
 */
export function questionContentLabelHtml(s: string | null | undefined): string {
  if (s == null) return '';
  const raw = String(s);
  if (!raw.trim()) return '';
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const parts: string[] = [];
  let sawMain = false;
  for (const line of lines) {
    const escaped = escapePdfText(line);
    if (!line.trim()) {
      parts.push('<span class="task-q-label-line task-q-label-blank">&nbsp;</span>');
      continue;
    }
    const noteMatch = line.match(/^(\s*)(Note:\s*)(.*)$/i);
    if (noteMatch) {
      const noteLead = escapePdfText(noteMatch[1]);
      const noteLabel = escapePdfText(noteMatch[2]);
      const noteRest = escapePdfText(noteMatch[3]);
      parts.push(
        `<span class="task-q-label-line task-q-label-note">${noteLead}<span class="task-q-note-label">${noteLabel}</span>${noteRest}</span>`
      );
      continue;
    }
    if (!sawMain) {
      parts.push(`<span class="task-q-label-line task-q-label-main">${escaped}</span>`);
      sawMain = true;
    } else {
      parts.push(`<span class="task-q-label-line">${escaped}</span>`);
    }
  }
  return `<div class="task-q-question-label">${parts.join('')}</div>`;
}

export function renderSatisfactoryCellHtml(satYes: boolean, satNo: boolean): string {
  return (
    '<div class="task-q-satisfactory-header">Satisfactory<br/>Response</div>' +
    '<div class="task-q-radio-group">' +
    `<div class="task-q-radio"><span class="radio-circle${satYes ? ' filled' : ''}"></span>Yes</div>` +
    `<div class="task-q-radio"><span class="radio-circle${satNo ? ' filled' : ''}"></span>No</div>` +
    '</div>'
  );
}

/**
 * Open a question block: outer box + 3-column header + answer cell start.
 * Caller appends answer / grid / content-block HTML, then calls renderQuestionBlockClose().
 */
export function renderQuestionBlockOpen(opts: {
  qNum: number;
  contentCellHtml: string;
  satYes: boolean;
  satNo: boolean;
  boxClass: string;
}): string {
  const { qNum, contentCellHtml, satYes, satNo, boxClass } = opts;
  return (
    `<div class="${boxClass}">` +
    '<table class="section-table task-questions-table" role="presentation"><tbody>' +
    '<tr class="task-q-row-top">' +
    `<td class="task-q-num-cell"><div class="task-q-num">Q${qNum}</div></td>` +
    `<td class="task-q-question-label-cell">${contentCellHtml}</td>` +
    `<td class="task-q-satisfactory-cell">${renderSatisfactoryCellHtml(satYes, satNo)}</td>` +
    '</tr>' +
    '<tr class="task-q-row-bottom">' +
    '<td colspan="3" class="task-q-answer-cell task-q-answer-full">'
  );
}

export function renderQuestionBlockClose(): string {
  return '</td></tr></tbody></table></div>';
}
