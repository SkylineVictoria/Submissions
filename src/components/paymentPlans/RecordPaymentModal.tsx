import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { DatePicker } from '../ui/DatePicker';
import { toast } from '../../utils/toast';
import {
  computeDueNow,
  previewFifoPaymentAllocation,
  totalOutstandingBalance,
  type FifoInstallmentInput,
} from '../../lib/paymentAllocation';
import { formatCurrencyAud, parseAmountInput, pickerToIsoDate } from '../../lib/paymentPlanCalculations';
import { recordStudentPlanPayment } from '../../services/paymentPlans';
import type { EditableStudentInstallmentRow } from './PaymentPlanInstallmentsTable';

interface RecordPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecorded: () => void;
  assignmentId: number;
  studentId: number;
  currency: string;
  rows: EditableStudentInstallmentRow[];
}

export const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  isOpen,
  onClose,
  onRecorded,
  assignmentId,
  studentId,
  currency,
  rows,
}) => {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  });
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setAmount('');
      setReference('');
      setNotes('');
      setFile(null);
    }
  }, [isOpen]);

  const fifoInputs: FifoInstallmentInput[] = useMemo(
    () =>
      rows
        .filter((r) => r.id != null)
        .map((r) => ({
          id: r.id as number,
          installment_number: r.installment_number,
          due_date: pickerToIsoDate(r.due_date),
          amount: parseAmountInput(r.amount) ?? 0,
          paid_amount: parseAmountInput(r.paid_amount) ?? 0,
          waived_amount: parseAmountInput(r.waived_amount ?? '') ?? 0,
          status: r.status,
        })),
    [rows]
  );

  const maxAllowed = totalOutstandingBalance(fifoInputs);
  const parsedAmount = parseAmountInput(amount) ?? 0;
  const preview = useMemo(
    () => (parsedAmount > 0 ? previewFifoPaymentAllocation(fifoInputs, parsedAmount) : null),
    [fifoInputs, parsedAmount]
  );

  const currentDueRow = useMemo(() => {
    const ordered = [...fifoInputs].sort((a, b) => a.installment_number - b.installment_number);
    return ordered.find((i) => i.status === 'partial' || i.status === 'pending' || i.status === 'overdue') ?? ordered[0];
  }, [fifoInputs]);

  const dueNow = currentDueRow
    ? computeDueNow({ installments: fifoInputs, currentInstallmentId: currentDueRow.id })
    : null;

  const handleConfirm = async () => {
    if (!file) {
      toast.error('Please upload the payment receipt before recording this payment.');
      return;
    }
    if (!(parsedAmount > 0)) {
      toast.error('Payment amount must be greater than zero.');
      return;
    }
    if (!paymentDate) {
      toast.error('Payment date is required.');
      return;
    }
    if (!preview?.ok) {
      toast.error(preview?.error || 'Invalid allocation.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await recordStudentPlanPayment({
        file,
        assignmentId,
        studentId,
        amount: parsedAmount,
        paymentDate,
        paymentReference: reference,
        notes,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(
        `Payment recorded · allocated ${formatCurrencyAud(result.allocatedTotal, currency)} across ${result.allocationCount} instalment(s)`
      );
      onRecorded();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Record payment" size="lg">
      <div className="space-y-4">
        {dueNow && dueNow.total_due_now > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
            <div className="flex justify-between gap-4">
              <span>Previous outstanding</span>
              <span className="tabular-nums">{formatCurrencyAud(dueNow.previous_outstanding, currency)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>Current instalment</span>
              <span className="tabular-nums">
                {formatCurrencyAud(dueNow.current_installment_outstanding, currency)}
              </span>
            </div>
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-1 font-semibold">
              <span>Total due now</span>
              <span className="tabular-nums">{formatCurrencyAud(dueNow.total_due_now, currency)}</span>
            </div>
            <p className="text-xs text-gray-500 pt-1">
              Scheduled instalment amounts are not changed. Maximum payment:{' '}
              {formatCurrencyAud(maxAllowed, currency)}.
            </p>
          </div>
        ) : null}

        <Input
          label="Amount received *"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <DatePicker label="Payment date *" value={paymentDate} onChange={setPaymentDate} />
        <Input
          label="Reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Bank transfer / EFT reference"
        />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Receipt *</label>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {!file ? (
            <p className="text-xs text-amber-700 mt-1">
              Please upload the payment receipt before recording this payment.
            </p>
          ) : (
            <p className="text-xs text-gray-500 mt-1">{file.name}</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 p-3">
          <div className="text-sm font-semibold mb-2">Allocation preview</div>
          {!preview || parsedAmount <= 0 ? (
            <p className="text-sm text-gray-500">Enter an amount to preview FIFO allocation.</p>
          ) : !preview.ok ? (
            <p className="text-sm text-red-600">{preview.error}</p>
          ) : (
            <div className="space-y-1 text-sm">
              {preview.lines.map((line) => (
                <div key={line.installment_id} className="flex justify-between gap-4">
                  <span>
                    Instalment #{line.installment_number}
                    <span className="text-xs text-gray-500 ml-2">
                      (was {formatCurrencyAud(line.outstanding_before, currency)} outstanding)
                    </span>
                  </span>
                  <span className="tabular-nums font-medium">
                    {formatCurrencyAud(line.allocated_amount, currency)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between gap-4 border-t border-gray-200 pt-1 font-semibold">
                <span>Total allocated</span>
                <span className="tabular-nums">
                  {formatCurrencyAud(preview.allocated_total, currency)}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleConfirm()}
            disabled={submitting || !file || !preview?.ok}
          >
            {submitting ? 'Recording…' : 'Confirm payment'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
