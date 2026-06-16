import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { DatePicker } from '../ui/DatePicker';
import { SelectAsync } from '../ui/SelectAsync';
import { Card } from '../ui/Card';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import { listStudentsPaged } from '../../lib/formEngine';
import {
  addMonthsIso,
  calculateEqualInstallments,
  calculateUnevenInstallments,
  formatCurrencyAud,
  installmentSumMatchesTotal,
  isoToday,
  isoToPickerDate,
  parseAmountInput,
  pickerToIsoDate,
  roundCurrency,
  sumInstallmentAmounts,
} from '../../lib/paymentPlanCalculations';
import {
  assignPaymentPlanToStudent,
  confirmPaymentPlan,
  createPaymentPlan,
  fetchTemplateInstallments,
  generatePaymentPlanInstallments,
  listStudentPaymentPlansForPlan,
  saveCustomTemplateInstallments,
  unassignPaymentPlanFromStudent,
  updatePaymentPlan,
  updateTemplateInstallmentRow,
} from '../../services/paymentPlans';
import type {
  PaymentPlanConfirmAction,
  PaymentPlanFormValues,
  PaymentPlanSummary,
  PaymentPlanTemplateInstallment,
  StudentPaymentPlanSummary,
} from '../../types/paymentPlans';
import { CALCULATION_MODE_OPTIONS } from '../../types/paymentPlans';
import { PaymentPlanConfirmModal } from './PaymentPlanConfirmModal';
import {
  PaymentPlanInstallmentsTable,
  type EditableTemplateInstallmentRow,
} from './PaymentPlanInstallmentsTable';
import { StudentAssignmentInstallmentsModal } from './StudentAssignmentInstallmentsModal';

function defaultFormValues(): PaymentPlanFormValues {
  return {
    plan_name: '',
    total_amount: '',
    currency: 'AUD',
    installment_count: '12',
    start_date: isoToPickerDate(isoToday()),
    calculation_mode: 'equal',
    regular_monthly_amount: '',
    notes: '',
  };
}

function templateToEditable(row: PaymentPlanTemplateInstallment): EditableTemplateInstallmentRow {
  return {
    id: row.id,
    installment_number: row.installment_number,
    due_date: isoToPickerDate(row.due_date),
    amount: String(row.amount),
  };
}

function buildCustomSkeleton(count: number, startDatePicker: string, total: number): EditableTemplateInstallmentRow[] {
  const startIso = pickerToIsoDate(startDatePicker);
  const base = count > 0 ? roundCurrency(total / count) : 0;
  return Array.from({ length: count }, (_, i) => ({
    installment_number: i + 1,
    due_date: isoToPickerDate(addMonthsIso(startIso, i)),
    amount: String(base),
  }));
}

interface PaymentPlanEditorModalProps {
  isOpen: boolean;
  plan: PaymentPlanSummary | null;
  userId: number;
  onClose: () => void;
  onSaved: () => void;
}

export const PaymentPlanEditorModal: React.FC<PaymentPlanEditorModalProps> = ({
  isOpen,
  plan,
  userId,
  onClose,
  onSaved,
}) => {
  const isNew = plan == null;
  const isConfirmed = plan?.status === 'confirmed';

  const [form, setForm] = useState<PaymentPlanFormValues>(defaultFormValues);
  const [initialTotal, setInitialTotal] = useState('');
  const [installments, setInstallments] = useState<EditableTemplateInstallmentRow[]>([]);
  const [assignments, setAssignments] = useState<StudentPaymentPlanSummary[]>([]);
  const [assignStudentId, setAssignStudentId] = useState('');
  const [assignStudentLabel, setAssignStudentLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planId, setPlanId] = useState<number | null>(plan?.id ?? null);
  const [confirmAction, setConfirmAction] = useState<PaymentPlanConfirmAction | null>(null);
  const [confirmExtra, setConfirmExtra] = useState<string | undefined>();
  const [pendingConfirm, setPendingConfirm] = useState<(() => Promise<void>) | null>(null);
  const [viewAssignment, setViewAssignment] = useState<StudentPaymentPlanSummary | null>(null);

  const loadTemplateInstallments = useCallback(async (id: number) => {
    const rows = await fetchTemplateInstallments(id);
    setInstallments(rows.map(templateToEditable));
  }, []);

  const loadAssignments = useCallback(async (id: number) => {
    const rows = await listStudentPaymentPlansForPlan(id);
    setAssignments(rows);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (plan) {
      setPlanId(plan.id);
      setForm({
        plan_name: plan.plan_name,
        total_amount: String(plan.total_amount),
        currency: plan.currency || 'AUD',
        installment_count: String(plan.installment_count),
        start_date: isoToPickerDate(plan.start_date),
        calculation_mode: plan.calculation_mode,
        regular_monthly_amount:
          plan.regular_monthly_amount != null ? String(plan.regular_monthly_amount) : '',
        notes: plan.notes ?? '',
      });
      setInitialTotal(String(plan.total_amount));
      setLoading(true);
      Promise.all([loadTemplateInstallments(plan.id), loadAssignments(plan.id)])
        .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load plan'))
        .finally(() => setLoading(false));
    } else {
      setPlanId(null);
      setForm(defaultFormValues());
      setInitialTotal('');
      setInstallments([]);
      setAssignments([]);
      setAssignStudentId('');
      setAssignStudentLabel('');
    }
  }, [isOpen, plan, loadTemplateInstallments, loadAssignments]);

  const totalAmount = parseAmountInput(form.total_amount) ?? 0;
  const installmentSum = useMemo(
    () => sumInstallmentAmounts(installments.map((r) => parseAmountInput(r.amount) ?? 0)),
    [installments]
  );
  const difference = roundCurrency(totalAmount - installmentSum);
  const sumsMatch = installmentSumMatchesTotal(installmentSum, totalAmount);
  const hasInstallments = installments.length > 0;

  const previewError = useMemo(() => {
    if (form.calculation_mode === 'custom') return null;
    const count = Number.parseInt(form.installment_count, 10);
    const startIso = pickerToIsoDate(form.start_date);
    if (!totalAmount || !count) return null;
    try {
      if (form.calculation_mode === 'equal') {
        calculateEqualInstallments(totalAmount, count, startIso);
      } else {
        const regular = parseAmountInput(form.regular_monthly_amount);
        if (!regular) return 'Enter a regular monthly amount.';
        calculateUnevenInstallments(totalAmount, count, startIso, regular);
      }
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid installment calculation';
    }
  }, [form, totalAmount]);

  const loadStudentOptions = useCallback(async (page: number, search: string) => {
    const res = await listStudentsPaged(page, 20, search || undefined, 'active');
    return {
      options: res.data.map((s) => ({ value: String(s.id), label: `${s.name} (${s.email})` })),
      hasMore: res.page * res.pageSize < res.total,
    };
  }, []);

  const patchForm = (patch: Partial<PaymentPlanFormValues>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const openConfirm = (
    action: PaymentPlanConfirmAction,
    handler: () => Promise<void>,
    extraDetail?: string
  ) => {
    setConfirmAction(action);
    setConfirmExtra(extraDetail);
    setPendingConfirm(() => handler);
  };

  const runConfirmed = async () => {
    if (!pendingConfirm) return;
    setSaving(true);
    try {
      await pendingConfirm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setSaving(false);
      setConfirmAction(null);
      setPendingConfirm(null);
      setConfirmExtra(undefined);
    }
  };

  const ensurePlanSaved = async (): Promise<number> => {
    if (planId != null) {
      await updatePaymentPlan(planId, form);
      return planId;
    }
    const id = await createPaymentPlan(form, userId);
    setPlanId(id);
    setInitialTotal(form.total_amount);
    return id;
  };

  const handleSavePlan = async () => {
    const totalChanged = !isNew && form.total_amount.trim() !== initialTotal.trim();
    const performSave = async () => {
      const id = await ensurePlanSaved();
      if (!isNew && totalChanged) setInitialTotal(form.total_amount);
      if (!isConfirmed && form.calculation_mode === 'custom' && installments.length > 0) {
        await saveCustomTemplateInstallments(
          id,
          installments.map((r) => ({
            installment_number: r.installment_number,
            due_date: r.due_date,
            amount: parseAmountInput(r.amount) ?? 0,
          }))
        );
        await loadTemplateInstallments(id);
        await loadAssignments(id);
      }
      toast.success(isNew ? 'Payment plan created' : 'Payment plan saved');
      onSaved();
    };
    if (isNew) {
      openConfirm('create', performSave, `Fixed total: ${formatCurrencyAud(totalAmount, form.currency)}`);
      return;
    }
    if (totalChanged) {
      openConfirm(
        'change_total',
        performSave,
        `New total: ${formatCurrencyAud(totalAmount, form.currency)}`
      );
      return;
    }
    setSaving(true);
    try {
      await performSave();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = () => {
    openConfirm(
      hasInstallments ? 'overwrite' : 'generate',
      async () => {
        const id = await ensurePlanSaved();
        const regular =
          form.calculation_mode === 'uneven' ? parseAmountInput(form.regular_monthly_amount) : null;
        await generatePaymentPlanInstallments(id, regular);
        await loadTemplateInstallments(id);
        await loadAssignments(id);
        toast.success('Template installments generated');
        onSaved();
      },
      `Total ${formatCurrencyAud(totalAmount, form.currency)} · ${form.installment_count} installments`
    );
  };

  const handleConfirmLock = () => {
    if (!sumsMatch) {
      toast.error('Installment total must equal the plan total before confirming.');
      return;
    }
    openConfirm(
      'confirm_lock',
      async () => {
        let id = planId;
        if (id == null) id = await ensurePlanSaved();
        if (form.calculation_mode === 'custom') {
          await saveCustomTemplateInstallments(
            id,
            installments.map((r) => ({
              installment_number: r.installment_number,
              amount: parseAmountInput(r.amount) ?? 0,
              due_date: r.due_date,
            }))
          );
        }
        await confirmPaymentPlan(id, userId);
        toast.success('Payment plan confirmed and locked');
        onSaved();
        onClose();
      },
      `Total ${formatCurrencyAud(totalAmount, form.currency)} · sum ${formatCurrencyAud(installmentSum, form.currency)}`
    );
  };

  const handleAssignStudent = () => {
    const studentId = Number(assignStudentId);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      toast.error('Select a student to assign.');
      return;
    }
    openConfirm(
      'assign_student',
      async () => {
        let id = planId;
        if (id == null) id = await ensurePlanSaved();
        await assignPaymentPlanToStudent(id, studentId, userId, form.start_date);
        setAssignStudentId('');
        setAssignStudentLabel('');
        await loadAssignments(id);
        toast.success('Student assigned to payment plan');
        onSaved();
      },
      assignStudentLabel || `Student ID ${studentId}`
    );
  };

  const handleUnassign = (row: StudentPaymentPlanSummary) => {
    openConfirm(
      'unassign_student',
      async () => {
        await unassignPaymentPlanFromStudent(row.payment_plan_id, row.student_id);
        if (planId != null) await loadAssignments(planId);
        toast.success('Student removed from plan');
        onSaved();
      },
      row.display_student_name ?? `Student #${row.student_id}`
    );
  };

  const handleBuildCustomRows = () => {
    const count = Number.parseInt(form.installment_count, 10);
    if (!Number.isFinite(count) || count < 1 || !totalAmount) {
      toast.error('Enter total amount and installment count first.');
      return;
    }
    const build = () => setInstallments(buildCustomSkeleton(count, form.start_date, totalAmount));
    if (hasInstallments) {
      openConfirm('overwrite', async () => {
        build();
        setConfirmAction(null);
        setPendingConfirm(null);
      });
    } else {
      build();
    }
  };

  const handleApplyPreview = () => {
    if (previewError) {
      toast.error(previewError);
      return;
    }
    const count = Number.parseInt(form.installment_count, 10);
    const startIso = pickerToIsoDate(form.start_date);
    const preview =
      form.calculation_mode === 'equal'
        ? calculateEqualInstallments(totalAmount, count, startIso)
        : calculateUnevenInstallments(
            totalAmount,
            count,
            startIso,
            parseAmountInput(form.regular_monthly_amount) ?? 0
          );
    setInstallments(
      preview.map((p) => ({
        installment_number: p.installment_number,
        due_date: isoToPickerDate(p.due_date),
        amount: String(p.amount),
      }))
    );
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={isNew ? 'Create payment plan' : isConfirmed ? 'Payment plan (confirmed)' : 'Edit payment plan'}
        size="xl"
      >
        <div className="space-y-5">
          {loading ? (
            <Loader message="Loading plan…" />
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Reusable plan template — assign to many students (like courses). Each student gets their
                own installment schedule copied from this template.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <Input
                  label="Plan name"
                  value={form.plan_name}
                  onChange={(e) => patchForm({ plan_name: e.target.value })}
                  required
                />
                <Input
                  label="Currency"
                  value={form.currency}
                  onChange={(e) => patchForm({ currency: e.target.value })}
                  disabled={isConfirmed}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Input
                  label="Total amount (fixed)"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.total_amount}
                  onChange={(e) => patchForm({ total_amount: e.target.value })}
                  required
                  disabled={isConfirmed}
                />
                <Input
                  label="Number of installments"
                  type="number"
                  min="1"
                  value={form.installment_count}
                  onChange={(e) => patchForm({ installment_count: e.target.value })}
                  disabled={isConfirmed}
                />
                <div>
                  <DatePicker
                    label="Default start date"
                    value={form.start_date}
                    onChange={(v) => patchForm({ start_date: v })}
                    disabled={isConfirmed}
                  />
                </div>
                <Select
                  label="Calculation mode"
                  value={form.calculation_mode}
                  onChange={(v) =>
                    patchForm({ calculation_mode: v as PaymentPlanFormValues['calculation_mode'] })
                  }
                  options={CALCULATION_MODE_OPTIONS}
                  disabled={isConfirmed}
                />
              </div>

              {form.calculation_mode === 'uneven' ? (
                <Input
                  label="Regular monthly amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.regular_monthly_amount}
                  onChange={(e) => patchForm({ regular_monthly_amount: e.target.value })}
                  disabled={isConfirmed}
                />
              ) : null}

              <Input
                label="Notes"
                value={form.notes}
                onChange={(e) => patchForm({ notes: e.target.value })}
              />

              {!isConfirmed ? (
                <div className="flex flex-wrap gap-2">
                  {form.calculation_mode === 'custom' ? (
                    <Button type="button" variant="secondary" size="sm" onClick={handleBuildCustomRows}>
                      Build custom rows
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleApplyPreview}
                        disabled={Boolean(previewError)}
                      >
                        Preview in table
                      </Button>
                      <Button type="button" variant="primary" size="sm" onClick={handleGenerate}>
                        Generate template installments
                      </Button>
                    </>
                  )}
                </div>
              ) : null}

              {previewError && form.calculation_mode !== 'custom' ? (
                <p className="text-sm text-red-600">{previewError}</p>
              ) : null}

              <Card className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--text)]">Template installments</h3>
                  <div className="text-sm text-gray-600">
                    Sum:{' '}
                    <span className={sumsMatch ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                      {formatCurrencyAud(installmentSum, form.currency)}
                    </span>
                    {' · '}
                    Target: {formatCurrencyAud(totalAmount, form.currency)}
                    {' · '}
                    Difference: {formatCurrencyAud(difference, form.currency)}
                  </div>
                </div>
                <PaymentPlanInstallmentsTable
                  mode="template"
                  rows={installments}
                  currency={form.currency}
                  isDraft={!isConfirmed}
                  onChangeRow={(index, patch) => {
                    setInstallments((prev) => {
                      const next = [...prev];
                      next[index] = { ...next[index], ...patch };
                      return next;
                    });
                    const row = installments[index];
                    if (!isConfirmed && row?.id && (patch.due_date != null || patch.amount != null)) {
                      void updateTemplateInstallmentRow(row.id, {
                        due_date: patch.due_date ?? row.due_date,
                        amount: parseAmountInput(patch.amount ?? row.amount) ?? 0,
                      }).catch(() => undefined);
                    }
                  }}
                />
              </Card>

              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2 text-[#ea580c]">
                  <Users className="h-4 w-4" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    Assigned students ({assignments.length})
                  </h3>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="min-w-[240px] flex-1">
                    <SelectAsync
                      label="Add student"
                      value={assignStudentId}
                      selectedLabel={assignStudentLabel}
                      onChange={(v) => {
                        setAssignStudentId(v);
                        void loadStudentOptions(1, '').then((res) => {
                          const hit = res.options.find((o) => o.value === v);
                          setAssignStudentLabel(hit?.label ?? '');
                        });
                      }}
                      loadOptions={loadStudentOptions}
                      attachDropdown="trigger"
                    />
                  </div>
                  <Button variant="secondary" size="sm" onClick={handleAssignStudent} disabled={!assignStudentId}>
                    Assign to plan
                  </Button>
                </div>
                {assignments.length === 0 ? (
                  <p className="text-sm text-gray-500">No students assigned yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {assignments.map((a) => (
                      <li
                        key={a.assignment_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2"
                      >
                        <div>
                          <div className="font-medium text-sm">{a.display_student_name}</div>
                          <div className="text-xs text-gray-500">
                            {formatCurrencyAud(a.total_paid, a.currency)} paid · {a.paid_count}/
                            {a.installment_count} installments
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setViewAssignment(a)}>
                            View installments
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleUnassign(a)}>
                            Remove
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                {!isConfirmed ? (
                  <>
                    <Button variant="secondary" onClick={() => void handleSavePlan()} disabled={saving}>
                      {isNew ? 'Create payment plan' : 'Save draft'}
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleConfirmLock}
                      disabled={saving || !sumsMatch || installments.length === 0}
                    >
                      Confirm & lock plan
                    </Button>
                  </>
                ) : (
                  <Button variant="primary" onClick={() => void handleSavePlan()} disabled={saving}>
                    Save
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      <PaymentPlanConfirmModal
        isOpen={confirmAction != null}
        action={confirmAction}
        extraDetail={confirmExtra}
        loading={saving}
        onCancel={() => {
          setConfirmAction(null);
          setPendingConfirm(null);
          setConfirmExtra(undefined);
        }}
        onConfirm={() => void runConfirmed()}
      />

      <StudentAssignmentInstallmentsModal
        isOpen={viewAssignment != null}
        assignment={viewAssignment}
        onClose={() => setViewAssignment(null)}
        onSaved={onSaved}
      />
    </>
  );
};
