import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Wallet } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import {
  assignPaymentPlanToStudent,
  listPaymentPlanSummaries,
  listStudentPaymentPlansForStudent,
} from '../../services/paymentPlans';
import type { PaymentPlanSummary, StudentPaymentPlanSummary } from '../../types/paymentPlans';
import { formatCurrencyAud } from '../../lib/paymentPlanCalculations';
import { PaymentPlanEditorModal } from './PaymentPlanEditorModal';
import { StudentAssignmentInstallmentsModal } from './StudentAssignmentInstallmentsModal';

export interface StudentPaymentPlanContext {
  id: number;
  name: string;
  email: string;
}

interface StudentPaymentPlansSectionProps {
  student: StudentPaymentPlanContext;
  userId: number;
}

export const StudentPaymentPlansSection: React.FC<StudentPaymentPlansSectionProps> = ({
  student,
  userId,
}) => {
  const [loading, setLoading] = useState(true);
  const [assignments, setAssignments] = useState<StudentPaymentPlanSummary[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [planOptions, setPlanOptions] = useState<PaymentPlanSummary[]>([]);
  const [assignPlanId, setAssignPlanId] = useState('');
  const [editorPlan, setEditorPlan] = useState<PaymentPlanSummary | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewAssignment, setViewAssignment] = useState<StudentPaymentPlanSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listStudentPaymentPlansForStudent(student.id);
      setAssignments(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load payment plans');
    } finally {
      setLoading(false);
    }
  }, [student.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAssign = async () => {
    setAssignPlanId('');
    setAssignOpen(true);
    setAssignLoading(true);
    try {
      const plans = await listPaymentPlanSummaries();
      setPlanOptions(plans);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load plans');
      setPlanOptions([]);
    } finally {
      setAssignLoading(false);
    }
  };

  const handleAssign = async () => {
    const planId = Number(assignPlanId);
    if (!Number.isFinite(planId) || planId <= 0) {
      toast.error('Select a payment plan.');
      return;
    }
    setAssignLoading(true);
    try {
      await assignPaymentPlanToStudent(planId, student.id, userId);
      toast.success('Payment plan assigned');
      setAssignOpen(false);
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to assign plan');
    } finally {
      setAssignLoading(false);
    }
  };

  const openPlanEditor = async (assignment: StudentPaymentPlanSummary) => {
    const plans = await listPaymentPlanSummaries();
    const plan = plans.find((p) => p.id === assignment.payment_plan_id) ?? null;
    if (plan) {
      setEditorPlan(plan);
      setEditorOpen(true);
    }
  };

  return (
    <>
      <Card className="mt-4">
        <div className="flex items-center gap-2 text-[#ea580c] mb-2">
          <Wallet className="h-4 w-4" />
          <h3 className="font-bold text-[var(--text)] text-sm">Payment plans</h3>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Shared plan templates assigned to this student (same plan can apply to many students).
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          <Button variant="outline" size="sm" onClick={() => void openAssign()}>
            <Link2 className="h-3.5 w-3.5 mr-1 inline" />
            Assign plan
          </Button>
        </div>
        {loading ? (
          <Loader size="sm" message="Loading…" />
        ) : assignments.length === 0 ? (
          <p className="text-sm text-gray-500">No payment plans assigned yet.</p>
        ) : (
          <ul className="space-y-2">
            {assignments.map((a) => (
              <li key={a.assignment_id}>
                <button
                  type="button"
                  onClick={() => setViewAssignment(a)}
                  className="w-full rounded-lg border border-[var(--border)] px-3 py-2.5 text-left hover:bg-[#f97316]/5"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium text-sm">{a.plan_name}</span>
                    <span className="text-xs text-gray-500">{a.plan_status}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    {formatCurrencyAud(a.total_amount, a.currency)} ·{' '}
                    {formatCurrencyAud(a.total_paid, a.currency)} paid
                  </div>
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 text-xs"
                  onClick={() => void openPlanEditor(a)}
                >
                  Open plan template
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal isOpen={assignOpen} onClose={() => setAssignOpen(false)} title="Assign payment plan" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Assign a reusable payment plan template to <strong>{student.name}</strong>.
          </p>
          {assignLoading && planOptions.length === 0 ? (
            <Loader message="Loading plans…" />
          ) : (
            <Select
              label="Payment plan template"
              value={assignPlanId}
              onChange={setAssignPlanId}
              options={[
                { value: '', label: 'Select a plan…' },
                ...planOptions.map((p) => ({
                  value: String(p.id),
                  label: `${p.plan_name} — ${formatCurrencyAud(p.total_amount, p.currency)} (${p.assigned_student_count} students)`,
                })),
              ]}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleAssign()} disabled={assignLoading || !assignPlanId}>
              Assign
            </Button>
          </div>
        </div>
      </Modal>

      <PaymentPlanEditorModal
        isOpen={editorOpen}
        plan={editorPlan}
        userId={userId}
        onClose={() => {
          setEditorOpen(false);
          setEditorPlan(null);
        }}
        onSaved={() => void load()}
      />

      <StudentAssignmentInstallmentsModal
        isOpen={viewAssignment != null}
        assignment={viewAssignment}
        onClose={() => setViewAssignment(null)}
        onSaved={() => void load()}
      />
    </>
  );
};
