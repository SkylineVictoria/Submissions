import { useState, useEffect, useRef } from 'react';
import { parseMixedContent as parseMixedContentUtil, stripLeadingRowNumberColumn } from '../../utils/parseMixedContent';
import type { ParsedTableBlock } from '../../utils/parseMixedContent';
import { parseInputToInstructionBlocks } from '../../utils/parseInstructionInput';
import { RichTextEditor } from '../ui/RichTextEditor';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import { uploadInstructionImage } from '../../lib/storage';

export type InstructionBlockType = 'paragraph' | 'table';
export type InstructionImageLayout = 'above' | 'below' | 'side_by_side';
export interface InstructionTableRow {
  heading?: string;
  content?: string;
  /** Multi-column cells; when present, used instead of heading/content */
  cells?: string[];
}
export interface InstructionBlock {
  id: string;
  type: InstructionBlockType;
  heading?: string;
  content?: string;
  imageUrl?: string;
  rows?: InstructionTableRow[];
  /** Column headers for multi-column tables */
  columnHeaders?: string[];
}
export interface TaskInstructionsData {
  blocks?: InstructionBlock[];
  assessment_type?: string;
  task_description?: string;
  applicable_conditions?: string;
  resubmissions?: string;
  location_intro?: string;
  location_options?: string[];
  location_note?: string;
  answering_instructions?: string;
  purpose_intro?: string;
  purpose_bullets?: string;
  task_instructions?: string;
}

interface TaskInstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rowLabel: string;
  initialData?: TaskInstructionsData | null;
  /** Fallback for assessment_type when instructions don't have it (e.g. from row_help: "Written Assignment (WA)") */
  rowHelpFallback?: string | null;
  onSave: (data: TaskInstructionsData) => void;
  uploadTarget?: { scope: 'task_row' | 'section'; id: number } | null;
}

export function TaskInstructionsModal({
  isOpen,
  onClose,
  rowLabel,
  initialData,
  rowHelpFallback,
  onSave,
  uploadTarget = null,
}: TaskInstructionsModalProps) {
  const [data, setData] = useState<TaskInstructionsData>({});
  const [pasteDraftByBlock, setPasteDraftByBlock] = useState<Record<string, string>>({});
  const [autoCreatingBlockId, setAutoCreatingBlockId] = useState<string | null>(null);
  const [smartPasteInput, setSmartPasteInput] = useState('');
  const [smartPasteHtml, setSmartPasteHtml] = useState('');
  const [docxImporting, setDocxImporting] = useState(false);
  const docxInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImgBlockId, setUploadingImgBlockId] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const escapeHtml = (input: string): string =>
    input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /** Convert plain text to HTML, handling bullets (• - – *), numbered (1. 2) a. (i)), and paragraphs. */
  const plainTextToHtml = (input: string): string => {
    const nonEmpty = input.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) return '';

    const parts: string[] = [];
    const paragraphBuffer: string[] = [];
    let listMode: 'ol' | 'ul' | null = null;
    let listItems: string[] = [];

    const flushParagraph = () => {
      if (paragraphBuffer.length > 0) {
        parts.push(`<p>${paragraphBuffer.join('<br/>')}</p>`);
        paragraphBuffer.length = 0;
      }
    };

    const flushList = () => {
      if (listMode && listItems.length > 0) {
        parts.push(`<${listMode}><li>${listItems.join('</li><li>')}</li></${listMode}>`);
      }
      listMode = null;
      listItems = [];
    };

    const isBullet = (line: string) => /^[•\-–*]\s/.test(line.trimStart());
    const numberedMatch = (line: string) =>
      line.match(/^\d+\.\s+(.*)$/) ||
      line.match(/^\d+\)\s+(.*)$/) ||
      line.match(/^[a-zA-Z]\.\s+(.*)$/) ||
      line.match(/^\([iIvVxXdDlLcCmM0-9]+\)\s+(.*)$/);

    for (const rawLine of nonEmpty) {
      const line = rawLine.trimStart();
      const numMatch = numberedMatch(line);
      if (numMatch) {
        flushParagraph();
        if (listMode !== 'ol') flushList();
        listMode = 'ol';
        listItems.push(escapeHtml(numMatch[1] || line));
        continue;
      }
      if (isBullet(line)) {
        flushParagraph();
        if (listMode !== 'ul') flushList();
        listMode = 'ul';
        const content = line.replace(/^[•\-–*]\s+/, '').trim() || line;
        listItems.push(escapeHtml(content));
        continue;
      }
      if (listMode && listItems.length > 0) {
        listItems[listItems.length - 1] += `<br/>${escapeHtml(line)}`;
      } else {
        paragraphBuffer.push(escapeHtml(line));
      }
    }

    flushParagraph();
    flushList();
    return parts.join('');
  };

  /** Convert cell plain text (with bullets, numbers, newlines) to HTML for table cells. */
  const cellContentToHtml = (input: string): string => {
    if (!input || !input.trim()) return '';
    return plainTextToHtml(input);
  };

  type ParseResult = { rows: InstructionTableRow[]; columnHeaders?: string[] };

  const parsePastedTableRows = (input: string): ParseResult => {
    const rawLines = input.split(/\r?\n/).map((l) => l.trimEnd());
    const lines = rawLines.filter((l) => l.trim().length > 0);

    if (lines.length === 0) return { rows: [] };

    const looksLikeNumberedListContent = (): boolean => {
      if (lines.length < 2) return false;
      const first = lines[0] ?? '';
      const tabParts = first.split(/\t/);
      if (tabParts.length >= 3) return false;
      const hasLeadingNum = /^\d+[.)]\s/.test(first) || /^\d+[.)]\t/.test(first);
      const second = lines[1] ?? '';
      const secondHasNum = /^\d+[.)]\s/.test(second) || /^\d+[.)]\t/.test(second);
      return hasLeadingNum && secondHasNum && first.length > 10;
    };

    if (looksLikeNumberedListContent()) {
      const fullContent = lines.join('\n');
      return {
        rows: [{ cells: ['', plainTextToHtml(fullContent)] }],
        columnHeaders: undefined,
      };
    }

    // 1. Tab-delimited with multiline cells (Task / Instructions / Evidence format)
    const hasTabs = input.includes('\t');
    const firstLine = lines[0] || '';
    const isTaskInstructionsFormat =
      hasTabs &&
      /task/i.test(firstLine) &&
      (/instruction/i.test(firstLine) || /evidence/i.test(firstLine));
    if (isTaskInstructionsFormat) {
      const headerCells = firstLine.split(/\t/).map((p) => p.trim()).filter(Boolean);
      if (headerCells.length >= 2) {
        const columnHeaders = headerCells;
        const numCols = columnHeaders.length;
        const rowStarts: number[] = [];
        for (let i = 1; i < lines.length; i++) {
          if (/^\d+\.\s/.test(lines[i])) rowStarts.push(i);
        }
        if (rowStarts.length > 0) {
          const rowBlocks: string[] = [];
          for (let r = 0; r < rowStarts.length; r++) {
            const start = rowStarts[r];
            const end = rowStarts[r + 1] ?? lines.length;
            rowBlocks.push(lines.slice(start, end).join('\n'));
          }
          const rows: InstructionTableRow[] = rowBlocks.map((block) => {
            const cells = block.split(/\t/).map((c) => c.trim());
            const padded = Array.from({ length: numCols }, (_, i) => {
              const val = cells[i] ?? '';
              return plainTextToHtml(val);
            });
            return { cells: padded };
          });
          const valid = rows.filter((r) => (r.cells ?? []).some((c) => c.replace(/<[^>]*>/g, '').trim().length > 0));
          if (valid.length > 0) return { rows: valid, columnHeaders };
        }
      }
    }

    // 2. Tab-delimited table (header row + data rows, one line per row)
    if (hasTabs) {
      const allParts = lines.map((l) => l.split(/\t+/).map((p) => p.trim()));
      const colCounts = allParts.map((p) => p.length);
      const minCols = Math.min(...colCounts);
      if (minCols >= 2) {
        const headerLine = allParts[0].slice(0, Math.max(minCols, allParts[0].length));
        const numCols = headerLine.length;
        const columnHeaders = headerLine;
        const rows: InstructionTableRow[] = allParts.slice(1).map((cells) => ({
          cells: Array.from({ length: numCols }, (_, i) => String(cells[i] ?? '').trim()),
        }));
        const valid = rows.filter((r) => (r.cells ?? []).some((c) => c.length > 0));
        if (valid.length > 0) return { rows: valid, columnHeaders };
      }
    }

    // 2. Multi-space delimited table (2+ spaces between columns)
    const hasMultiSpace = lines.some((l) => /\s{2,}/.test(l));
    if (hasMultiSpace) {
      const allParts = lines.map((l) => l.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean));
      const minCols = Math.min(...allParts.map((p) => p.length));
      if (minCols >= 2) {
        const headerLine = allParts[0];
        const dataLines = allParts.slice(1);
        const columnHeaders = headerLine;
        const rows: InstructionTableRow[] = dataLines.map((cells) => ({
          cells: headerLine.map((_, i) => String(cells[i] ?? '').trim()),
        }));
        const valid = rows.filter((r) => (r.cells ?? []).some((c) => c.length > 0));
        if (valid.length > 0) return { rows: valid, columnHeaders };
      }
    }

    // 3. Hazard/Risk/Consequence/Control Measures format (single spaces, 4 columns)
    const isHazardRiskFormat =
      /hazard/i.test(lines[0]) && /risk/i.test(lines[0]) && /consequence/i.test(lines[0]) && /control/i.test(lines[0]);
    if (isHazardRiskFormat && lines.length > 1) {
      const columnHeaders = ['Hazard', 'Risk', 'Consequence', 'Control Measures'];
      const dataLines = lines.slice(1);
      const rows: InstructionTableRow[] = dataLines.map((line) => {
        const words = line.split(/\s+/);
        if (words.length >= 4) {
          const hazard = words.slice(0, 2).join(' ').trim();
          const risk = words.slice(2, 4).join(' ').trim();
          const consequence = words.slice(4, 6).join(' ').trim();
          const controlMeasures = words.slice(6).join(' ').trim();
          return { cells: [hazard, risk, consequence, controlMeasures] };
        }
        if (words.length >= 3) {
          return { cells: [words[0], words[1], words.slice(2).join(' '), ''] };
        }
        return { cells: [words[0] || '', words.slice(1).join(' '), '', ''] };
      });
      const valid = rows.filter((r) => (r.cells ?? []).some((c) => c.length > 0));
      if (valid.length > 0) return { rows: valid, columnHeaders };
    }

    // 3b. Category/Item/Estimated Cost format (3 columns, single spaces)
    const isCategoryItemFormat = /category/i.test(lines[0]) && /item/i.test(lines[0]) && lines.length > 1;
    if (isCategoryItemFormat) {
      const columnHeaders = ['Category', 'Item', 'Estimated Cost (AUD)'];
      const dataLines = lines.slice(1);
      const rows: InstructionTableRow[] = dataLines.map((line) => {
        const words = line.split(/\s+/);
        if (words.length >= 3) {
          const last = words[words.length - 1];
          const hasCost = /^[\d$€£]|^\d|^AUD/i.test(last) || /\d/.test(last);
          const category = words[0];
          const cost = hasCost ? last : '';
          const item = hasCost ? words.slice(1, -1).join(' ') : words.slice(1).join(' ');
          return { cells: [category, item, cost] };
        }
        return { cells: [words[0] || '', words.slice(1).join(' '), ''] };
      });
      const valid = rows.filter((r) => (r.cells ?? []).some((c) => c.length > 0));
      if (valid.length > 0) return { rows: valid, columnHeaders };
    }

    // 4. Original format: numbered rows with tab or 2+ space separation
    const numberedRows: Array<{ index: string; heading: string; contentLines: string[] }> = [];
    let current: { index: string; heading: string; contentLines: string[] } | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (/^assessment information\s+description$/i.test(line.replace(/\t+/g, ' '))) continue;

      const rowMatch = line.match(/^(\d+)\s*(?:\t+|\s{2,})(.+)$/);
      if (rowMatch) {
        if (current) numberedRows.push(current);
        const index = rowMatch[1];
        const rest = rowMatch[2].trim();
        const tabParts = rest.split(/\t+/).map((p) => p.trim()).filter(Boolean);
        const spaceParts = rest.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
        const parts = tabParts.length >= 2 ? tabParts : spaceParts;
        const heading = parts.length >= 2 ? parts[0] : rest;
        const content = parts.length >= 2 ? parts.slice(1).join(' ') : '';
        current = { index, heading, contentLines: content ? [content] : [] };
        continue;
      }

      if (current) current.contentLines.push(line);
    }
    if (current) numberedRows.push(current);

    const rows = numberedRows
      .map((r) => ({
        heading: `${r.index}. ${r.heading}`.trim(),
        content: plainTextToHtml(r.contentLines.join('\n')),
      }))
      .filter((r) => r.heading || String(r.content || '').replace(/<[^>]*>/g, '').trim());
    return { rows };
  };

  const handleSmartPaste = async () => {
    const blocks = await parseInputToInstructionBlocks({
      html: smartPasteHtml,
      text: smartPasteInput,
    });
    if (blocks.length === 0) {
      toast.error('No content could be parsed. Try pasting directly from Word (keeps tables), or paste plain text as a fallback.');
      return;
    }
    updateBlocks(() => blocks);
    setSmartPasteInput('');
    setSmartPasteHtml('');
    const pCount = blocks.filter((b) => b.type === 'paragraph').length;
    const tCount = blocks.filter((b) => b.type === 'table').length;
    toast.success(
      `${blocks.length} block${blocks.length === 1 ? '' : 's'} created (${pCount} paragraph${pCount === 1 ? '' : 's'}, ${tCount} table${tCount === 1 ? '' : 's'})`
    );
  };

  const buildLegacyBlocks = (raw?: TaskInstructionsData | null): InstructionBlock[] => {
    if (!raw) return [];
    const existing = Array.isArray(raw.blocks) ? raw.blocks : [];
    if (existing.length > 0) {
      return existing.map((b, idx) => ({
        id: String(b.id || `block-${idx + 1}`),
        type: b.type === 'table' ? 'table' : 'paragraph',
        heading: String(b.heading || ''),
        content: String(b.content || ''),
        imageUrl: String((b as { imageUrl?: string }).imageUrl || '') || undefined,
        columnHeaders: Array.isArray((b as { columnHeaders?: string[] }).columnHeaders)
          ? (b as { columnHeaders: string[] }).columnHeaders
          : undefined,
        rows: Array.isArray(b.rows)
          ? b.rows.map((r) => ({
              heading: String(r.heading || ''),
              content: String(r.content || ''),
              cells: Array.isArray(r.cells) ? r.cells.map(String) : undefined,
            }))
          : [],
      }));
    }

    const pairs: Array<{ heading: string; content: string }> = [
      { heading: 'Assessment type', content: String(raw.assessment_type || '') },
      { heading: 'Instructions provided to the student', content: String(raw.task_description || '') },
      { heading: 'Applicable conditions', content: String(raw.applicable_conditions || '') },
      { heading: 'Resubmissions and reattempts', content: String(raw.resubmissions || '') },
      {
        heading: 'Location',
        content:
          String(raw.location_intro || '') +
          (Array.isArray(raw.location_options) && raw.location_options.length
            ? `<ul><li>${raw.location_options.join('</li><li>')}</li></ul>`
            : '') +
          String(raw.location_note || ''),
      },
      { heading: 'Instructions for answering the written questions', content: String(raw.answering_instructions || '') },
      { heading: 'Purpose of the assessment', content: String(raw.purpose_intro || '') + String(raw.purpose_bullets || '') },
      { heading: 'Task instructions', content: String(raw.task_instructions || '') },
    ];
    return pairs
      .filter((p) => p.content.replace(/<[^>]*>/g, '').trim())
      .map((p, idx) => ({
        id: `legacy-${idx + 1}`,
        type: 'paragraph' as const,
        heading: p.heading,
        content: p.content,
      }));
  };

  /** Extract plain text from HTML for assessment_type. */
  const stripHtml = (html: string): string =>
    String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  useEffect(() => {
    if (isOpen) {
      const blocks = buildLegacyBlocks(initialData);
      let assessmentType = initialData?.assessment_type ?? '';
      if (!assessmentType && blocks.length > 0) {
        const atBlock = blocks.find(
          (b) => b.type === 'paragraph' && String(b.heading || '').toLowerCase() === 'assessment type'
        );
        if (atBlock?.content) assessmentType = stripHtml(atBlock.content);
      }
      if (!assessmentType && rowHelpFallback) {
        assessmentType = String(rowHelpFallback).trim();
      }
      setData({
        ...(initialData ? { ...initialData } : {}),
        assessment_type: assessmentType,
        blocks,
      });
      setPasteDraftByBlock({});
      setSmartPasteInput('');
    }
  }, [isOpen, initialData, rowHelpFallback]);

  const updateBlocks = (updater: (prev: InstructionBlock[]) => InstructionBlock[]) => {
    setData((prev) => ({ ...prev, blocks: updater(Array.isArray(prev.blocks) ? prev.blocks : []) }));
  };

  const addBlock = (type: InstructionBlockType) => {
    updateBlocks((prev) => [
      ...prev,
      {
        id: `b-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        type,
        heading: '',
        content: '',
        rows: type === 'table' ? [{ heading: '', content: '' }] : [],
      },
    ]);
  };

  const updateBlock = (index: number, patch: Partial<InstructionBlock>) => {
    updateBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const removeBlock = (index: number) => {
    updateBlocks((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTableRow = (blockIndex: number, rowIndex: number, patch: Partial<InstructionTableRow>) => {
    updateBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        const rows = Array.isArray(b.rows) ? b.rows : [];
        return {
          ...b,
          rows: rows.map((r, ri) => (ri === rowIndex ? { ...r, ...patch } : r)),
        };
      })
    );
  };

  const removeTableRow = (blockIndex: number, rowIndex: number) => {
    updateBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        const rows = Array.isArray(b.rows) ? b.rows : [];
        return { ...b, rows: rows.filter((_, ri) => ri !== rowIndex) };
      })
    );
  };

  const addTableRow = (blockIndex: number) => {
    updateBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const headers = b.columnHeaders;
        if (headers?.length) {
          return { ...b, rows: [...rows, { cells: headers.map(() => '') }] };
        }
        return { ...b, rows: [...rows, { heading: '', content: '' }] };
      })
    );
  };

  const updateTableRowCell = (blockIndex: number, rowIndex: number, cellIndex: number, value: string) => {
    updateBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        const rows = Array.isArray(b.rows) ? [...b.rows] : [];
        const row = rows[rowIndex];
        if (!row || !Array.isArray(row.cells)) return b;
        const cells = [...row.cells];
        while (cells.length <= cellIndex) cells.push('');
        cells[cellIndex] = value;
        rows[rowIndex] = { ...row, cells };
        return { ...b, rows };
      })
    );
  };

  const setTableColumnHeaders = (blockIndex: number, inputValue: string) => {
    const headers = inputValue.split(',').map((h) => h.trim());
    updateBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const convertedRows: InstructionTableRow[] =
          headers.length > 0
            ? rows.map((r) => {
                if (Array.isArray(r.cells)) {
                  const cells = [...r.cells];
                  while (cells.length < headers.length) cells.push('');
                  return { ...r, cells: cells.slice(0, headers.length) };
                }
                const cells = [String(r.heading || ''), String(r.content || '')];
                while (cells.length < headers.length) cells.push('');
                return { cells: cells.slice(0, headers.length) };
              })
            : rows.map((r) => {
                if (Array.isArray(r.cells) && r.cells.length > 0) {
                  return { heading: r.cells[0] || '', content: r.cells.slice(1).join(' | ') };
                }
                return { heading: String(r.heading || ''), content: String(r.content || '') };
              });
        const hasAnyHeader = headers.some((h) => h.length > 0);
        return { ...b, columnHeaders: hasAnyHeader ? headers : undefined, rows: convertedRows };
      })
    );
  };

  const handleSave = () => {
    const cleanedBlocks = (data.blocks || [])
      .map((b) => ({
        ...b,
        heading: String(b.heading || '').trim(),
        content: String(b.content || ''),
        imageUrl: b.imageUrl ? String(b.imageUrl).trim() : undefined,
        columnHeaders: Array.isArray(b.columnHeaders) ? b.columnHeaders.filter((h) => String(h).trim()).map(String) : undefined,
        rows: Array.isArray(b.rows)
          ? b.rows
              .map((r) => ({
                heading: String(r.heading || '').trim(),
                content: String(r.content || ''),
                cells: Array.isArray(r.cells) ? r.cells.map(String) : undefined,
              }))
              .filter((r) => {
                if (r.cells?.length) return r.cells.some((c) => c.trim());
                return r.heading || (r.content || '').replace(/<[^>]*>/g, '').trim();
              })
          : [],
      }))
      .filter((b) => {
        if (b.type === 'table') return (b.rows || []).length > 0;
        const hasText = b.content.replace(/<[^>]*>/g, '').trim();
        return !!hasText || !!b.imageUrl;
      })
      .filter((b) => {
        if (b.type === 'paragraph' && String(b.heading || '').toLowerCase() === 'assessment type') return false;
        return true;
      });
    onSave({
      blocks: cleanedBlocks,
      assessment_type: String(data.assessment_type ?? '').trim() || undefined,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit instructions: {rowLabel}</h2>
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Assessment type</label>
            <Textarea
              value={data.assessment_type ?? ''}
              onChange={(e) => setData((prev) => ({ ...prev, assessment_type: e.target.value }))}
              placeholder="e.g. Written Assessment, Practical Assessment. Use new lines for multiple items (e.g. Practical Task 2.1, Practical Task 2.2)"
              rows={3}
              className="min-h-[80px]"
            />
            <p className="text-xs text-gray-500 mt-1">The type of assessment for this task (e.g. written, practical). Use new lines for multiple items. Editable for original and duplicated tasks.</p>
          </div>
          <div className="border border-[var(--brand)]/30 rounded-lg p-4 bg-[var(--brand)]/5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Paste mixed content</h3>
            <p className="text-xs text-gray-600">
              Paste from Word, Google Docs, or any document. Paragraphs and tables will be auto-detected. Separate paragraphs with blank lines. Tables need tab or 2+ spaces between columns.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <input
                ref={docxInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (!file) return;
                  setDocxImporting(true);
                  try {
                    const blocks = await parseInputToInstructionBlocks({ file });
                    if (blocks.length === 0) {
                      toast.error('No content could be parsed from this Word file.');
                      return;
                    }
                    updateBlocks(() => blocks);
                    toast.success(`Imported ${blocks.length} block${blocks.length === 1 ? '' : 's'} from Word`);
                    setSmartPasteInput('');
                    setSmartPasteHtml('');
                  } finally {
                    setDocxImporting(false);
                    // allow re-uploading the same file
                    e.target.value = '';
                  }
                }}
              />
              <Button variant="outline" size="sm" type="button" onClick={() => docxInputRef.current?.click()} disabled={docxImporting}>
                {docxImporting ? (
                  <>
                    <Loader variant="dots" size="sm" inline className="mr-1.5" />
                    Reading Word…
                  </>
                ) : (
                  'Upload Word (.docx)'
                )}
              </Button>
              <div className="text-xs text-gray-500">DOCX/HTML preserve real tables. Plain text is fallback.</div>
            </div>
            <Textarea
              value={smartPasteInput}
              onChange={(e) => setSmartPasteInput(e.target.value)}
              onPaste={(e) => {
                const html = e.clipboardData?.getData('text/html') || '';
                const text = e.clipboardData?.getData('text/plain') || '';
                setSmartPasteHtml(html);
                // Show plain text in the box, but keep HTML for structure-aware parsing.
                if (text) setSmartPasteInput(text);
              }}
              placeholder="Paste your content here... (paragraphs first, then table, or mixed)"
              rows={8}
              className="text-sm font-mono"
            />
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSmartPaste()}
              disabled={!smartPasteInput.trim()}
            >
              Auto-create blocks from paste
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => addBlock('paragraph')}>+ Add paragraph block</Button>
            <Button variant="outline" onClick={() => addBlock('table')}>+ Add table block</Button>
          </div>

          {(data.blocks || []).length === 0 ? (
            <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">
              No instruction blocks yet. Add a paragraph or table block.
            </div>
          ) : (data.blocks || []).map((block, index) => (
            <div key={block.id} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50/40">
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                <div className="sm:w-72">
                  <Select
                    value={block.type}
                    onChange={(v) => updateBlock(index, { type: v as InstructionBlockType, rows: v === 'table' ? (block.rows?.length ? block.rows : [{ heading: '', content: '' }]) : [] })}
                    options={[
                      { value: 'paragraph', label: 'Paragraph block' },
                      { value: 'table', label: 'Table block' },
                    ]}
                  />
                </div>
                <div className="sm:ml-auto">
                  <Button variant="outline" size="sm" onClick={() => removeBlock(index)}>Remove block</Button>
                </div>
              </div>

              {block.type === 'table' ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Table heading (optional)</label>
                    <Input
                      value={block.heading || ''}
                      onChange={(e) => updateBlock(index, { heading: e.target.value })}
                      placeholder="Example: Assessment information"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Column headers (comma-separated)</label>
                    <Input
                      value={Array.isArray(block.columnHeaders) ? block.columnHeaders.join(', ') : ''}
                      onChange={(e) => setTableColumnHeaders(index, e.target.value)}
                      placeholder="e.g. Hazard, Risk, Consequence, Control Measures"
                    />
                    <p className="text-xs text-gray-500 mt-1">Define columns for manual rows. Leave empty for 2-column (heading + content).</p>
                  </div>
                  <div className="border border-dashed border-gray-300 rounded-md p-3 bg-white">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Paste full table text (auto-create rows)</label>
                    <Textarea
                      value={pasteDraftByBlock[block.id] || ''}
                      onChange={(e) => setPasteDraftByBlock((prev) => ({ ...prev, [block.id]: e.target.value }))}
                      rows={6}
                      className="min-h-[120px]"
                      placeholder="Paste table text (tab or 2+ spaces between columns). Hazard/Risk/Consequence/Control Measures format supported."
                    />
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!autoCreatingBlockId}
                        onClick={async () => {
                          const blockId = block.id;
                          const paste = pasteDraftByBlock[blockId] || '';
                          setAutoCreatingBlockId(blockId);
                          await new Promise((r) => setTimeout(r, 300));
                          let parsedRows: InstructionTableRow[];
                          let columnHeaders: string[] | undefined;

                          const parsed = parseMixedContentUtil(paste);
                          const tableBlocks = parsed.filter((b): b is ParsedTableBlock => b.type === 'table');
                          if (tableBlocks.length > 0) {
                            const tb = tableBlocks[0];
                            columnHeaders = tb.headers;
                            parsedRows = tb.rows.map((cells) => ({
                              cells: cells.map((c) => cellContentToHtml(c)),
                            }));
                          } else {
                            const result = parsePastedTableRows(paste);
                            parsedRows = result.rows;
                            columnHeaders = result.columnHeaders ?? block.columnHeaders;
                            const expectedCols = (block.columnHeaders ?? columnHeaders)?.length ?? 0;
                            if (expectedCols === 2 && parsedRows.some((r) => (r.cells ?? []).length >= 2)) {
                              parsedRows = stripLeadingRowNumberColumn(parsedRows, 2);
                            }
                          }

                          setAutoCreatingBlockId(null);
                          if (parsedRows.length > 0) {
                            updateBlock(index, { rows: parsedRows, columnHeaders });
                            toast.success(`${parsedRows.length} row${parsedRows.length === 1 ? '' : 's'} created`);
                          } else {
                            toast.error('No rows could be parsed. Check the format (e.g. number, tab or spaces, text).');
                          }
                        }}
                      >
                        {autoCreatingBlockId === block.id ? (
                          <>
                            <Loader variant="dots" size="sm" inline className="mr-1.5" />
                            Creating…
                          </>
                        ) : (
                          'Auto-create rows'
                        )}
                      </Button>
                    </div>
                  </div>
                  {(block.rows || []).map((row, rowIdx) => {
                    const headers = block.columnHeaders;
                    const cells = row.cells;
                    const isMultiCol = Array.isArray(headers) && headers.length > 0 && Array.isArray(cells);
                    const isTwoColCells = !isMultiCol && Array.isArray(cells) && cells.length === 2;
                    return (
                      <div key={`${block.id}-row-${rowIdx}`} className="border border-gray-200 rounded-md bg-white p-3 space-y-2">
                        <div className="flex justify-between items-center">
                          <div className="text-sm font-medium text-gray-700">Table row {rowIdx + 1}</div>
                          <Button variant="outline" size="sm" onClick={() => removeTableRow(index, rowIdx)}>Remove row</Button>
                        </div>
                        {isMultiCol ? (
                          <div className="grid gap-2 items-start" style={{ gridTemplateColumns: `repeat(${Math.min(headers.length, 4)}, 1fr)` }}>
                            {headers.map((h, ci) => (
                              <div key={ci} className="min-w-0">
                                <label className="block text-xs text-gray-500 mb-0.5">{h}</label>
                                <RichTextEditor
                                  value={cells[ci] ?? ''}
                                  onChange={(v) => updateTableRowCell(index, rowIdx, ci, v)}
                                  placeholder={h}
                                  minHeight={ci === 0 ? '44px' : '80px'}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            {isTwoColCells ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
                                <div className="min-w-0">
                                  <label className="block text-xs text-gray-500 mb-0.5">Left column</label>
                                  <RichTextEditor
                                    value={cells?.[0] ?? ''}
                                    onChange={(v) => updateTableRowCell(index, rowIdx, 0, v)}
                                    placeholder="Left column"
                                    minHeight="60px"
                                  />
                                </div>
                                <div className="min-w-0">
                                  <label className="block text-xs text-gray-500 mb-0.5">Right column</label>
                                  <RichTextEditor
                                    value={cells?.[1] ?? ''}
                                    onChange={(v) => updateTableRowCell(index, rowIdx, 1, v)}
                                    placeholder="Right column"
                                    minHeight="90px"
                                  />
                                </div>
                              </div>
                            ) : (
                              <>
                                <Input
                                  value={row.heading || ''}
                                  onChange={(e) => updateTableRow(index, rowIdx, { heading: e.target.value })}
                                  placeholder="Left column heading (bold in output)"
                                />
                                <RichTextEditor
                                  value={row.content || ''}
                                  onChange={(v) => updateTableRow(index, rowIdx, { content: v })}
                                  placeholder="Right column content"
                                  minHeight="90px"
                                />
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                  <Button variant="outline" size="sm" onClick={() => addTableRow(index)}>+ Add table row</Button>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Paragraph content</label>
                  <RichTextEditor
                    value={block.content || ''}
                    onChange={(v) => updateBlock(index, { content: v })}
                    placeholder="Paste the complete paragraph here..."
                    minHeight="150px"
                  />
                  <div className="mt-3 border border-dashed border-gray-300 rounded-md bg-white p-3 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="text-sm font-medium text-gray-700">Image (optional)</div>
                      <div className="flex items-center gap-2">
                        <input
                          ref={(el) => {
                            fileInputRefs.current[block.id] = el;
                          }}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={!uploadTarget || uploadingImgBlockId === block.id}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            if (!uploadTarget) {
                              toast.error('Save this section/task link first to enable image uploads.');
                              return;
                            }
                            setUploadingImgBlockId(block.id);
                            const { url, error } = await uploadInstructionImage(uploadTarget.scope, uploadTarget.id, file);
                            setUploadingImgBlockId(null);
                            if (error || !url) {
                              toast.error(error || 'Image upload failed');
                              return;
                            }
                            updateBlock(index, { imageUrl: url });
                            toast.success('Image uploaded');
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!uploadTarget || uploadingImgBlockId === block.id}
                          onClick={() => fileInputRefs.current[block.id]?.click()}
                        >
                          {uploadingImgBlockId === block.id ? (
                            <>
                              <Loader variant="dots" size="sm" inline className="mr-1.5" />
                              Uploading…
                            </>
                          ) : (
                            'Upload image'
                          )}
                        </Button>
                        {block.imageUrl ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => updateBlock(index, { imageUrl: undefined })}>
                            Remove
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {block.imageUrl ? (
                      <div className="space-y-2">
                        <img
                          src={block.imageUrl}
                          alt=""
                          className="max-w-full h-auto object-contain rounded border border-gray-200"
                          style={{ maxHeight: 240 }}
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500">Upload an image to show in the PDF between instruction blocks.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-gray-200 bg-white">
          <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-b border-gray-100">
            <Button variant="outline" onClick={() => addBlock('paragraph')} className="justify-center">+ Add paragraph block</Button>
            <Button variant="outline" onClick={() => addBlock('table')} className="justify-center">+ Add table block</Button>
          </div>
          <div className="p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save instructions</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
