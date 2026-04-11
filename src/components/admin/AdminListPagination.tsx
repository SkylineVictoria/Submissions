import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

export type AdminListPaginationProps = {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  /** Clamped to 1 … totalPages (e.g. set current page from “Go” or select). */
  onGoToPage: (page: number) => void;
  itemLabel: string;
  placement: 'top' | 'bottom';
};

/** Above this, use number + Go instead of a very long native &lt;select&gt;. */
const PAGE_SELECT_MAX = 120;

function JumpToPage({
  totalPages,
  currentPage,
  onGoToPage,
}: {
  totalPages: number;
  currentPage: number;
  onGoToPage: (page: number) => void;
}) {
  const [jumpInput, setJumpInput] = useState(String(currentPage));
  const pageOptions = useMemo(() => {
    if (totalPages <= PAGE_SELECT_MAX) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    return [] as number[];
  }, [totalPages]);

  useEffect(() => {
    setJumpInput(String(currentPage));
  }, [currentPage]);

  const apply = () => {
    const n = parseInt(String(jumpInput).trim(), 10);
    if (!Number.isFinite(n)) return;
    const p = Math.min(totalPages, Math.max(1, n));
    onGoToPage(p);
    setJumpInput(String(p));
  };

  if (totalPages <= 1) return null;

  const selectOptions = useMemo(
    () => pageOptions.map((p) => ({ value: String(p), label: String(p) })),
    [pageOptions]
  );

  if (totalPages <= PAGE_SELECT_MAX) {
    return (
      <div className="inline-flex shrink-0 items-center gap-2">
        <span className="whitespace-nowrap text-sm font-medium text-gray-700">Page</span>
        <div className="w-[4.75rem] shrink-0">
          <Select
            compact
            attachDropdown="trigger"
            value={String(currentPage)}
            onChange={(v) => {
              const p = Number(v);
              if (Number.isFinite(p) && p >= 1 && p <= totalPages) onGoToPage(p);
            }}
            options={selectOptions}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="inline-flex shrink-0 flex-wrap items-center gap-2">
      <span className="whitespace-nowrap text-sm font-medium text-gray-700">Page</span>
      <Input
        inline
        type="number"
        min={1}
        max={totalPages}
        inputMode="numeric"
        value={jumpInput}
        onChange={(e) => setJumpInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
        aria-label="Page number"
        className="min-w-[3.75rem] max-w-[5rem]"
      />
      <Button type="button" variant="outline" size="sm" className="h-10 shrink-0 px-4 text-sm font-medium" onClick={apply}>
        Go
      </Button>
    </div>
  );
}

/**
 * Mobile / tablet: `placement="top"` shows a full-width bar (lg:hidden) before long lists so Prev/Next are not below the fold.
 * Large screens: `placement="bottom"` (hidden until lg+) shows the standard footer row.
 * Single-page lists still show a total count on one placement (top on small screens, bottom on lg).
 */
export function AdminListPagination({
  totalItems,
  pageSize,
  currentPage,
  totalPages,
  onPrev,
  onNext,
  onGoToPage,
  itemLabel,
  placement,
}: AdminListPaginationProps) {
  if (totalItems <= 0) return null;

  const summary = `${totalItems} ${itemLabel}`;
  const pagedLabel = `Page ${currentPage} of ${totalPages} (${totalItems} ${itemLabel})`;

  if (totalItems <= pageSize) {
    if (placement === 'top') {
      return <div className="mb-3 text-center text-xs text-gray-600 lg:hidden">{summary}</div>;
    }
    return <div className="mt-4 hidden text-xs text-gray-500 lg:block">{summary}</div>;
  }

  const jump = <JumpToPage totalPages={totalPages} currentPage={currentPage} onGoToPage={onGoToPage} />;

  if (placement === 'top') {
    return (
      <div className="mb-3 rounded-lg border border-[var(--border)] bg-gray-50/90 p-3 lg:hidden">
        <div className="mb-2 text-center text-xs text-gray-600">{pagedLabel}</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={currentPage <= 1} className="min-h-10 min-w-[6.5rem] shrink-0">
            Previous
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={currentPage >= totalPages} className="min-h-10 min-w-[6.5rem] shrink-0">
            Next
          </Button>
          {jump}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 hidden flex-col gap-3 border-t border-[var(--border)] pt-4 lg:flex lg:flex-row lg:items-center lg:justify-between lg:gap-4">
      <div className="min-w-0 text-xs text-gray-500 lg:text-left">{pagedLabel}</div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {jump}
        <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={currentPage <= 1} className="min-h-10 shrink-0 px-4">
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={currentPage >= totalPages} className="min-h-10 shrink-0 px-4">
          Next
        </Button>
      </div>
    </div>
  );
}
