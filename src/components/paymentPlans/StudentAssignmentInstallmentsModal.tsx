import React, { useCallback, useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import {
  fetchStudentAssignmentInstallments,
  updateDraftStudentInstallmentRow,
  updateStudentInstallmentPaymentFields,
} from '../../services/paymentPlans';
import type { StudentPaymentPlanSummary } from '../../types/paymentPlans';
import { isoToPickerDate } from '../../lib/paymentPlanCalculations';
import {
  PaymentPlanInstallmentsTable,
  type EditableStudentInstallmentRow,
} from './PaymentPlanInstallmentsTable';

interface StudentAssignmentInstallmentsModalProps {
  isOpen: boolean;
  assignment: StudentPaymentPlanSummary | null;
  onClose: () => void;
  onSaved: () => void;
}

export const StudentAssignmentInstallmentsModal: React.FC<StudentAssignmentInstallmentsModalProps> = ({
  isOpen,
  assignment,
  onClose,
  onSaved,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<EditableStudentInstallmentRow[]>([]);

  const isScheduleLocked = assignment?.plan_status === 'confirmed';

  const load = useCallback(async () => {
    if (!assignment) return;
    setLoading(true);
    try {
      const data = await fetchStudentAssignmentInstallments(assignment.assignment_id);
      setRows(
        data.map((r) => ({
          id: r.id,
          installment_number: r.installment_number,
          due_date: isoToPickerDate(r.due_date),
          amount: String(r.amount),
          status: r.status,
          paid_amount: String(r.paid_amount),
          payment_date: r.payment_date ? isoToPickerDate(r.payment_date) : '',
          notes: r.notes ?? '',
        }))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load installments');
    } finally {
      setLoading(false);
    }
  }, [assignment]);

  useEffect(() => {
    if (isOpen && assignment) void load();
  }, [isOpen, assignment, load]);

  const handleSave = async () => {
    if (!assignment) return;
    setSaving(true);
    try {
      for (const row of rows) {
        if (!row.id) continue;
        if (!isScheduleLocked) {
          await updateDraftStudentInstallmentRow(row.id, {
            due_date: row.due_date,
            amount: Number(row.amount),
            notes: row.notes,
          });
        }
        await updateStudentInstallmentPaymentFields(row.id, {
          status: row.status,
          paid_amount: Number(row.paid_amount),
          payment_date: row.payment_date || null,
          notes: row.notes,
        });
      }
      toast.success('Student installments saved');
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!assignment) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${assignment.display_student_name} — ${assignment.plan_name}`}
      size="xl"
    >
      {loading ? (
        <Loader message="Loading installments…" />
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Payment tracking for this student on the shared plan template.
            {isScheduleLocked ? ' Schedule amounts and due dates are locked.' : ''}
          </p>
          <PaymentPlanInstallmentsTable
            mode="student"
            rows={rows}
            currency={assignment.currency}
            isDraft={!isScheduleLocked}
            onChangeRow={(index, patch) => {
              setRows((prev) => {
                const next = [...prev];
                next[index] = { ...next[index], ...patch };
                return next;
              });
            }}
          />
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
              Save
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
