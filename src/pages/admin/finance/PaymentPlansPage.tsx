import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Wallet } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';
import { Card } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Loader } from '../../../components/ui/Loader';
import { toast } from '../../../utils/toast';
import { listPaymentPlanSummaries } from '../../../services/paymentPlans';
import type { PaymentPlanSummary } from '../../../types/paymentPlans';
import { formatCurrencyAud } from '../../../lib/paymentPlanCalculations';
import { PaymentPlanEditorModal } from '../../../components/paymentPlans/PaymentPlanEditorModal';

function statusBadge(status: PaymentPlanSummary['status']) {
  if (status === 'confirmed') {
    return (
      <span className="inline-flex rounded-full border border-green-200 bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-800">
        Confirmed
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">
      Draft
    </span>
  );
}

export const PaymentPlansPage: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<PaymentPlanSummary[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlanSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listPaymentPlanSummaries();
      setPlans(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load payment plans');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 py-6 md:px-6 lg:px-8 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#ea580c]">
              <Wallet className="h-7 w-7" />
              <h1 className="text-2xl font-bold text-[var(--text)]">Payment Plans</h1>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Reusable plan templates — assign the same plan to many students (not tied to courses).
            </p>
          </div>
          <Button
            variant="primary"
            onClick={() => {
              setSelectedPlan(null);
              setEditorOpen(true);
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create payment plan
            </span>
          </Button>
        </div>

        <Card className="overflow-hidden">
          {loading ? (
            <div className="p-8">
              <Loader message="Loading payment plans…" />
            </div>
          ) : plans.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-600">
              No payment plan templates yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-gray-50/80 text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Plan</th>
                    <th className="px-4 py-3 font-semibold">Students</th>
                    <th className="px-4 py-3 font-semibold">Total</th>
                    <th className="px-4 py-3 font-semibold">Installments</th>
                    <th className="px-4 py-3 font-semibold">Collected</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Start</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr
                      key={plan.id}
                      className="border-b border-gray-100 hover:bg-[#f97316]/5 cursor-pointer"
                      onClick={() => {
                        setSelectedPlan(plan);
                        setEditorOpen(true);
                      }}
                    >
                      <td className="px-4 py-3 font-medium text-[var(--text)]">{plan.plan_name}</td>
                      <td className="px-4 py-3 text-gray-700">{plan.assigned_student_count}</td>
                      <td className="px-4 py-3 text-gray-800">
                        {formatCurrencyAud(plan.total_amount, plan.currency)}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {plan.paid_count}/{plan.installment_count} paid (all students)
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatCurrencyAud(plan.total_paid, plan.currency)}
                      </td>
                      <td className="px-4 py-3">{statusBadge(plan.status)}</td>
                      <td className="px-4 py-3 text-gray-700">{plan.start_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <PaymentPlanEditorModal
        isOpen={editorOpen}
        plan={selectedPlan}
        userId={user.id}
        onClose={() => {
          setEditorOpen(false);
          setSelectedPlan(null);
        }}
        onSaved={() => void load()}
      />
    </div>
  );
};
