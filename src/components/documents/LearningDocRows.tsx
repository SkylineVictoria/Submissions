import { useLayoutEffect, useRef } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { getLearningDocPublicUrl, type LearningDoc } from '../../lib/formDocuments';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';

const formatBytes = (n: number | null): string => {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let x = v;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export type LearningDocRowsProps = {
  docs: LearningDoc[];
  uploading: boolean;
  loading: boolean;
  canDelete: boolean;
  onDeleteClick: (d: LearningDoc) => void;
  selectedPaths: Set<string>;
  onTogglePath: (path: string) => void;
  onBulkSelectDocs: (docs: LearningDoc[], select: boolean) => void;
  emptyMessage?: string;
  /** Slightly roomier padding for modal layout */
  spacing?: 'compact' | 'comfortable';
  /** When set, a Download zip control appears on the “Select all” row when this section has any selection. */
  onDownloadSectionZip?: () => void;
  zipping?: boolean;
};

export function LearningDocRows({
  docs,
  uploading,
  loading,
  canDelete,
  onDeleteClick,
  selectedPaths,
  onTogglePath,
  onBulkSelectDocs,
  emptyMessage = 'No documents yet.',
  spacing = 'compact',
  onDownloadSectionZip,
  zipping = false,
}: LearningDocRowsProps) {
  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  const allInSectionSelected = docs.length > 0 && docs.every((d) => selectedPaths.has(d.path));
  const someInSectionSelected = docs.some((d) => selectedPaths.has(d.path));
  const selectedInSectionCount = docs.filter((d) => selectedPaths.has(d.path)).length;

  useLayoutEffect(() => {
    const el = headerCheckboxRef.current;
    if (el) el.indeterminate = someInSectionSelected && !allInSectionSelected;
  }, [someInSectionSelected, allInSectionSelected]);

  const rowPad = spacing === 'comfortable' ? 'px-4 py-3' : 'px-3 py-2';
  const headerPad = spacing === 'comfortable' ? 'px-4 py-2.5' : 'px-3 py-2';

  if (docs.length === 0) {
    return (
      <div className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">{emptyMessage}</div>
    );
  }
  return (
    <div className="mt-2 rounded-md border border-[var(--border)] overflow-hidden">
      <div
        className={`flex flex-wrap items-center justify-between gap-2 ${headerPad} bg-gray-50 border-b border-[var(--border)]`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <input
            ref={headerCheckboxRef}
            type="checkbox"
            className="rounded border-gray-300 shrink-0"
            checked={allInSectionSelected}
            onChange={() => onBulkSelectDocs(docs, !allInSectionSelected)}
            aria-label="Select all documents in this section"
          />
          <span className="text-xs text-gray-600">Select all in section ({docs.length})</span>
        </div>
        {selectedInSectionCount > 0 && onDownloadSectionZip ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 inline-flex items-center gap-1.5"
            onClick={() => onDownloadSectionZip()}
            disabled={uploading || loading || zipping}
            title="Download selected files in this section as one zip"
          >
            {zipping ? <Loader variant="dots" size="sm" inline /> : <Download className="h-4 w-4 shrink-0" />}
            <span className="text-xs whitespace-nowrap">
              Download zip ({selectedInSectionCount})
            </span>
          </Button>
        ) : null}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {docs.map((d) => {
          const href = getLearningDocPublicUrl(d.path);
          return (
            <div
              key={d.path}
              className={`flex items-start justify-between gap-3 ${rowPad} bg-white hover:bg-[var(--brand)]/10 transition-colors`}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-gray-300 shrink-0"
                  checked={selectedPaths.has(d.path)}
                  onChange={() => onTogglePath(d.path)}
                  aria-label={`Select ${d.name}`}
                />
                <div className="min-w-0">
                  <div className="font-medium text-[var(--text)] break-words">{d.name}</div>
                  <div className="text-xs text-gray-500">
                    <span>{formatBytes(d.size)}</span>
                    {d.updatedAt ? <span className="ml-2">Updated {new Date(d.updatedAt).toLocaleString()}</span> : null}
                  </div>
                </div>
              </div>
              <div className="inline-flex items-center gap-2 shrink-0">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-[var(--brand)]/10 hover:border-[var(--brand)]/40 hover:text-[var(--brand)] transition-colors"
                  title="Download"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="h-4 w-4" />
                  Download
                </a>
                {canDelete ? (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete"
                    disabled={uploading || loading}
                    onClick={() => onDeleteClick(d)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
