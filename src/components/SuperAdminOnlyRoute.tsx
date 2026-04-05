import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/** Form builder and other super-admin-only tools. */
export function SuperAdminOnlyRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const isTrainerOrOffice = user?.role === 'trainer' || user?.role === 'office';
  if (isTrainerOrOffice) return <Navigate to="/admin/dashboard" replace />;
  if (user?.role !== 'superadmin') return <Navigate to="/admin/forms" replace />;
  return <>{children}</>;
}
