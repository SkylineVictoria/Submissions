import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import { useAuth } from '../../contexts/AuthContext';
import { canManagePaymentPlans } from '../../lib/formEngine';
import {
  fetchStudentAssignmentInstallments,
  fetchActivePaymentReceiptsForTransactions,
  fetchPaymentTransactionsForInstallments,
  reorderPendingStudentInstallments,
  updateStudentInstallmentPaymentFields,
  uploadPaymentReceipt,
} from '../../services/paymentPlans';
import type {
  PaymentReceipt,
  StudentPaymentPlanInstallmentTransaction,
  StudentPaymentPlanSummary,
} from '../../types/paymentPlans';
import {
  applyAmountReorderKeepingSlots,
  formatCurrencyAud,
  isoToPickerDate,
  parseAmountInput,
  pickerToIsoDate,
  validatePaymentStatusChange,
} from '../../lib/paymentPlanCalculations';
import {
  PaymentPlanInstallmentsTable,
  type EditableStudentInstallmentRow,
} from './PaymentPlanInstallmentsTable';

function serializePaymentFields(row: EditableStudentInstallmentRow): string {
  return JSON.stringify({
    status: row.status,
    paid_amount: row.paid_amount,
    payment_date: row.payment_date,
    notes: row.notes,
    waived_amount: row.waived_amount,
    waiver_reason: row.waiver_reason,
    payment_reference: row.payment_reference,
  });
}

function buildSavedPaymentSnapshot(rows: EditableStudentInstallmentRow[]): Record<number, string> {
  const snapshot: Record<number, string> = {};
  for (const row of rows) {
    if (row.id != null) snapshot[row.id] = serializePaymentFields(row);
  }
  return snapshot;
}

interface StudentAssignmentInstallmentsModalProps {
  isOpen: boolean;
  assignment: StudentPaymentPlanSummary | null;
  onClose: () => void;
  onSaved: () => void;
  userId?: number;
}

export const StudentAssignmentInstallmentsModal: React.FC<StudentAssignmentInstallmentsModalProps> = ({
  isOpen,
  assignment,
  onClose,
  onSaved,
  userId,
}) => {
  const { user } = useAuth();
  const staffUserId = user?.id ?? userId;
  const canUploadReceipts = canManagePaymentPlans(user);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<EditableStudentInstallmentRow[]>([]);
  const [savedPaymentByInstallmentId, setSavedPaymentByInstallmentId] = useState<Record<number, string>>({});
  const [paymentTransactions, setPaymentTransactions] = useState<StudentPaymentPlanInstallmentTransaction[]>([]);
  const [activeReceiptsByTxId, setActiveReceiptsByTxId] = useState<Record<number, PaymentReceipt>>({});
  const [receiptFileByTxId, setReceiptFileByTxId] = useState<Record<number, File | null>>({});
  const [receiptUploadBusyByTxId, setReceiptUploadBusyByTxId] = useState<Record<number, boolean>>({});
  /** Source installment IDs in the order their amounts should fill pending slots. */
  const [pendingOrderIds, setPendingOrderIds] = useState<number[] | null>(null);

  const isScheduleLocked =
    Boolean(assignment?.is_finalized) || assignment?.plan_status === 'confirmed';

  const load = useCallback(async () => {
    if (!assignment) return;
    setLoading(true);
    try {
      const data = await fetchStudentAssignmentInstallments(assignment.assignment_id);
      const mappedRows = data.map((r) => ({
        id: r.id,
        installment_number: r.installment_number,
        due_date: isoToPickerDate(r.due_date),
        amount: String(r.amount),
        status: r.status,
        paid_amount: String(r.paid_amount),
        payment_date: r.payment_date ? isoToPickerDate(r.payment_date) : '',
        notes: r.notes ?? '',
        waiver_reason: r.waiver_reason ?? '',
        payment_reference: r.payment_reference ?? '',
        waived_amount: String(r.waived_amount ?? 0),
      })) satisfies EditableStudentInstallmentRow[];

      setRows(mappedRows);
      setPendingOrderIds(null);
      setSavedPaymentByInstallmentId(buildSavedPaymentSnapshot(mappedRows));

      // Load payment transaction history + any active receipts for this assignment.
      const installmentIds = mappedRows.map((r) => r.id).filter((id): id is number => Number.isFinite(id));
      const txs = await fetchPaymentTransactionsForInstallments(installmentIds);
      setPaymentTransactions(txs);

      const txIds = txs.map((t) => t.id);
      if (txIds.length > 0) {
        try {
          const receipts = await fetchActivePaymentReceiptsForTransactions(txIds);
          const map = receipts.reduce<Record<number, PaymentReceipt>>((acc, r) => {
            acc[r.payment_transaction_id] = r;
            return acc;
          }, {});
          setActiveReceiptsByTxId(map);
        } catch {
          // Receipt metadata is optional for editing payments; don't spam toasts on load.
          setActiveReceiptsByTxId({});
        }
      } else {
        setActiveReceiptsByTxId({});
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load installments');
    } finally {
      setLoading(false);
    }
  }, [assignment]);

  useEffect(() => {
    if (isOpen && assignment) void load();
  }, [isOpen, assignment, load]);

  const hasUnsavedPaymentChanges = useCallback(
    (installmentId: number) => {
      const row = rows.find((r) => r.id === installmentId);
      if (!row) return false;
      const saved = savedPaymentByInstallmentId[installmentId];
      if (!saved) return true;
      return serializePaymentFields(row) !== saved;
    },
    [rows, savedPaymentByInstallmentId]
  );

  const hasAnyUnsavedPaymentChanges = useMemo(
    () => rows.some((row) => row.id != null && hasUnsavedPaymentChanges(row.id)),
    [rows, hasUnsavedPaymentChanges]
  );

  const handleReceiptUpload = async (args: {
    paymentTransactionId: number;
    installmentId: number;
    replaceExistingReceipt: boolean;
  }) => {
    if (!assignment) return;
    if (!canUploadReceipts || !staffUserId) {
      toast.error('Authentication required.');
      return;
    }
    if (hasUnsavedPaymentChanges(args.installmentId)) {
      toast.error('Save the payment before uploading a receipt.');
      return;
    }

    const file = receiptFileByTxId[args.paymentTransactionId];
    if (!file) {
      toast.error('Please choose a receipt file.');
      return;
    }

    setReceiptUploadBusyByTxId((prev) => ({ ...prev, [args.paymentTransactionId]: true }));
    try {
      const result = await uploadPaymentReceipt({
        file,
        paymentTransactionId: args.paymentTransactionId,
        studentId: assignment.student_id,
        replaceExistingReceipt: args.replaceExistingReceipt,
      });
      if (!result.success) {
        toast.error(result.message);
        return;
      }
      toast.success(args.replaceExistingReceipt ? 'Receipt replaced' : 'Receipt uploaded');
      setReceiptFileByTxId((prev) => ({ ...prev, [args.paymentTransactionId]: null }));
      await load();
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Receipt upload failed');
    } finally {
      setReceiptUploadBusyByTxId((prev) => ({ ...prev, [args.paymentTransactionId]: false }));
    }
  };

  const handleReorderTracked = (fromIndex: number, toIndex: number) => {
    try {
      setRows((prev) => {
        const currentOrder =
          pendingOrderIds ??
          prev.filter((r) => r.status === 'pending' && r.id != null).map((r) => r.id as number);
        const pendingIndexes = prev
          .map((r, i) => (r.status === 'pending' ? i : -1))
          .filter((i) => i >= 0);
        const fromPos = pendingIndexes.indexOf(fromIndex);
        const toPos = pendingIndexes.indexOf(toIndex);
        if (fromPos >= 0 && toPos >= 0) {
          const order = [...currentOrder];
          const [moved] = order.splice(fromPos, 1);
          order.splice(toPos, 0, moved);
          setPendingOrderIds(order);
        }
        return applyAmountReorderKeepingSlots(prev, fromIndex, toIndex);
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reorder blocked');
    }
  };

  const handleSave = async () => {
    if (!assignment) return;

    for (const row of rows) {
      const amountDue = parseAmountInput(row.amount) ?? 0;
      const paidAmount = parseAmountInput(row.paid_amount) ?? 0;
      const err = validatePaymentStatusChange({
        amountDue,
        paidAmount,
        status: row.status,
        paymentDate: row.payment_date ? pickerToIsoDate(row.payment_date) : null,
        waiverReason: row.waiver_reason || row.notes,
        waivedAmount:
          row.status === 'waived' ? parseAmountInput(row.waived_amount ?? '') ?? amountDue : 0,
      });
      if (err) {
        toast.error(`#${row.installment_number}: ${err}`);
        return;
      }
    }

    setSaving(true);
    try {
      if (pendingOrderIds && pendingOrderIds.length > 0) {
        await reorderPendingStudentInstallments(
          assignment.assignment_id,
          pendingOrderIds,
          staffUserId
        );
      }

      for (const row of rows) {
        if (!row.id) continue;
        const amountDue = Number(row.amount) || 0;
        await updateStudentInstallmentPaymentFields(
          row.id,
          {
            status: row.status,
            paid_amount: parseAmountInput(row.paid_amount) ?? 0,
            payment_date: row.payment_date || null,
            notes: row.notes,
            waived_amount:
              row.status === 'waived'
                ? parseAmountInput(row.waived_amount ?? '') ?? amountDue
                : 0,
            waiver_reason: row.status === 'waived' ? row.waiver_reason || row.notes : null,
            payment_reference: row.payment_reference || null,
          },
          staffUserId
        );
      }

      toast.success('Student installments saved');
      setSavedPaymentByInstallmentId(buildSavedPaymentSnapshot(rows));
      onSaved();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!assignment) return null;

  const assignedFee =
    assignment.assigned_total_amount ??
    assignment.total_amount ??
    assignment.template_plan_total ??
    0;
  const templateFee =
    assignment.template_total_amount ?? assignment.template_plan_total ?? assignedFee;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${assignment.display_student_name} — ${assignment.plan_name}`}
      size="full"
    >
      {loading ? (
        <Loader message="Loading installments…" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>
              Template fee: <strong>{formatCurrencyAud(templateFee, assignment.currency)}</strong>
            </span>
            <span>
              Assigned fee: <strong>{formatCurrencyAud(assignedFee, assignment.currency)}</strong>
            </span>
            <span>
              Cash received:{' '}
              <strong>{formatCurrencyAud(assignment.total_paid, assignment.currency)}</strong>
            </span>
            {(assignment.total_waived ?? 0) > 0 ? (
              <span>
                Waived:{' '}
                <strong>{formatCurrencyAud(assignment.total_waived, assignment.currency)}</strong>
              </span>
            ) : null}
            <span>
              Period: <strong>{assignment.payment_period}</strong>
              {isScheduleLocked ? ' (locked)' : ''}
            </span>
            <span>
              Instalments: <strong>{assignment.installment_count}</strong>
              {isScheduleLocked ? ' (locked)' : ''}
            </span>
          </div>
          {assignment.adjustment_reason ? (
            <p className="text-xs text-gray-500">
              Adjustment reason: {assignment.adjustment_reason}
            </p>
          ) : null}
          <p className="text-sm text-gray-600">
            Record payments manually. Drag Pending rows by the handle to change which amount is due
            on each date. Paid, Partial, and Waived rows stay locked in place.
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
            onReorderPending={handleReorderTracked}
          />

          <div className="border-t border-[var(--border)] pt-4 space-y-3">
            <div className="text-sm font-semibold text-[var(--text)]">Payment history &amp; receipts</div>
            <p className="text-xs text-gray-500">
              Each paid/partial save creates a payment transaction. Upload a receipt per transaction so partial
              payments keep separate files.
            </p>
            {hasAnyUnsavedPaymentChanges ? (
              <p className="text-xs text-amber-700">
                Save payment changes before uploading a receipt.
              </p>
            ) : null}

            {rows.length === 0 ? (
              <p className="text-sm text-gray-500">No installment rows loaded.</p>
            ) : paymentTransactions.length === 0 ? (
              <p className="text-sm text-gray-500">
                No payment transactions recorded yet. Save a Paid or Partial amount on an instalment to create
                one, then upload a receipt.
              </p>
            ) : (
              <div className="space-y-4">
                {rows.map((r) => {
                  const installmentId = r.id;
                  if (!installmentId) return null;
                  const txs = paymentTransactions.filter((t) => t.installment_id === installmentId);
                  if (txs.length === 0) return null;

                  return (
                    <div key={`inst-${installmentId}`} className="rounded-lg border border-gray-200 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="font-medium text-sm">
                          Instalment #{r.installment_number}
                        </div>
                        <div className="text-xs text-gray-600">
                          Amount: {formatCurrencyAud(Number(r.amount) || 0, assignment.currency)} · Paid:{' '}
                          {formatCurrencyAud(Number(r.paid_amount) || 0, assignment.currency)} · Status:{' '}
                          {r.status}
                        </div>
                      </div>

                      <div className="space-y-3">
                        {txs.map((tx) => {
                          const receipt = activeReceiptsByTxId[tx.id];
                          const busy = receiptUploadBusyByTxId[tx.id] ?? false;
                          const hasViewableReceipt = Boolean(receipt?.web_url);
                          const installmentUnsaved = hasUnsavedPaymentChanges(installmentId);
                          const uploadDisabled = busy || installmentUnsaved || !canUploadReceipts;

                          const amountLabel =
                            tx.status === 'waived'
                              ? `Waived ${formatCurrencyAud(tx.waived_amount, assignment.currency)}`
                              : formatCurrencyAud(tx.amount, assignment.currency);

                          return (
                            <div
                              key={`tx-${tx.id}`}
                              className="flex flex-col gap-2 rounded border border-gray-100 bg-gray-50/60 p-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-sm">
                                  <span className="font-medium capitalize">{tx.status}</span>
                                  <span className="ml-2 tabular-nums text-gray-700">{amountLabel}</span>
                                  <span className="ml-2 text-xs text-gray-400">#{tx.id}</span>
                                </div>
                                <div className="text-xs text-gray-500">
                                  {tx.payment_date ? isoToPickerDate(tx.payment_date) : 'No date'}
                                  {tx.payment_reference ? ` · Ref: ${tx.payment_reference}` : ''}
                                </div>
                              </div>

                              {tx.status === 'waived' ? (
                                <div className="text-sm text-gray-500">Receipts are not used for waived transactions.</div>
                              ) : installmentUnsaved ? (
                                <div className="text-sm text-amber-700">
                                  Save the payment before uploading a receipt.
                                </div>
                              ) : hasViewableReceipt && receipt ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <a
                                    href={receipt.web_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-sm text-[var(--brand)] hover:underline"
                                  >
                                    View receipt
                                  </a>
                                  <span className="text-xs text-gray-500 truncate max-w-[220px]" title={receipt.original_file_name}>
                                    {receipt.original_file_name || receipt.file_name}
                                  </span>

                                  <input
                                    type="file"
                                    accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0] ?? null;
                                      setReceiptFileByTxId((prev) => ({ ...prev, [tx.id]: f }));
                                    }}
                                    disabled={uploadDisabled}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      void handleReceiptUpload({
                                        paymentTransactionId: tx.id,
                                        installmentId,
                                        replaceExistingReceipt: true,
                                      })
                                    }
                                    disabled={uploadDisabled}
                                  >
                                    Replace receipt
                                  </Button>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    type="file"
                                    accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
                                    onChange={(e) => {
                                      const f = e.target.files?.[0] ?? null;
                                      setReceiptFileByTxId((prev) => ({ ...prev, [tx.id]: f }));
                                    }}
                                    disabled={uploadDisabled}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="primary"
                                    onClick={() =>
                                      void handleReceiptUpload({
                                        paymentTransactionId: tx.id,
                                        installmentId,
                                        replaceExistingReceipt: false,
                                      })
                                    }
                                    disabled={uploadDisabled}
                                  >
                                    Upload receipt
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
