import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';
import type { PaymentPlanInstallmentStatus } from '../../types/paymentPlans';
import { INSTALLMENT_STATUS_OPTIONS } from '../../types/paymentPlans';
import {
  formatCurrencyAud,
  isInformationalOverdue,
  outstandingAmount,
  pickerToIsoDate,
} from '../../lib/paymentPlanCalculations';

export interface EditableTemplateInstallmentRow {
  id?: number;
  installment_number: number;
  due_date: string;
  amount: string;
}

export interface EditableStudentInstallmentRow {
  id?: number;
  installment_number: number;
  due_date: string;
  amount: string;
  status: PaymentPlanInstallmentStatus;
  paid_amount: string;
  payment_date: string;
  notes: string;
  waiver_reason?: string;
  payment_reference?: string;
  waived_amount?: string;
}

interface TemplateInstallmentsTableProps {
  mode: 'template';
  rows: EditableTemplateInstallmentRow[];
  currency: string;
  isDraft: boolean;
  onChangeRow: (index: number, patch: Partial<EditableTemplateInstallmentRow>) => void;
}

interface StudentInstallmentsTableProps {
  mode: 'student';
  rows: EditableStudentInstallmentRow[];
  currency: string;
  isDraft: boolean;
  /** When true, cash fields are read-only; use Record Payment instead. Waiver still editable. */
  scheduleView?: boolean;
  onChangeRow: (index: number, patch: Partial<EditableStudentInstallmentRow>) => void;
  onReorderPending?: (fromIndex: number, toIndex: number) => void;
}

type PaymentPlanInstallmentsTableProps = TemplateInstallmentsTableProps | StudentInstallmentsTableProps;

function SortableStudentRow({
  row,
  index,
  currency,
  isDraft,
  scheduleView,
  canDrag,
  onChangeRow,
}: {
  row: EditableStudentInstallmentRow;
  index: number;
  currency: string;
  isDraft: boolean;
  scheduleView: boolean;
  canDrag: boolean;
  onChangeRow: (index: number, patch: Partial<EditableStudentInstallmentRow>) => void;
}) {
  const id = row.id != null ? `inst-${row.id}` : `inst-idx-${index}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !canDrag,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    background: isDragging ? '#fff7ed' : undefined,
  };

  const paid = Number(row.paid_amount) || 0;
  const due = Number(row.amount) || 0;
  const waived = Number(row.waived_amount) || 0;
  const outstanding = outstandingAmount(due, paid, row.status, waived);
  const overdueHint = isInformationalOverdue(row.status, pickerToIsoDate(row.due_date));
  const cashLocked = scheduleView;

  return (
    <tr ref={setNodeRef} style={style} className="border-b border-gray-100">
      <td className="px-2 py-2 w-8">
        {canDrag ? (
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-100 text-gray-500"
            aria-label={`Drag to reorder installment ${row.installment_number}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
        ) : (
          <span className="inline-block w-6" aria-hidden />
        )}
      </td>
      <td className="px-2 py-2">{row.installment_number}</td>
      <td className="px-2 py-2 min-w-[130px]">
        {isDraft ? (
          <DatePicker value={row.due_date} onChange={(v) => onChangeRow(index, { due_date: v })} />
        ) : (
          <span>
            {row.due_date}
            {overdueHint ? (
              <span className="ml-1 text-xs text-amber-700" title="Due date has passed">
                (overdue)
              </span>
            ) : null}
          </span>
        )}
      </td>
      <td className="px-2 py-2 min-w-[100px]">
        {isDraft ? (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={row.amount}
            onChange={(e) => onChangeRow(index, { amount: e.target.value })}
          />
        ) : (
          <span>{formatCurrencyAud(due, currency)}</span>
        )}
      </td>
      <td className="px-2 py-2 min-w-[120px]">
        {cashLocked ? (
          <Select
            value={row.status}
            onChange={(v) => onChangeRow(index, { status: v as PaymentPlanInstallmentStatus })}
            options={INSTALLMENT_STATUS_OPTIONS.filter((o) => {
              // Cash statuses are derived from allocations — only allow waiver transitions here.
              if (o.value === 'waived') return true;
              if (o.value === row.status) return true;
              if (row.status === 'waived' && o.value === 'pending' && paid <= 0) return true;
              return false;
            })}
            compact
          />
        ) : (
          <Select
            value={row.status}
            onChange={(v) => onChangeRow(index, { status: v as PaymentPlanInstallmentStatus })}
            options={INSTALLMENT_STATUS_OPTIONS}
            compact
          />
        )}
      </td>
      <td className="px-2 py-2 min-w-[100px] text-right tabular-nums">
        {cashLocked ? (
          formatCurrencyAud(paid, currency)
        ) : (
          <Input
            type="number"
            step="0.01"
            min="0"
            value={row.paid_amount}
            onChange={(e) => onChangeRow(index, { paid_amount: e.target.value })}
          />
        )}
      </td>
      <td className="px-2 py-2 min-w-[100px] text-right tabular-nums">
        {formatCurrencyAud(outstanding, currency)}
      </td>
      <td className="px-2 py-2 min-w-[130px]">
        {cashLocked ? (
          <span>{row.payment_date || '—'}</span>
        ) : (
          <DatePicker
            value={row.payment_date}
            onChange={(v) => onChangeRow(index, { payment_date: v })}
          />
        )}
      </td>
      <td className="px-2 py-2 min-w-[120px]">
        {cashLocked ? (
          <span className="text-xs text-gray-600">{row.payment_reference || '—'}</span>
        ) : (
          <Input
            value={row.payment_reference ?? ''}
            onChange={(e) => onChangeRow(index, { payment_reference: e.target.value })}
            placeholder="Ref / receipt"
          />
        )}
      </td>
      <td className="px-2 py-2 min-w-[150px]">
        {cashLocked && row.status !== 'waived' ? (
          <span className="text-xs text-gray-600">{row.notes || '—'}</span>
        ) : (
          <Input
            value={row.status === 'waived' ? (row.waiver_reason ?? row.notes) : row.notes}
            onChange={(e) =>
              onChangeRow(
                index,
                row.status === 'waived'
                  ? { waiver_reason: e.target.value, notes: e.target.value }
                  : { notes: e.target.value }
              )
            }
            placeholder={row.status === 'waived' ? 'Waiver reason (required)' : 'Notes'}
          />
        )}
      </td>
    </tr>
  );
}

export const PaymentPlanInstallmentsTable: React.FC<PaymentPlanInstallmentsTableProps> = (props) => {
  const { rows, currency, isDraft, onChangeRow } = props;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-500 py-4 text-center">
        No installments yet. Generate installments or add custom rows.
      </p>
    );
  }

  if (props.mode === 'template') {
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-gray-600">
              <th className="px-2 py-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">Due date</th>
              <th className="px-2 py-2 font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id ?? `tpl-${row.installment_number}`} className="border-b border-gray-100">
                <td className="px-2 py-2">{row.installment_number}</td>
                <td className="px-2 py-2 min-w-[140px]">
                  {isDraft ? (
                    <DatePicker value={row.due_date} onChange={(v) => onChangeRow(index, { due_date: v })} />
                  ) : (
                    <span>{row.due_date}</span>
                  )}
                </td>
                <td className="px-2 py-2 min-w-[110px]">
                  {isDraft ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={row.amount}
                      onChange={(e) => onChangeRow(index, { amount: e.target.value })}
                    />
                  ) : (
                    <span>{formatCurrencyAud(Number(row.amount), currency)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const studentRows = rows as EditableStudentInstallmentRow[];
  const sortableIds = studentRows.map((r, index) =>
    r.id != null ? `inst-${r.id}` : `inst-idx-${index}`
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = sortableIds.indexOf(String(active.id));
    const toIndex = sortableIds.indexOf(String(over.id));
    if (fromIndex < 0 || toIndex < 0) return;
    props.onReorderPending?.(fromIndex, toIndex);
  };

  return (
    <div className="overflow-x-auto -mx-1">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-gray-600">
              <th className="px-2 py-2 font-semibold w-8" aria-label="Reorder" />
              <th className="px-2 py-2 font-semibold">#</th>
              <th className="px-2 py-2 font-semibold">Due date</th>
              <th className="px-2 py-2 font-semibold">Scheduled</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2 font-semibold">Paid</th>
              <th className="px-2 py-2 font-semibold">Outstanding</th>
              <th className="px-2 py-2 font-semibold">Payment date</th>
              <th className="px-2 py-2 font-semibold">Reference</th>
              <th className="px-2 py-2 font-semibold">Notes</th>
            </tr>
          </thead>
          <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
            <tbody>
              {studentRows.map((row, index) => (
                <SortableStudentRow
                  key={sortableIds[index]}
                  row={row}
                  index={index}
                  currency={currency}
                  isDraft={isDraft}
                  scheduleView={Boolean(props.scheduleView)}
                  canDrag={!props.scheduleView && row.status === 'pending'}
                  onChangeRow={onChangeRow}
                />
              ))}
            </tbody>
          </SortableContext>
        </table>
      </DndContext>
    </div>
  );
};
