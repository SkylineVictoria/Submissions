import React from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { PaymentPlanConfirmAction } from '../../types/paymentPlans';
import { PAYMENT_PLAN_CONFIRM_MESSAGES } from '../../types/paymentPlans';

interface PaymentPlanConfirmModalProps {
  isOpen: boolean;
  action: PaymentPlanConfirmAction | null;
  extraDetail?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const PaymentPlanConfirmModal: React.FC<PaymentPlanConfirmModalProps> = ({
  isOpen,
  action,
  extraDetail,
  loading,
  onCancel,
  onConfirm,
}) => {
  if (!action) return null;
  const title =
    action === 'confirm_lock'
      ? 'Confirm payment plan'
      : action === 'create'
        ? 'Create payment plan'
        : action === 'overwrite'
          ? 'Overwrite installments'
          : action === 'change_total'
            ? 'Change total amount'
            : action === 'assign_student'
              ? 'Assign student'
              : action === 'unassign_student'
                ? 'Remove student'
                : 'Generate installments';

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm" overlayClassName="!z-[60]">
      <div className="space-y-4">
        <p className="text-sm text-gray-700">{PAYMENT_PLAN_CONFIRM_MESSAGES[action]}</p>
        {extraDetail ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {extraDetail}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={loading}>
            {loading ? 'Please wait…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
