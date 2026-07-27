import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { SelectAsync } from '../ui/SelectAsync';
import { Loader } from '../ui/Loader';
import { DatePicker } from '../ui/DatePicker';
import { Input } from '../ui/Input';
import { toast } from '../../utils/toast';
import {
  assignPaymentPlanWithInstallments,
  fetchTemplateInstallments,
  listPaymentPlanSummaries,
} from '../../services/paymentPlans';
import type {
  AssignInstallmentDraft,
  PaymentPeriod,
  PaymentPlanSummary,
  StudentPaymentPlanContext,
} from '../../types/paymentPlans';
import { PAYMENT_PERIOD_OPTIONS } from '../../types/paymentPlans';
import {
  assignmentScheduleHasManualEdits,
  assignDraftToInput,
  buildAssignmentScheduleFromPlan,
  formatCurrencyAud,
  installmentCountOptions,
  isoToPickerDate,
  isoToday,
  MAX_INSTALLMENT_COUNT,
  parseAmountInput,
  pickerToIsoDate,
  previewToAssignDraft,
  roundCurrency,
  validateAssignInstallmentDrafts,
  validateInstallmentCount,
} from '../../lib/paymentPlanCalculations';
import { PaymentPlanAssignmentSchedule } from './PaymentPlanAssignmentSchedule';
import { PaymentPlanConfirmModal } from './PaymentPlanConfirmModal';
import { supabase } from '../../lib/supabase';

interface AssignPaymentPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssigned: () => void;
  userId: number;
  student?: StudentPaymentPlanContext;
  fixedPlan?: PaymentPlanSummary | null;
}

type PendingStructuralChange =
  | { kind: 'startDate'; value: string }
  | { kind: 'period'; value: PaymentPeriod }
  | { kind: 'count'; value: number }
  | { kind: 'fee'; value: number };

export const AssignPaymentPlanModal: React.FC<AssignPaymentPlanModalProps> = ({
  isOpen,
  onClose,
  onAssigned,
  userId,
  student,
  fixedPlan,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planOptions, setPlanOptions] = useState<PaymentPlanSummary[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlanSummary | null>(fixedPlan ?? null);
  const [assignStudentId, setAssignStudentId] = useState('');
  const [assignStudentLabel, setAssignStudentLabel] = useState('');
  const [startDate, setStartDate] = useState(isoToPickerDate(isoToday()));
  const [scheduleRows, setScheduleRows] = useState<AssignInstallmentDraft[]>([]);
  const [assignedFee, setAssignedFee] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [paymentPeriod, setPaymentPeriod] = useState<PaymentPeriod>('monthly');
  const [installmentCount, setInstallmentCount] = useState(12);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
  const [pendingStructural, setPendingStructural] = useState<PendingStructuralChange | null>(null);

  const activePlan = fixedPlan ?? selectedPlan;
  const initRef = useRef(false);
  const baselineScheduleRef = useRef<AssignInstallmentDraft[]>([]);
  const templateRowsRef = useRef<
    Array<{ installment_number: number; due_date: string; amount: number }>
  >([]);

  const templateTotal = activePlan?.total_amount ?? 0;
  const assignedTotalNum = parseAmountInput(assignedFee) ?? templateTotal;
  const adjustment = roundCurrency(assignedTotalNum - templateTotal);

  const countSelectOptions = useMemo(() => {
    const opts = installmentCountOptions(24);
    if (installmentCount > 24 && installmentCount <= MAX_INSTALLMENT_COUNT) {
      opts.push({ value: String(installmentCount), label: String(installmentCount) });
    }
    return opts;
  }, [installmentCount]);

  const rebuildSchedule = useCallback(
    (
      plan: PaymentPlanSummary,
      assignmentStart: string,
      period: PaymentPeriod,
      fee: number,
      count: number
    ) => {
      const preview = buildAssignmentScheduleFromPlan(
        {
          total_amount: plan.total_amount,
          installment_count: count,
          start_date: plan.start_date,
          calculation_mode: plan.calculation_mode,
          regular_monthly_amount: plan.regular_monthly_amount,
          payment_period: period,
        },
        assignmentStart,
        templateRowsRef.current,
        period,
        fee,
        count
      );
      const drafts = preview.map((row) => previewToAssignDraft(row));
      baselineScheduleRef.current = drafts;
      setScheduleRows(drafts);
    },
    []
  );

  const scheduleIsDirty = useCallback(() => {
    const baseline = baselineScheduleRef.current;
    if (baseline.length === 0 || scheduleRows.length === 0) return false;
    return assignmentScheduleHasManualEdits(
      scheduleRows,
      baseline.map((b) => ({
        installment_number: b.installment_number,
        due_date: pickerToIsoDate(b.due_date),
        amount: parseAmountInput(b.amount) ?? 0,
      }))
    );
  }, [scheduleRows]);

  const applyStructuralChange = useCallback(
    (change: PendingStructuralChange) => {
      if (!activePlan) return;
      let nextStart = startDate;
      let nextPeriod = paymentPeriod;
      let nextCount = installmentCount;
      let nextFee = parseAmountInput(assignedFee) ?? activePlan.total_amount;

      if (change.kind === 'startDate') {
        nextStart = change.value;
        setStartDate(change.value);
      } else if (change.kind === 'period') {
        nextPeriod = change.value;
        setPaymentPeriod(change.value);
      } else if (change.kind === 'count') {
        nextCount = change.value;
        setInstallmentCount(change.value);
      } else if (change.kind === 'fee') {
        nextFee = change.value;
        setAssignedFee(String(change.value));
      }

      rebuildSchedule(activePlan, nextStart, nextPeriod, nextFee, nextCount);
    },
    [
      activePlan,
      assignedFee,
      installmentCount,
      paymentPeriod,
      rebuildSchedule,
      startDate,
    ]
  );

  const requestStructuralChange = (change: PendingStructuralChange) => {
    if (!activePlan) return;
    if (scheduleRows.length > 0 && scheduleIsDirty()) {
      setPendingStructural(change);
      setRegenConfirmOpen(true);
      return;
    }
    applyStructuralChange(change);
  };

  const loadSchedule = useCallback(
    async (
      plan: PaymentPlanSummary,
      assignmentStart: string,
      period: PaymentPeriod,
      fee: number,
      count: number
    ) => {
      setLoading(true);
      try {
        const templates = await fetchTemplateInstallments(plan.id);
        templateRowsRef.current = templates.map((t) => ({
          installment_number: t.installment_number,
          due_date: t.due_date,
          amount: t.amount,
        }));
        rebuildSchedule(plan, assignmentStart, period, fee, count);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to load schedule');
        setScheduleRows([]);
      } finally {
        setLoading(false);
      }
    },
    [rebuildSchedule]
  );

  useEffect(() => {
    if (!isOpen) {
      initRef.current = false;
      return;
    }
    if (initRef.current) return;
    initRef.current = true;

    const today = isoToPickerDate(isoToday());
    setStartDate(today);
    setScheduleRows([]);
    baselineScheduleRef.current = [];
    setAssignStudentId('');
    setAssignStudentLabel('');
    setAdjustmentReason('');
    setRegenConfirmOpen(false);
    setPendingStructural(null);

    if (fixedPlan) {
      const count = Math.max(1, fixedPlan.installment_count || 12);
      setSelectedPlan(fixedPlan);
      setSelectedPlanId(String(fixedPlan.id));
      setAssignedFee(String(fixedPlan.total_amount));
      setPaymentPeriod(fixedPlan.payment_period ?? 'monthly');
      setInstallmentCount(count);
      void loadSchedule(
        fixedPlan,
        today,
        fixedPlan.payment_period ?? 'monthly',
        fixedPlan.total_amount,
        count
      );
      return;
    }

    setSelectedPlanId('');
    setSelectedPlan(null);
    setAssignedFee('');
    setPaymentPeriod('monthly');
    setInstallmentCount(12);
    setLoading(true);
    void listPaymentPlanSummaries()
      .then(setPlanOptions)
      .catch((e) => {
        toast.error(e instanceof Error ? e.message : 'Failed to load plans');
        setPlanOptions([]);
      })
      .finally(() => setLoading(false));
  }, [isOpen, fixedPlan, loadSchedule]);

  useEffect(() => {
    if (!isOpen || fixedPlan) return;
    const planId = Number(selectedPlanId);
    if (!Number.isFinite(planId) || planId <= 0) {
      setSelectedPlan(null);
      setScheduleRows([]);
      return;
    }
    const plan = planOptions.find((p) => p.id === planId) ?? null;
    setSelectedPlan(plan);
    if (plan) {
      const fee = plan.total_amount;
      const period = plan.payment_period ?? 'monthly';
      const count = Math.max(1, plan.installment_count || 12);
      setAssignedFee(String(fee));
      setPaymentPeriod(period);
      setInstallmentCount(count);
      void loadSchedule(plan, startDate, period, fee, count);
    }
  }, [isOpen, fixedPlan, selectedPlanId, planOptions, loadSchedule]);

  const loadStudentOptions = useCallback(async (page: number, search: string) => {
    const limit = 20;
    const from = (page - 1) * limit;
    let query = supabase
      .from('skyline_students')
      .select('id, name, email', { count: 'exact' })
      .order('name', { ascending: true })
      .range(from, from + limit - 1);

    const term = search.trim();
    if (term) {
      query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);

    return {
      options: (data ?? []).map((s) => ({
        value: String(s.id),
        label: `${s.name}${s.email ? ` (${s.email})` : ''}`,
      })),
      hasMore: count != null ? from + limit < count : false,
    };
  }, []);

  const studentName = useMemo(() => {
    if (student) return student.name;
    return assignStudentLabel || 'Selected student';
  }, [student, assignStudentLabel]);

  const scheduleTotal = useMemo(
    () =>
      roundCurrency(
        scheduleRows.reduce((sum, r) => sum + (parseAmountInput(r.amount) ?? 0), 0)
      ),
    [scheduleRows]
  );

  const firstDue = scheduleRows[0]?.due_date ?? startDate;
  const lastDue = scheduleRows[scheduleRows.length - 1]?.due_date ?? startDate;

  const tryOpenConfirm = () => {
    const planId = activePlan?.id;
    const studentId = student?.id ?? Number(assignStudentId);
    if (!planId) {
      toast.error('Select a payment plan.');
      return;
    }
    if (!Number.isFinite(studentId) || studentId <= 0) {
      toast.error('Select a student.');
      return;
    }

    const countErr = validateInstallmentCount(installmentCount);
    if (countErr) {
      toast.error(countErr);
      return;
    }

    const validationError = validateAssignInstallmentDrafts(
      scheduleRows,
      assignedTotalNum,
      templateTotal,
      adjustmentReason,
      installmentCount
    );
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setConfirmOpen(true);
  };

  const handleAssign = async () => {
    const planId = activePlan?.id;
    const studentId = student?.id ?? Number(assignStudentId);
    if (!planId || !Number.isFinite(studentId)) return;

    // Re-validate without regenerating — preserve manual amounts.
    const validationError = validateAssignInstallmentDrafts(
      scheduleRows,
      assignedTotalNum,
      templateTotal,
      adjustmentReason,
      installmentCount
    );
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      await assignPaymentPlanWithInstallments(
        planId,
        studentId,
        userId,
        startDate,
        scheduleRows.map(assignDraftToInput),
        {
          assignedTotalAmount: assignedTotalNum,
          adjustmentReason: adjustment !== 0 ? adjustmentReason.trim() : null,
          paymentPeriod,
          installmentCount,
        }
      );
      toast.success('Payment plan assigned');
      setConfirmOpen(false);
      onAssigned();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign plan');
    } finally {
      setSaving(false);
    }
  };

  const title = student
    ? 'Assign payment plan'
    : `Assign student to ${fixedPlan?.plan_name ?? 'plan'}`;

  const confirmMessage = [
    `Student: ${studentName}`,
    `Payment plan template: ${activePlan?.plan_name ?? ''}`,
    `Default template fee: ${formatCurrencyAud(templateTotal, activePlan?.currency ?? 'AUD')}`,
    `Assigned student fee: ${formatCurrencyAud(assignedTotalNum, activePlan?.currency ?? 'AUD')}`,
    `Adjustment: ${formatCurrencyAud(adjustment, activePlan?.currency ?? 'AUD')}`,
    adjustment !== 0 ? `Adjustment reason: ${adjustmentReason.trim()}` : null,
    `Payment period: ${PAYMENT_PERIOD_OPTIONS.find((o) => o.value === paymentPeriod)?.label ?? paymentPeriod}`,
    `Instalment count: ${installmentCount}`,
    `First due: ${firstDue}`,
    `Last due: ${lastDue}`,
    `Schedule total: ${formatCurrencyAud(scheduleTotal, activePlan?.currency ?? 'AUD')}`,
    '',
    'All instalments will start as Pending. No payment is recorded by this assignment.',
  ]
    .filter((line) => line != null)
    .join('\n');

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={title} size="full">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {student ? (
              <>
                Configure a student-specific payment schedule for <strong>{student.name}</strong> from
                a reusable template. Joining fees paid before enrolment are not marked Paid here —
                record payments only after money is received.
              </>
            ) : (
              <>
                Choose a student and customize their installment schedule before assigning them to
                this plan template. Assignment creates the schedule only.
              </>
            )}
          </p>

          {!fixedPlan ? (
            <Select
              label="Payment plan template"
              value={selectedPlanId}
              onChange={setSelectedPlanId}
              options={[
                { value: '', label: 'Select a plan…' },
                ...planOptions.map((p) => ({
                  value: String(p.id),
                  label: `${p.plan_name} — ${formatCurrencyAud(p.total_amount, p.currency)}`,
                })),
              ]}
            />
          ) : null}

          {!student ? (
            <SelectAsync
              label="Student"
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
          ) : null}

          {activePlan ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    First due date / schedule start
                  </label>
                  <DatePicker
                    value={startDate}
                    onChange={(v) => requestStructuralChange({ kind: 'startDate', value: v })}
                  />
                </div>
                <Select
                  label="Payment period"
                  value={paymentPeriod}
                  onChange={(v) =>
                    requestStructuralChange({ kind: 'period', value: v as PaymentPeriod })
                  }
                  options={PAYMENT_PERIOD_OPTIONS}
                />
                <Select
                  label="Instalment count"
                  value={String(installmentCount)}
                  onChange={(v) => {
                    const n = Number.parseInt(v, 10);
                    const err = validateInstallmentCount(n);
                    if (err) {
                      toast.error(err);
                      return;
                    }
                    requestStructuralChange({ kind: 'count', value: n });
                  }}
                  options={countSelectOptions}
                />
                <Input
                  label="Default template fee"
                  value={formatCurrencyAud(templateTotal, activePlan.currency)}
                  disabled
                />
                <Input
                  label="Assigned student fee"
                  type="number"
                  step="0.01"
                  min="0"
                  value={assignedFee}
                  onChange={(e) => setAssignedFee(e.target.value)}
                  onBlur={() => {
                    const fee = parseAmountInput(assignedFee);
                    if (fee == null || fee <= 0) return;
                    requestStructuralChange({ kind: 'fee', value: fee });
                  }}
                />
              </div>

              <div className="rounded-lg border border-[var(--border)] bg-gray-50 px-3 py-2 text-sm">
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <span>
                    Default fee:{' '}
                    <strong>{formatCurrencyAud(templateTotal, activePlan.currency)}</strong>
                  </span>
                  <span>
                    Student fee:{' '}
                    <strong>{formatCurrencyAud(assignedTotalNum, activePlan.currency)}</strong>
                  </span>
                  <span>
                    Adjustment:{' '}
                    <strong>{formatCurrencyAud(adjustment, activePlan.currency)}</strong>
                  </span>
                </div>
              </div>

              {adjustment !== 0 ? (
                <Input
                  label="Adjustment reason (required)"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="e.g. Management-approved course discount"
                />
              ) : null}

              {loading ? (
                <Loader message="Loading payment schedule…" />
              ) : (
                <PaymentPlanAssignmentSchedule
                  rows={scheduleRows}
                  currency={activePlan.currency}
                  planTotal={activePlan.total_amount}
                  assignedTotal={assignedTotalNum}
                  paymentPeriod={paymentPeriod}
                  installmentCount={installmentCount}
                  onChangeRow={(index, patch) => {
                    setScheduleRows((prev) => {
                      const next = [...prev];
                      next[index] = { ...next[index], ...patch };
                      return next;
                    });
                  }}
                />
              )}
            </>
          ) : null}

          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={tryOpenConfirm}
              disabled={saving || loading || !activePlan || scheduleRows.length === 0}
            >
              Review &amp; assign
            </Button>
          </div>
        </div>
      </Modal>

      <PaymentPlanConfirmModal
        isOpen={confirmOpen}
        action={confirmOpen ? 'assign_student' : null}
        extraDetail={confirmMessage}
        loading={saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleAssign()}
      />

      <Modal
        isOpen={regenConfirmOpen}
        onClose={() => {
          setRegenConfirmOpen(false);
          setPendingStructural(null);
        }}
        title="Regenerate payment schedule?"
        size="sm"
        overlayClassName="!z-[60]"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Changing the assigned fee, payment period, first due date, or instalment count will
            regenerate the payment schedule and replace your manual schedule changes. Continue?
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRegenConfirmOpen(false);
                setPendingStructural(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pendingStructural) applyStructuralChange(pendingStructural);
                setRegenConfirmOpen(false);
                setPendingStructural(null);
              }}
            >
              Regenerate Schedule
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
