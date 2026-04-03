import { Button } from '../ui/Button';

export type AdminListPaginationProps = {
  totalItems: number;
  pageSize: number;
  currentPage: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  itemLabel: string;
  placement: 'top' | 'bottom';
};

/**
 * Mobile / tablet: `placement="top"` shows a full-width bar (lg:hidden) before long lists so Prev/Next are not below the fold.
 * Large screens: `placement="bottom"` (hidden until lg+) shows the standard footer row.
 */
export function AdminListPagination({
  totalItems,
  pageSize,
  currentPage,
  totalPages,
  onPrev,
  onNext,
  itemLabel,
  placement,
}: AdminListPaginationProps) {
  if (totalItems <= pageSize) return null;
  const label = `Page ${currentPage} of ${totalPages} (${totalItems} ${itemLabel})`;

  if (placement === 'top') {
    return (
      <div className="mb-3 flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-gray-50/90 p-3 lg:hidden">
        <div className="text-center text-xs text-gray-600">{label}</div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={currentPage <= 1} className="min-w-0 flex-1">
            Previous
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={currentPage >= totalPages} className="min-w-0 flex-1">
            Next
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 hidden flex-col gap-3 border-t border-[var(--border)] pt-4 lg:flex lg:flex-row lg:items-center lg:justify-between">
      <div className="text-center text-xs text-gray-500 lg:text-left">{label}</div>
      <div className="flex w-full gap-2 lg:w-auto lg:justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onPrev} disabled={currentPage <= 1} className="min-w-0 flex-1 lg:flex-initial">
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onNext} disabled={currentPage >= totalPages} className="min-w-0 flex-1 lg:flex-initial">
          Next
        </Button>
      </div>
    </div>
  );
}
