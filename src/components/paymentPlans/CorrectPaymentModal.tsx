import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { DatePicker } from '../ui/DatePicker';
import { toast } from '../../utils/toast';
import { canManagePaymentPlans, getEffectiveStoredUser } from '../../lib/formEngine';
import { formatCurrencyAud, isoToPickerDate, parseAmountInput, pickerToIsoDate } from '../../lib/paymentPlanCalculations';
import { supabase } from '../../lib/supabase';
import type { StudentPaymentPlanInstallmentTransaction } from '../../types/paymentPlans';

interface CorrectPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCorrected: () => void;
  transaction: StudentPaymentPlanInstallmentTransaction | null;
  currency: string;
}

export const CorrectPaymentModal: React.FC<CorrectPaymentModalProps> = ({
  isOpen,
  onClose,
  onCorrected,
  transaction,
  currency,
}) => {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!transaction || !isOpen) return;
    setAmount(String(transaction.amount));
    setPaymentDate(transaction.payment_date ? isoToPickerDate(transaction.payment_date) : '');
    setReference(transaction.payment_reference ?? '');
    setNotes(transaction.notes ?? '');
    setReason('');
    setFile(null);
  }, [transaction, isOpen]);

  const handleConfirm = async () => {
    if (!transaction) return;
    const staff = getEffectiveStoredUser();
    if (!staff?.id || staff.role !== 'superadmin' || !canManagePaymentPlans(staff)) {
      toast.error('Only Super Admin can correct a posted payment.');
      return;
    }
    if (!reason.trim()) {
      toast.error('Correction reason is required.');
      return;
    }
    const parsed = parseAmountInput(amount);
    if (parsed == null || parsed <= 0) {
      toast.error('Corrected amount must be greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      // If a new receipt file is provided, upload via record-correction edge path:
      // For now use RPC directly and require existing receipt carry-forward OR upload via replace after.
      // Preferred: upload new receipt first to SharePoint only when file provided via dedicated flow.
      // Simplified: call correction RPC; if file present, upload replace on the NEW tx after.

      const { data, error } = await supabase.rpc('skyline_correct_student_plan_payment', {
        p_original_transaction_id: transaction.id,
        p_corrected_amount: parsed,
        p_payment_date: paymentDate ? pickerToIsoDate(paymentDate) : null,
        p_payment_reference: reference || null,
        p_notes: notes || null,
        p_correction_reason: reason.trim(),
        p_changed_by: staff.id,
        p_idempotency_key: crypto.randomUUID(),
        p_sharepoint_item_id: null,
        p_sharepoint_drive_id: null,
        p_sharepoint_site_id: null,
        p_file_name: null,
        p_original_file_name: null,
        p_mime_type: null,
        p_file_size: null,
        p_web_url: null,
        p_sharepoint_path: null,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      const row = Array.isArray(data) ? data[0] : data;
      const newTxId = Number((row as { payment_transaction_id?: number })?.payment_transaction_id ?? 0);

      if (file && newTxId > 0) {
        const { uploadPaymentReceipt } = await import('../../services/paymentPlans');
        const up = await uploadPaymentReceipt({
          file,
          paymentTransactionId: newTxId,
          studentId: transaction.student_id,
          replaceExistingReceipt: true,
          replaceReason: reason.trim(),
        });
        if (!up.success) {
          toast.error(`Correction posted but receipt replace failed: ${up.message}`);
        }
      }

      toast.success(
        `Payment corrected · new amount ${formatCurrencyAud(parsed, currency)}${newTxId ? ` (#${newTxId})` : ''}`
      );
      onCorrected();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Correction failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!transaction) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Correct payment #${transaction.id}`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Original amount {formatCurrencyAud(transaction.amount, currency)} remains in audit history.
          This creates a correction transaction and rebuilds FIFO allocations.
        </p>
        <Textarea
          label="Correction reason *"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder="Why is this payment being corrected?"
        />
        <Input
          label="Corrected amount *"
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment date</label>
          <DatePicker value={paymentDate} onChange={setPaymentDate} />
        </div>
        <Input label="Reference" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Replacement receipt (optional if original evidence still valid)
          </label>
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleConfirm()} disabled={submitting || !reason.trim()}>
            {submitting ? 'Correcting…' : 'Confirm correction'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
