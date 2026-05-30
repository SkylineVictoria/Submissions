import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canViewFinanceReports } from '../lib/formEngine';

/** Finance Reports: superadmin always; admins when granted by superadmin. */
export function FinanceReportsRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === 'trainer') return <Navigate to="/admin/dashboard" replace />;
  if (!canViewFinanceReports(user)) {
    return <Navigate to="/admin/overview" replace />;
  }
  return <>{children}</>;
}
