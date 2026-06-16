import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Wallet } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { toast } from '../../utils/toast';
import {
  listPaymentPlanSummaries,
  listStudentPaymentPlansForStudent,
} from '../../services/paymentPlans';
import type { PaymentPlanSummary, StudentPaymentPlanContext, StudentPaymentPlanSummary } from '../../types/paymentPlans';
import { formatCurrencyAud } from '../../lib/paymentPlanCalculations';
import { PaymentPlanEditorModal } from './PaymentPlanEditorModal';
import { StudentAssignmentInstallmentsModal } from './StudentAssignmentInstallmentsModal';

import { AssignPaymentPlanModal } from './AssignPaymentPlanModal';

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

  const openAssign = () => setAssignOpen(true);

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
          <Button variant="outline" size="sm" onClick={openAssign}>
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

      <AssignPaymentPlanModal
        isOpen={assignOpen}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => void load()}
        userId={userId}
        student={student}
      />

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
