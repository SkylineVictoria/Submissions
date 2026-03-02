import React from 'react';
import type { FormQuestionWithOptionsAndRows } from '../../lib/formEngine';

interface GridTableQuestionProps {
  question: FormQuestionWithOptionsAndRows;
  value: Record<string, string> | null;
  onChange: (value: Record<string, string>) => void;
  disabled?: boolean;
  error?: string;
}

type GridColumnType = 'question' | 'answer';
type GridHeaderCase = 'original' | 'uppercase' | 'title';

interface GridTableColumnMeta {
  label: string;
  type: GridColumnType;
}

const normalizeGridColumnType = (raw: unknown): GridColumnType =>
  String(raw).trim().toLowerCase() === 'question' ? 'question' : 'answer';

const toTitleCase = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const formatHeader = (label: string, headerCase: GridHeaderCase): string => {
  if (headerCase === 'uppercase') return label.toUpperCase();
  if (headerCase === 'title') return toTitleCase(label);
  return label;
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
}) => {
  const pm = (question.pdf_meta as Record<string, unknown>) || {};
  const columnsMeta = getGridColumnsMeta(pm);
  const columns = columnsMeta.map((c) => c.label);
  const headerCaseRaw = String(pm.headerCase ?? 'original').toLowerCase();
  const headerCase: GridHeaderCase = headerCaseRaw === 'uppercase' || headerCaseRaw === 'title' ? headerCaseRaw : 'original';
  const layout = (pm.layout as string) || 'default';
  const isSplit = layout === 'split' || layout === 'polygon';
  const isNoImage = layout === 'no_image';
  const noImageIncludeBaseColumns = !isNoImage;
  const firstCol = (pm.firstColumnLabel as string) || (isNoImage ? 'Item' : layout === 'polygon' ? 'Polygon Name' : 'Name');
  const secondCol = (pm.secondColumnLabel as string) || (isNoImage ? 'Description' : layout === 'polygon' ? 'Polygon Shape' : 'Image');
  const firstQuestionColIndex = columnsMeta.findIndex((c) => c.type === 'question');

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

  const cellClass = 'p-2 align-top bg-transparent border border-gray-300';
  const headerClass = 'p-2 text-left font-semibold text-gray-700 bg-transparent border border-gray-300';

  const renderCell = (row: { id: number; row_label: string; row_help?: string | null }, colIndex: number) => {
    const type = getColumnType(colIndex);
    if (type === 'question') {
      const questionText = isNoImage && !noImageIncludeBaseColumns && colIndex === firstQuestionColIndex
        ? (row.row_label || row.row_help || '—')
        : (row.row_help || '—');
      return (
        <td key={colIndex} className={`${cellClass} text-gray-600 text-sm`}>
          {questionText}
        </td>
      );
    }
    return (
      <td key={colIndex} className={cellClass}>
        <input
          type="text"
          value={getCellValue(row.id, colIndex)}
          onChange={(e) => updateCell(row.id, colIndex, e.target.value)}
          disabled={disabled}
          className="w-full px-2 py-1.5 text-sm bg-transparent border-none border-b border-gray-300 focus:border-[var(--brand)] focus:outline-none"
        />
      </td>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[400px] border-collapse text-sm border border-gray-300">
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
              </>
            ) : (
              <>
                <th className={`${headerClass} w-24`}>
                  Shape
                </th>
                {columns.map((col, i) => (
                  <th key={i} className={headerClass}>
                    {formatHeader(col, headerCase)}
                  </th>
                ))}
              </>
            )}
          </tr>
        </thead>
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
                          <span className="text-xs font-medium text-gray-700 block">{row.row_label}</span>
                        </>
                      ) : (
                        <span className="text-xs font-medium text-gray-700">{row.row_label}</span>
                      )}
                    </div>
                  </td>
                  {columns.map((_, colIndex) => renderCell(row, colIndex))}
                </>
              ) : isNoImage ? (
                <>
                  {noImageIncludeBaseColumns && (
                    <>
                      <td className={`${cellClass} font-medium text-gray-700`}>
                        {row.row_label}
                      </td>
                      <td className={`${cellClass} text-gray-600`}>
                        {row.row_help || '—'}
                      </td>
                    </>
                  )}
                  {columns.map((_, colIndex) => renderCell(row, colIndex))}
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
                      <span className="text-xs font-medium text-gray-700 block">{row.row_label}</span>
                    </div>
                  </td>
                  {columns.map((_, colIndex) => renderCell(row, colIndex))}
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
