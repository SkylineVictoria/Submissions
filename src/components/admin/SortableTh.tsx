import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../utils/cn';

export type SortDirection = 'asc' | 'desc';

type SortableThProps = {
  label: string;
  active: boolean;
  direction: SortDirection;
  onToggle: () => void;
  className?: string;
  align?: 'left' | 'right';
};

/**
 * Clickable column header: always shows ↑ and ↓ together; active sort highlights one in brand, the other muted.
 */
export function SortableTh({ label, active, direction, onToggle, className, align = 'left' }: SortableThProps) {
  const upActive = active && direction === 'asc';
  const downActive = active && direction === 'desc';
  const upClass = cn(
    'h-3 w-3 shrink-0 transition-colors',
    upActive ? 'text-[var(--brand)]' : 'text-gray-300 group-hover:text-gray-400'
  );
  const downClass = cn(
    'h-3 w-3 shrink-0 transition-colors',
    downActive ? 'text-[var(--brand)]' : 'text-gray-300 group-hover:text-gray-400'
  );

  return (
    <th scope="col" className={cn(align === 'right' && 'text-right', className)}>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'group -mx-1 inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left font-semibold text-gray-700 transition-colors hover:bg-gray-100 hover:text-[var(--text)]',
          align === 'right' && 'ml-auto w-full justify-end text-right'
        )}
        aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span className="select-none">{label}</span>
        <span className="inline-flex shrink-0 flex-col items-center justify-center leading-[0.5]" aria-hidden>
          <ArrowUp className={upClass} />
          <ArrowDown className={cn(downClass, '-mt-0.5')} />
        </span>
      </button>
    </th>
  );
}
