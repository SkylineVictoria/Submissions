import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { SelectAsync } from '../ui/SelectAsync';
import { Loader } from '../ui/Loader';
import { DatePicker } from '../ui/DatePicker';
import { toast } from '../../utils/toast';
import {
  assignPaymentPlanWithInstallments,
  fetchTemplateInstallments,
  listPaymentPlanSummaries,
} from '../../services/paymentPlans';
import type { AssignInstallmentDraft, PaymentPlanSummary, StudentPaymentPlanContext } from '../../types/paymentPlans';
import {
  assignDraftToInput,
  buildAssignmentScheduleFromPlan,
  formatCurrencyAud,
  isoToPickerDate,
  isoToday,
  previewToAssignDraft,
  validateAssignInstallmentDrafts,
} from '../../lib/paymentPlanCalculations';
import { PaymentPlanAssignmentSchedule } from './PaymentPlanAssignmentSchedule';
import { supabase } from '../../lib/supabase';

interface AssignPaymentPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAssigned: () => void;
  userId: number;
  /** Student details page — pick a plan template. */
  student?: StudentPaymentPlanContext;
  /** Plan editor — plan is fixed; pick a student. */
  fixedPlan?: PaymentPlanSummary | null;
}

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

  const activePlan = fixedPlan ?? selectedPlan;
  const initRef = useRef(false);

  const loadSchedule = useCallback(async (plan: PaymentPlanSummary, assignmentStart: string) => {
    setLoading(true);
    try {
      const templates = await fetchTemplateInstallments(plan.id);
      const preview = buildAssignmentScheduleFromPlan(
        {
          total_amount: plan.total_amount,
          installment_count: plan.installment_count,
          start_date: plan.start_date,
          calculation_mode: plan.calculation_mode,
          regular_monthly_amount: plan.regular_monthly_amount,
        },
        assignmentStart,
        templates.map((t) => ({
          installment_number: t.installment_number,
          due_date: t.due_date,
          amount: t.amount,
        }))
      );
      setScheduleRows(
        preview.map((row, index) => previewToAssignDraft(row, index === 0))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load schedule');
      setScheduleRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      initRef.current = false;
      return;
    }
    if (initRef.current) return;
    initRef.current = true;

    setStartDate(isoToPickerDate(isoToday()));
    setScheduleRows([]);
    setAssignStudentId('');
    setAssignStudentLabel('');

    if (fixedPlan) {
      setSelectedPlan(fixedPlan);
      setSelectedPlanId(String(fixedPlan.id));
      void loadSchedule(fixedPlan, isoToPickerDate(isoToday()));
      return;
    }

    setSelectedPlanId('');
    setSelectedPlan(null);
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
    if (plan) void loadSchedule(plan, startDate);
  }, [isOpen, fixedPlan, selectedPlanId, planOptions, loadSchedule]);

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    if (activePlan) void loadSchedule(activePlan, value);
  };

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

  const handleAssign = async () => {
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

    const validationError = validateAssignInstallmentDrafts(scheduleRows);
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
        scheduleRows.map(assignDraftToInput)
      );
      toast.success('Payment plan assigned');
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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          {student ? (
            <>
              Assign a reusable payment plan template to <strong>{student.name}</strong>. Review the
              schedule, record the first payment if received, and adjust dates or waivers as needed.
            </>
          ) : (
            <>
              Choose a student and customize their installment schedule before assigning them to this
              plan template.
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Assignment start date
                </label>
                <DatePicker value={startDate} onChange={handleStartDateChange} />
              </div>
              <div className="text-sm text-gray-600 flex items-end pb-1">
                {activePlan.installment_count} installments ·{' '}
                {formatCurrencyAud(activePlan.total_amount, activePlan.currency)}
              </div>
            </div>

            {loading ? (
              <Loader message="Loading payment schedule…" />
            ) : (
              <PaymentPlanAssignmentSchedule
                rows={scheduleRows}
                currency={activePlan.currency}
                planTotal={activePlan.total_amount}
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
            onClick={() => void handleAssign()}
            disabled={saving || loading || !activePlan || scheduleRows.length === 0}
          >
            Assign
          </Button>
        </div>
      </div>
    </Modal>
  );
};
