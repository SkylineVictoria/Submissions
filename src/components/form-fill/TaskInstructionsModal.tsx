import { useState, useEffect } from 'react';
import { RichTextEditor } from '../ui/RichTextEditor';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';

export type InstructionBlockType = 'paragraph' | 'table';
export interface InstructionTableRow {
  heading?: string;
  content?: string;
}
export interface InstructionBlock {
  id: string;
  type: InstructionBlockType;
  heading?: string;
  content?: string;
  rows?: InstructionTableRow[];
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
  onSave: (data: TaskInstructionsData) => void;
}

export function TaskInstructionsModal({
  isOpen,
  onClose,
  rowLabel,
  initialData,
  onSave,
}: TaskInstructionsModalProps) {
  const [data, setData] = useState<TaskInstructionsData>({});
  const [pasteDraftByBlock, setPasteDraftByBlock] = useState<Record<string, string>>({});
  const [autoCreatingBlockId, setAutoCreatingBlockId] = useState<string | null>(null);

  const escapeHtml = (input: string): string =>
    input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const plainTextToHtml = (input: string): string => {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return '';

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

    for (const rawLine of lines) {
      const numbered = rawLine.match(/^\d+\.\s+(.*)$/);
      const bulleted = rawLine.match(/^[-*•]\s+(.*)$/);
      if (numbered) {
        flushParagraph();
        if (listMode !== 'ol') flushList();
        listMode = 'ol';
        listItems.push(escapeHtml(numbered[1]));
        continue;
      }
      if (bulleted) {
        flushParagraph();
        if (listMode !== 'ul') flushList();
        listMode = 'ul';
        listItems.push(escapeHtml(bulleted[1]));
        continue;
      }
      if (listMode && listItems.length > 0) {
        listItems[listItems.length - 1] += `<br/>${escapeHtml(rawLine)}`;
      } else {
        paragraphBuffer.push(escapeHtml(rawLine));
      }
    }

    flushParagraph();
    flushList();
    return parts.join('');
  };

  const parsePastedTableRows = (input: string): InstructionTableRow[] => {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);

    const rows: Array<{ index: string; heading: string; contentLines: string[] }> = [];
    let current: { index: string; heading: string; contentLines: string[] } | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Ignore copied table headers
      if (/^assessment information\s+description$/i.test(line.replace(/\t+/g, ' '))) continue;

      const rowMatch = line.match(/^(\d+)\s*(?:\t+|\s{2,})(.+)$/);
      if (rowMatch) {
        if (current) rows.push(current);
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
    if (current) rows.push(current);

    return rows
      .map((r) => ({
        heading: `${r.index}. ${r.heading}`.trim(),
        content: plainTextToHtml(r.contentLines.join('\n')),
      }))
      .filter((r) => r.heading || String(r.content || '').replace(/<[^>]*>/g, '').trim());
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
        rows: Array.isArray(b.rows)
          ? b.rows.map((r) => ({ heading: String(r.heading || ''), content: String(r.content || '') }))
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

  useEffect(() => {
    if (isOpen) {
      const blocks = buildLegacyBlocks(initialData);
      setData({ ...(initialData ? { ...initialData } : {}), blocks });
      setPasteDraftByBlock({});
    }
  }, [isOpen, initialData]);

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

  const addTableRow = (blockIndex: number) => {
    updateBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIndex
          ? { ...b, rows: [...(Array.isArray(b.rows) ? b.rows : []), { heading: '', content: '' }] }
          : b
      )
    );
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

  const handleSave = () => {
    const cleanedBlocks = (data.blocks || [])
      .map((b) => ({
        ...b,
        heading: String(b.heading || '').trim(),
        content: String(b.content || ''),
        rows: Array.isArray(b.rows)
          ? b.rows
              .map((r) => ({ heading: String(r.heading || '').trim(), content: String(r.content || '') }))
              .filter((r) => r.heading || r.content.replace(/<[^>]*>/g, '').trim())
          : [],
      }))
      .filter((b) => {
        if (b.type === 'table') return (b.rows || []).length > 0;
        return b.content.replace(/<[^>]*>/g, '').trim();
      });
    onSave({ blocks: cleanedBlocks });
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
                  <div className="border border-dashed border-gray-300 rounded-md p-3 bg-white">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Paste full table text (auto-create rows)</label>
                    <Textarea
                      value={pasteDraftByBlock[block.id] || ''}
                      onChange={(e) => setPasteDraftByBlock((prev) => ({ ...prev, [block.id]: e.target.value }))}
                      rows={6}
                      className="min-h-[120px]"
                      placeholder="Paste copied table text here, then click Auto-create rows"
                    />
                    <div className="mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!autoCreatingBlockId}
                        onClick={async () => {
                          const blockId = block.id;
                          setAutoCreatingBlockId(blockId);
                          await new Promise((r) => setTimeout(r, 300));
                          const parsedRows = parsePastedTableRows(pasteDraftByBlock[blockId] || '');
                          setAutoCreatingBlockId(null);
                          if (parsedRows.length > 0) {
                            updateBlock(index, { rows: parsedRows });
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
                  {(block.rows || []).map((row, rowIdx) => (
                    <div key={`${block.id}-row-${rowIdx}`} className="border border-gray-200 rounded-md bg-white p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="text-sm font-medium text-gray-700">Table row {rowIdx + 1}</div>
                        <Button variant="outline" size="sm" onClick={() => removeTableRow(index, rowIdx)}>Remove row</Button>
                      </div>
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
                    </div>
                  ))}
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
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save instructions</Button>
        </div>
      </div>
    </div>
  );
}
