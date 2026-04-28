import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AppUser } from '../lib/formEngine';
import {
  clearStaffImpersonationSession,
  consumeStaffImpersonationPendingIfEligible,
  getEffectiveStoredUser,
  getStoredUser,
  isStaffImpersonationActive,
  setStoredUser,
} from '../lib/formEngine';

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  login: (user: AppUser) => void;
  logout: () => void;
  /** Clear tab-only "open as user" preview and restore the logged-in account in this tab. */
  exitImpersonation: () => void;
  /** Superadmin previewing another staff member in this tab. */
  isImpersonating: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    consumeStaffImpersonationPendingIfEligible();
    setUser(getEffectiveStoredUser());
    setLoading(false);
  }, []);

  const login = (u: AppUser) => {
    clearStaffImpersonationSession();
    setUser(u);
    setStoredUser(u);
  };

  const exitImpersonation = () => {
    clearStaffImpersonationSession();
    setUser(getStoredUser());
  };

  const logout = () => {
    clearStaffImpersonationSession();
    setUser(null);
    setStoredUser(null);
  };

  const isImpersonating = isStaffImpersonationActive();

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, exitImpersonation, isImpersonating }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
