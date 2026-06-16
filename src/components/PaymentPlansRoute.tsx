import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canManagePaymentPlans } from '../lib/formEngine';

/** Payment Plans: admin and superadmin only. */
export function PaymentPlansRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === 'trainer') return <Navigate to="/admin/dashboard" replace />;
  if (!canManagePaymentPlans(user)) {
    return <Navigate to="/admin/overview" replace />;
  }
  return <>{children}</>;
}
