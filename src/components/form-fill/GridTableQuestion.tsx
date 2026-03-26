import React, { useLayoutEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import type { FormQuestionWithOptionsAndRows } from '../../lib/formEngine';
import { heightFromWordLimit } from '../ui/Textarea';

interface GridTableQuestionProps {
  question: FormQuestionWithOptionsAndRows;
  value: Record<string, string> | null;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
  error?: string;
  /** Highlight textarea background when current user needs to fill fields */
  highlight?: boolean;
  /** When true, adds a Status column with check/cancel per row (Assessment Task 2+) */
  showRowAssessmentColumn?: boolean;
  rowAssessments?: Record<number, string>;
  onRowAssessmentChange?: (rowId: number, satisfactory: 'yes' | 'no') => void;
  /** When true (student resubmission), rows where trainer marked satisfactory='yes' become read-only */
  studentResubmissionReadOnlyForSatisfactoryRows?: boolean;
}

type GridColumnType = 'question' | 'answer';
type GridHeaderCase = 'original' | 'uppercase' | 'title';

interface GridTableColumnMeta {
  label: string;
  type: GridColumnType;
}

const normalizeGridColumnType = (raw: unknown): GridColumnType =>
  String(raw).trim().toLowerCase() === 'question' ? 'question' : 'answer';
const normalizeWordLimit = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};
const truncateToWordLimit = (text: string, maxWords: number): string => {
  if (!text.trim()) return text;
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
};

const toTitleCase = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const formatHeader = (label: string, headerCase: GridHeaderCase): string => {
  if (headerCase === 'uppercase') return label.toUpperCase();
  if (headerCase === 'title') return toTitleCase(label);
  return label;
};

const AutoSizeTextarea: React.FC<{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ value, onChange, onKeyDown, disabled, className, style }) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => {
    resize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onInput={resize}
      disabled={disabled}
      className={className}
      style={style}
    />
  );
};

const getGridColumnsMeta = (pm: Record<string, unknown>): GridTableColumnMeta[] => {
  const rawMeta = pm.columnsMeta;
  if (Array.isArray(rawMeta)) {
    const parsed = rawMeta
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const e = entry as Record<string, unknown>;
        const label = String(e.label ?? '').trim();
        if (!label) return null;
        return { label, type: normalizeGridColumnType(e.type) } as GridTableColumnMeta;
      })
      .filter(Boolean) as GridTableColumnMeta[];
    if (parsed.length > 0) return parsed;
  }

  const columns = Array.isArray(pm.columns) ? (pm.columns as unknown[]) : ['Column 1', 'Column 2'];
  const types = Array.isArray(pm.columnTypes) ? (pm.columnTypes as unknown[]) : [];
  return columns
    .map((c, idx) => {
      const label = String(c ?? '').trim();
      if (!label) return null;
      return { label, type: normalizeGridColumnType(types[idx]) } as GridTableColumnMeta;
    })
    .filter(Boolean) as GridTableColumnMeta[];
};

export const GridTableQuestion: React.FC<GridTableQuestionProps> = ({
  question,
  value,
  onChange,
  disabled,
  error,
  highlight: _highlight = false,
  showRowAssessmentColumn,
  rowAssessments = {},
  onRowAssessmentChange,
  studentResubmissionReadOnlyForSatisfactoryRows,
}) => {
  const pm = (question.pdf_meta as Record<string, unknown>) || {};
  const columnsMeta = getGridColumnsMeta(pm);
  const columns = columnsMeta.map((c) => c.label);
  const headerCaseRaw = String(pm.headerCase ?? 'original').toLowerCase();
  const headerCase: GridHeaderCase = headerCaseRaw === 'uppercase' || headerCaseRaw === 'title' ? headerCaseRaw : 'original';
  const layout = (pm.layout as string) || 'no_image';
  const isSplit = layout === 'split' || layout === 'polygon';
  const isNoImage = layout === 'no_image' || layout === 'no_image_no_header';
  const isNoHeader = layout === 'no_image_no_header';
  const noImageIncludeBaseColumns = !isNoImage;
  const firstCol = (pm.firstColumnLabel as string) || (isNoImage ? 'Item' : layout === 'polygon' ? 'Polygon Name' : layout === 'default' ? 'Shape' : 'Name');
  const secondCol = (pm.secondColumnLabel as string) || (isNoImage ? 'Description' : layout === 'polygon' ? 'Polygon Shape' : 'Image');
  const firstQuestionColIndex = columnsMeta.findIndex((c) => c.type === 'question');
  const columnWordLimits = columnsMeta.map((_, idx) =>
    normalizeWordLimit(Array.isArray(pm.columnWordLimits) ? (pm.columnWordLimits as unknown[])[idx] : null)
  );

  const updateCell = (rowId: number, colIndex: number, val: string) => {
    const key = `r${rowId}_c${colIndex}`;
    const next = { ...(value || {}), [key]: val };
    onChange(next);
  };

  const getCellValue = (rowId: number, colIndex: number): string => {
    const key = `r${rowId}_c${colIndex}`;
    return (value && value[key]) || '';
  };

  const getColumnType = (colIndex: number): 'question' | 'answer' => {
    return columnsMeta[colIndex]?.type === 'question' ? 'question' : 'answer';
  };

  const cellClass = 'p-2 align-top bg-transparent border border-gray-300 break-words text-black';
  const headerClass = 'p-2 text-left font-semibold text-white bg-[#595959] border border-black break-words';

  const renderCell = (row: { id: number; row_label: string; row_help?: string | null }, colIndex: number) => {
    const type = getColumnType(colIndex);
    if (type === 'question') {
      const questionText = isNoImage && !noImageIncludeBaseColumns && colIndex === firstQuestionColIndex
        ? (row.row_label || row.row_help || '—')
        : (row.row_help || '—');
      return (
        <td key={colIndex} className={`${cellClass} text-sm`}>
          {questionText}
        </td>
      );
    }
    const wordLimit = columnWordLimits[colIndex];
    const boxHeight = wordLimit ? heightFromWordLimit(wordLimit) : null;
    const cellVal = getCellValue(row.id, colIndex);
    const wordCount = cellVal.trim() ? cellVal.trim().split(/\s+/).length : 0;
    const rowReadOnly = !!studentResubmissionReadOnlyForSatisfactoryRows && rowAssessments[row.id] === 'yes';
    const answerBgClass =
      disabled || rowReadOnly ? 'bg-gray-50' : 'bg-blue-50/70';
    const baseTextareaClass = `w-full px-2 py-1.5 text-sm ${answerBgClass} border-none border-b border-gray-300 focus:border-[var(--brand)] focus:outline-none`;
    return (
      <td key={colIndex} className={cellClass}>
        {boxHeight ? (
          <textarea
            value={cellVal}
            onChange={(e) => {
              const limit = columnWordLimits[colIndex];
              const next = limit ? truncateToWordLimit(e.target.value, limit) : e.target.value;
              updateCell(row.id, colIndex, next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.stopPropagation();
            }}
            disabled={disabled || rowReadOnly}
            rows={Math.max(1, Math.min(6, Math.ceil((wordLimit || 10) / 10)))}
            className={`${baseTextareaClass} resize-none`}
            style={{ minHeight: boxHeight, maxHeight: boxHeight, height: boxHeight }}
          />
        ) : (
          <AutoSizeTextarea
            value={cellVal}
            onChange={(e) => {
              const limit = columnWordLimits[colIndex];
              const next = limit ? truncateToWordLimit(e.target.value, limit) : e.target.value;
              updateCell(row.id, colIndex, next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.stopPropagation();
            }}
            disabled={disabled || rowReadOnly}
            className={`${baseTextareaClass} resize-none overflow-hidden`}
            style={{ minHeight: 34 }}
          />
        )}
        {wordLimit != null && (
          <p className="mt-0.5 text-xs text-gray-500">
            {wordCount} / {wordLimit} words
          </p>
        )}
      </td>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-sm border border-gray-300 table-fixed">
        {!isNoHeader && (
          <thead>
            <tr>
              {(isSplit || isNoImage) ? (
                <>
                  {isSplit ? (
                    <th className={`${headerClass} w-24`}>
                      {formatHeader(secondCol, headerCase)}
                    </th>
                  ) : (
                    <>
                      {noImageIncludeBaseColumns && (
                        <>
                          <th className={headerClass}>{formatHeader(firstCol, headerCase)}</th>
                          <th className={headerClass}>{formatHeader(secondCol, headerCase)}</th>
                        </>
                      )}
                    </>
                  )}
                  {columns.map((col, i) => (
                    <th key={i} className={headerClass}>
                      {formatHeader(col, headerCase)}
                    </th>
                  ))}
                  {showRowAssessmentColumn && (
                    <th className={`${headerClass} w-20 text-center`}>Status</th>
                  )}
                </>
              ) : (
                <>
                  <th className={`${headerClass} w-24`}>
                    {formatHeader(firstCol, headerCase)}
                  </th>
                  {columns.map((col, i) => (
                    <th key={i} className={headerClass}>
                      {formatHeader(col, headerCase)}
                    </th>
                  ))}
                  {showRowAssessmentColumn && (
                    <th className={`${headerClass} w-20 text-center`}>Status</th>
                  )}
                </>
              )}
            </tr>
          </thead>
        )}
        <tbody>
            {question.rows.map((row) => (
            <tr key={row.id}>
              {isSplit ? (
                <>
                  <td className={cellClass}>
                    <div className="flex flex-col items-start gap-1">
                      {row.row_image_url ? (
                        <>
                          <img
                            src={row.row_image_url}
                            alt={row.row_label}
                            className="w-16 h-12 object-contain block"
                          />
                          <span className="text-xs font-medium text-black block">{row.row_label}</span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-black">{row.row_label}</span>
                      )}
                    </div>
                  </td>
                  {columns.map((_, colIndex) => renderCell(row, colIndex))}
                  {showRowAssessmentColumn && (
                    <td className={`${cellClass} text-center`}>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => onRowAssessmentChange?.(row.id, 'yes')}
                          disabled={disabled}
                          className={`p-1.5 rounded border flex items-center justify-center ${rowAssessments[row.id] === 'yes' ? 'bg-green-100 border-green-600 text-green-700' : 'border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700'}`}
                          title="Satisfactory"
                        >
                          <Check className="w-4 h-4" strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRowAssessmentChange?.(row.id, 'no')}
                          disabled={disabled}
                          className={`p-1.5 rounded border flex items-center justify-center ${rowAssessments[row.id] === 'no' ? 'bg-red-100 border-red-600 text-red-700' : 'border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700'}`}
                          title="Not satisfactory"
                        >
                          <X className="w-4 h-4" strokeWidth={2.5} />
                        </button>
                      </div>
                    </td>
                  )}
                </>
              ) : isNoImage ? (
                <>
                  {noImageIncludeBaseColumns && (
                    <>
                      <td className={`${cellClass} font-medium`}>
                        {row.row_label}
                      </td>
                      <td className={`${cellClass}`}>
                        {row.row_help || '—'}
                      </td>
                    </>
                  )}
                  {columns.map((_, colIndex) => renderCell(row, colIndex))}
                  {showRowAssessmentColumn && (
                    <td className={`${cellClass} text-center`}>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => onRowAssessmentChange?.(row.id, 'yes')}
                          disabled={disabled}
                          className={`p-1.5 rounded border flex items-center justify-center ${rowAssessments[row.id] === 'yes' ? 'bg-green-100 border-green-600 text-green-700' : 'border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700'}`}
                          title="Satisfactory"
                        >
                          <Check className="w-4 h-4" strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRowAssessmentChange?.(row.id, 'no')}
                          disabled={disabled}
                          className={`p-1.5 rounded border flex items-center justify-center ${rowAssessments[row.id] === 'no' ? 'bg-red-100 border-red-600 text-red-700' : 'border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700'}`}
                          title="Not satisfactory"
                        >
                          <X className="w-4 h-4" strokeWidth={2.5} />
                        </button>
                      </div>
                    </td>
                  )}
                </>
              ) : (
                <>
                  <td className={cellClass}>
                    <div className="flex flex-col items-start gap-1">
                      {row.row_image_url ? (
                        <img
                          src={row.row_image_url}
                          alt={row.row_label}
                          className="w-16 h-12 object-contain block"
                        />
                      ) : null}
                      <span className="text-xs font-medium text-black block">{row.row_label}</span>
                    </div>
                  </td>
                  {columns.map((_, colIndex) => renderCell(row, colIndex))}
                  {showRowAssessmentColumn && (
                    <td className={`${cellClass} text-center`}>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => onRowAssessmentChange?.(row.id, 'yes')}
                          disabled={disabled}
                          className={`p-1.5 rounded border flex items-center justify-center ${rowAssessments[row.id] === 'yes' ? 'bg-green-100 border-green-600 text-green-700' : 'border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700'}`}
                          title="Satisfactory"
                        >
                          <Check className="w-4 h-4" strokeWidth={2.5} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRowAssessmentChange?.(row.id, 'no')}
                          disabled={disabled}
                          className={`p-1.5 rounded border flex items-center justify-center ${rowAssessments[row.id] === 'no' ? 'bg-red-100 border-red-600 text-red-700' : 'border-gray-300 text-gray-500 hover:border-gray-500 hover:text-gray-700'}`}
                          title="Not satisfactory"
                        >
                          <X className="w-4 h-4" strokeWidth={2.5} />
                        </button>
                      </div>
                    </td>
                  )}
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
};
