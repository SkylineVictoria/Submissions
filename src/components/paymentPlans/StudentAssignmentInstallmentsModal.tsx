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
  fetchPaymentAllocationsForTransactions,
  fetchPaymentTransactionsForAssignment,
  updateStudentInstallmentPaymentFields,
} from '../../services/paymentPlans';
import type {
  PaymentReceipt,
  StudentPaymentAllocation,
  StudentPaymentPlanInstallmentTransaction,
  StudentPaymentPlanSummary,
} from '../../types/paymentPlans';
import {
  formatCurrencyAud,
  isoToPickerDate,
  parseAmountInput,
  pickerToIsoDate,
  validatePaymentStatusChange,
} from '../../lib/paymentPlanCalculations';
import {
  computeDueNow,
  sumCashReceivedFromTransactions,
  totalOutstandingBalance,
  type FifoInstallmentInput,
} from '../../lib/paymentAllocation';
import {
  PaymentPlanInstallmentsTable,
  type EditableStudentInstallmentRow,
} from './PaymentPlanInstallmentsTable';
import { RecordPaymentModal } from './RecordPaymentModal';
import { CorrectPaymentModal } from './CorrectPaymentModal';

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
  const canManage = canManagePaymentPlans(user);
  const isSuperAdmin = user?.role === 'superadmin';

  const [loading, setLoading] = useState(false);
  const [savingWaiver, setSavingWaiver] = useState(false);
  const [rows, setRows] = useState<EditableStudentInstallmentRow[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<StudentPaymentPlanInstallmentTransaction[]>([]);
  const [allocations, setAllocations] = useState<StudentPaymentAllocation[]>([]);
  const [activeReceiptsByTxId, setActiveReceiptsByTxId] = useState<Record<number, PaymentReceipt>>({});
  const [recordOpen, setRecordOpen] = useState(false);
  const [correctTx, setCorrectTx] = useState<StudentPaymentPlanInstallmentTransaction | null>(null);

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

      const txs = await fetchPaymentTransactionsForAssignment(assignment.assignment_id);
      setPaymentTransactions(txs);

      const txIds = txs.map((t) => t.id);
      if (txIds.length > 0) {
        const [receipts, allocs] = await Promise.all([
          fetchActivePaymentReceiptsForTransactions(txIds).catch(() => [] as PaymentReceipt[]),
          fetchPaymentAllocationsForTransactions(txIds).catch(() => [] as StudentPaymentAllocation[]),
        ]);
        setActiveReceiptsByTxId(
          receipts.reduce<Record<number, PaymentReceipt>>((acc, r) => {
            acc[r.payment_transaction_id] = r;
            return acc;
          }, {})
        );
        setAllocations(allocs);
      } else {
        setActiveReceiptsByTxId({});
        setAllocations([]);
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

  const cashReceived = useMemo(
    () => sumCashReceivedFromTransactions(paymentTransactions),
    [paymentTransactions]
  );
  const outstandingPlan = useMemo(() => totalOutstandingBalance(fifoInputs), [fifoInputs]);
  const currentDueRow = useMemo(() => {
    const ordered = [...fifoInputs].sort((a, b) => a.installment_number - b.installment_number);
    return ordered.find((i) => i.status === 'partial' || i.status === 'pending' || i.status === 'overdue');
  }, [fifoInputs]);
  const dueNow = currentDueRow
    ? computeDueNow({ installments: fifoInputs, currentInstallmentId: currentDueRow.id })
    : null;

  const allocationsByTx = useMemo(() => {
    const map = new Map<number, StudentPaymentAllocation[]>();
    for (const a of allocations) {
      const list = map.get(a.payment_transaction_id) ?? [];
      list.push(a);
      map.set(a.payment_transaction_id, list);
    }
    return map;
  }, [allocations]);

  const handleSaveWaivers = async () => {
    if (!assignment) return;
    const waiverRows = rows.filter((r) => r.status === 'waived');
    for (const row of waiverRows) {
      const amountDue = parseAmountInput(row.amount) ?? 0;
      const err = validatePaymentStatusChange({
        amountDue,
        paidAmount: 0,
        status: 'waived',
        paymentDate: row.payment_date ? pickerToIsoDate(row.payment_date) : null,
        waiverReason: row.waiver_reason || row.notes,
        waivedAmount: parseAmountInput(row.waived_amount ?? '') ?? amountDue,
      });
      if (err) {
        toast.error(`#${row.installment_number}: ${err}`);
        return;
      }
    }

    setSavingWaiver(true);
    try {
      for (const row of waiverRows) {
        if (!row.id) continue;
        const amountDue = Number(row.amount) || 0;
        await updateStudentInstallmentPaymentFields(
          row.id,
          {
            status: 'waived',
            paid_amount: 0,
            payment_date: row.payment_date || null,
            notes: row.notes,
            waived_amount: parseAmountInput(row.waived_amount ?? '') ?? amountDue,
            waiver_reason: row.waiver_reason || row.notes,
            payment_reference: row.payment_reference || null,
          },
          staffUserId
        );
      }
      toast.success('Waiver(s) saved');
      onSaved();
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingWaiver(false);
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

  const historyTxs = paymentTransactions.filter((t) => t.status !== 'waived' || t.amount === 0);

  return (
    <>
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
                <strong>{formatCurrencyAud(cashReceived, assignment.currency)}</strong>
              </span>
              <span>
                Outstanding plan balance:{' '}
                <strong>{formatCurrencyAud(outstandingPlan, assignment.currency)}</strong>
              </span>
              {dueNow && dueNow.total_due_now > 0 ? (
                <span>
                  Due now: <strong>{formatCurrencyAud(dueNow.total_due_now, assignment.currency)}</strong>
                </span>
              ) : null}
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
            </div>

            {dueNow && dueNow.previous_outstanding > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm space-y-0.5 max-w-md">
                <div className="flex justify-between gap-6">
                  <span>Previous outstanding</span>
                  <span className="tabular-nums">
                    {formatCurrencyAud(dueNow.previous_outstanding, assignment.currency)}
                  </span>
                </div>
                <div className="flex justify-between gap-6">
                  <span>Current instalment</span>
                  <span className="tabular-nums">
                    {formatCurrencyAud(dueNow.current_installment_outstanding, assignment.currency)}
                  </span>
                </div>
                <div className="flex justify-between gap-6 border-t border-amber-200 pt-1 font-semibold">
                  <span>Total due now</span>
                  <span className="tabular-nums">
                    {formatCurrencyAud(dueNow.total_due_now, assignment.currency)}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gray-600">
                Schedule view — paid amounts come from posted payment allocations. Use Record payment for cash.
              </p>
              {canManage ? (
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => setRecordOpen(true)}
                  disabled={outstandingPlan <= 0}
                >
                  Record payment
                </Button>
              ) : null}
            </div>

            <PaymentPlanInstallmentsTable
              mode="student"
              rows={rows}
              currency={assignment.currency}
              isDraft={!isScheduleLocked}
              scheduleView
              onChangeRow={(index, patch) => {
                // Schedule view: only allow marking waived + reason while unlocked for status edits via notes path.
                // Cash fields are locked in the table; ignore paid_amount patches.
                const { paid_amount: _paid, payment_date: _pd, payment_reference: _ref, ...safe } = patch;
                setRows((prev) => {
                  const next = [...prev];
                  next[index] = { ...next[index], ...safe };
                  return next;
                });
              }}
            />

            <div className="border-t border-[var(--border)] pt-4 space-y-3">
              <div className="text-sm font-semibold text-[var(--text)]">Payment history &amp; receipts</div>
              <p className="text-xs text-gray-500">
                Each posted payment has one receipt. Allocations show how the payment was applied across instalments.
                Posted payments are immutable; only Super Admin may correct them.
              </p>

              {historyTxs.length === 0 ? (
                <p className="text-sm text-gray-500">No payment transactions recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {historyTxs.map((tx) => {
                    const receipt = activeReceiptsByTxId[tx.id];
                    const lines = allocationsByTx.get(tx.id) ?? [];
                    const isCorrected = tx.posting_status === 'corrected' || tx.is_active === false;
                    const isActivePosted = (tx.is_active ?? true) && (tx.posting_status ?? 'posted') === 'posted';

                    return (
                      <div
                        key={`tx-${tx.id}`}
                        className={`rounded-lg border p-3 ${isCorrected ? 'border-gray-200 bg-gray-50 opacity-80' : 'border-gray-200'}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-sm">
                              Payment #{tx.id}
                              {tx.correction_of_transaction_id ? (
                                <span className="ml-2 text-xs font-normal text-gray-500">
                                  (correction of #{tx.correction_of_transaction_id})
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {tx.payment_date ? isoToPickerDate(tx.payment_date) : 'No date'}
                              {tx.payment_reference ? ` · Ref: ${tx.payment_reference}` : ''}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="tabular-nums font-semibold">
                              {tx.status === 'waived'
                                ? `Waived ${formatCurrencyAud(tx.waived_amount, assignment.currency)}`
                                : formatCurrencyAud(tx.amount, assignment.currency)}
                            </div>
                            <div className="text-xs capitalize text-gray-600">
                              {isCorrected ? 'Corrected' : isActivePosted ? 'Posted' : tx.posting_status}
                            </div>
                          </div>
                        </div>

                        {tx.correction_reason ? (
                          <p className="text-xs text-gray-600 mt-2">Reason: {tx.correction_reason}</p>
                        ) : null}

                        {tx.status !== 'waived' && lines.length > 0 ? (
                          <div className="mt-2 text-sm space-y-0.5">
                            <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                              Allocation
                            </div>
                            {lines.map((line) => (
                              <div key={line.id} className="flex justify-between gap-4">
                                <span>
                                  Instalment #
                                  {line.installment_number ??
                                    rows.find((r) => r.id === line.installment_id)?.installment_number ??
                                    line.installment_id}
                                </span>
                                <span className="tabular-nums">
                                  {formatCurrencyAud(line.allocated_amount, assignment.currency)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {tx.status === 'waived' ? (
                          <p className="text-sm text-gray-500 mt-2">Receipts are not used for waived transactions.</p>
                        ) : receipt?.web_url ? (
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <a
                              href={receipt.web_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm text-[var(--brand)] hover:underline"
                            >
                              View receipt
                            </a>
                            <span className="text-xs text-gray-500 truncate max-w-[240px]">
                              {receipt.original_file_name || receipt.file_name}
                            </span>
                          </div>
                        ) : isActivePosted ? (
                          <p className="text-xs text-amber-700 mt-2">
                            No active receipt on file (legacy transaction).
                          </p>
                        ) : null}

                        {isSuperAdmin && isActivePosted && tx.status !== 'waived' ? (
                          <div className="mt-2">
                            <Button type="button" size="sm" variant="outline" onClick={() => setCorrectTx(tx)}>
                              Correct payment
                            </Button>
                          </div>
                        ) : null}
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
              {rows.some((r) => r.status === 'waived') ? (
                <Button variant="primary" onClick={() => void handleSaveWaivers()} disabled={savingWaiver}>
                  Save waivers
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </Modal>

      {assignment ? (
        <RecordPaymentModal
          isOpen={recordOpen}
          onClose={() => setRecordOpen(false)}
          onRecorded={() => {
            onSaved();
            void load();
          }}
          assignmentId={assignment.assignment_id}
          studentId={assignment.student_id}
          currency={assignment.currency}
          rows={rows}
        />
      ) : null}

      <CorrectPaymentModal
        isOpen={correctTx != null}
        onClose={() => setCorrectTx(null)}
        onCorrected={() => {
          onSaved();
          void load();
        }}
        transaction={correctTx}
        currency={assignment.currency}
      />
    </>
  );
};
