import { escapeImgSrc } from './pdfConstants.js';

type InstructionBlockRow = { heading?: string; content?: string; cells?: string[] };
type InstructionBlock = {
  id?: string;
  type?: string;
  heading?: string;
  content?: string;
  imageUrl?: string;
  imageFullWidth?: boolean;
  imageLayout?: string;
  imageSide?: string;
  columnHeaders?: string[];
  rows?: InstructionBlockRow[];
};

function wrapInstructionContentWithImage(contentHtml: string, block: Record<string, unknown>): string {
  const imageUrl = String(block.imageUrl || '').trim();
  if (!imageUrl) return contentHtml;
  const fullWidth = Boolean(block.imageFullWidth);
  const layoutRaw = String(block.imageLayout || 'below');
  const layout = layoutRaw === 'above' || layoutRaw === 'side_by_side' || layoutRaw === 'below' ? layoutRaw : 'below';
  const side = String(block.imageSide || 'right') === 'left' ? 'left' : 'right';
  const imgStyle = fullWidth
    ? 'max-width:100%;width:100%;height:auto;max-height:520px;object-fit:contain;border:1px solid #e5e7eb;border-radius:6px;display:block;margin:0 auto;'
    : 'max-width:100%;height:auto;max-height:280px;object-fit:contain;border:1px solid #e5e7eb;border-radius:6px;';
  const img = `<img src="${escapeImgSrc(imageUrl, 'instruction-block-image')}" alt="" loading="eager" style="${imgStyle}" />`;
  if (fullWidth || layout === 'above') {
    return `<div>${img}<div style="margin-top:10px">${contentHtml}</div></div>`;
  }
  if (layout === 'side_by_side') {
    const imgCell = `<div style="width:40%;flex-shrink:0">${img}</div>`;
    const textCell = `<div style="flex:1;min-width:0">${contentHtml}</div>`;
    return side === 'left'
      ? `<div style="display:flex;gap:14px;align-items:flex-start">${imgCell}${textCell}</div>`
      : `<div style="display:flex;gap:14px;align-items:flex-start">${textCell}${imgCell}</div>`;
  }
  return `<div>${contentHtml}<div style="margin-top:10px">${img}</div></div>`;
}

export function renderInstructionsDataHtml(
  instr: Record<string, unknown> | null | undefined,
  normalizeNbspProse: (s: string) => string
): string {
  if (!instr) return '';
  let html = '';
  const customBlocks = Array.isArray(instr.blocks) ? (instr.blocks as InstructionBlock[]) : [];

  if (customBlocks.length > 0) {
    for (const b of customBlocks) {
      const heading = String(b.heading || '').trim();
      const bRec = b as unknown as Record<string, unknown>;
      if (b.type === 'table') {
        if (heading) html += `<div class="task-instructions-block-title">${heading.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const columnHeaders = Array.isArray(b.columnHeaders) ? b.columnHeaders : [];
        if (rows.length > 0) {
          let tableHtml = '<table class="section-table task-instructions-table">';
          if (columnHeaders.length > 0) {
            tableHtml += '<thead><tr>';
            for (const h of columnHeaders) {
              tableHtml += `<th class="label-cell" style="font-weight:700;border:1px solid #000;padding:6px 8px;text-align:left">${String(h).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</th>`;
            }
            tableHtml += '</tr></thead>';
          }
          tableHtml += '<tbody>';
          for (const r of rows) {
            const cells = r.cells;
            if (Array.isArray(cells) && cells.length > 0) {
              tableHtml += '<tr>';
              for (const c of cells) {
                tableHtml += `<td class="value-cell" style="border:1px solid #000;padding:6px 8px">${normalizeNbspProse(String(c ?? ''))}</td>`;
              }
              tableHtml += '</tr>';
            } else {
              tableHtml += '<tr>';
              tableHtml += `<td class="label-cell" style="width:35%;font-weight:700;border:1px solid #000;padding:6px 8px">${String(r.heading || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`;
              tableHtml += `<td class="value-cell" style="border:1px solid #000;padding:6px 8px">${normalizeNbspProse(String(r.content || ''))}</td>`;
              tableHtml += '</tr>';
            }
          }
          tableHtml += '</tbody></table>';
          html += wrapInstructionContentWithImage(tableHtml, bRec);
        }
      } else {
        const hasText = !!String(b.content || '').replace(/<[^>]*>/g, '').trim();
        const hasImg = !!String((bRec as { imageUrl?: unknown }).imageUrl || '').trim();
        if (!hasText && !hasImg) continue;
        if (heading) html += `<div class="task-instructions-block-title">${heading.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
        const contentHtml = hasText
          ? `<div class="task-instructions-block-content">${normalizeNbspProse(String(b.content || ''))}</div>`
          : `<div class="task-instructions-block-content"></div>`;
        html += wrapInstructionContentWithImage(contentHtml, bRec);
      }
    }
    return html;
  }

  const blocks: { title: string; content: string }[] = [
    { title: 'Assessment type', content: String(instr.assessment_type || '') },
    { title: 'Instructions provided to the student:', content: String(instr.task_description || '') },
    { title: 'Applicable conditions:', content: String(instr.applicable_conditions || '') },
    { title: 'Resubmissions and reattempts:', content: String(instr.resubmissions || '') },
    {
      title: 'Location:',
      content:
        String(instr.location_intro || '') +
        (Array.isArray(instr.location_options)
          ? '<ul><li>' + (instr.location_options as string[]).map((o) => o).join('</li><li>') + '</li></ul>'
          : '') +
        String(instr.location_note || ''),
    },
    { title: 'Instructions for answering the written questions:', content: String(instr.answering_instructions || '') },
    { title: 'Purpose of the assessment', content: String(instr.purpose_intro || '') + String(instr.purpose_bullets || '') },
    { title: 'Task instructions', content: String(instr.task_instructions || '') },
  ];
  for (const b of blocks) {
    if (b.content && b.content.replace(/<[^>]*>/g, '').trim()) {
      html += `<div class="task-instructions-block"><div class="task-instructions-block-title">${b.title}</div><div class="task-instructions-block-content">${normalizeNbspProse(b.content)}</div></div>`;
    }
  }
  return html;
}

export function renderTaskQuestionInstructionHtml(
  question: { label?: string | null; help_text?: string | null; pdf_meta?: Record<string, unknown> | null },
  normalizeNbspProse: (s: string) => string,
  labelToHtml: (s: string) => string
): string {
  const pm = (question.pdf_meta as Record<string, unknown>) || {};
  const instr = pm.instructions as Record<string, unknown> | undefined;
  const richHtml = instr ? renderInstructionsDataHtml(instr, normalizeNbspProse) : '';
  if (richHtml) {
    return `<div class="task-q-instruction-block task-q-content-block">${richHtml}</div>`;
  }
  const help = String(question.help_text || '').trim();
  const label = String(question.label || '').trim();
  if (help) {
    return `<div class="task-q-instruction-block task-q-content-block"><div class="task-q-additional-instruction">${help.replace(/\n/g, '<br/>')}</div></div>`;
  }
  if (label && label !== 'Instruction' && label !== 'New Instruction') {
    return `<div class="task-q-instruction-block task-q-content-block"><div class="task-q-additional-instruction">${labelToHtml(label)}</div></div>`;
  }
  return '';
}
