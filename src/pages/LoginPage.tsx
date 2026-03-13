import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { loginWithEmailPassword } from '../lib/formEngine';
import { useAuth } from '../contexts/AuthContext';
import { isValidInstitutionalEmail } from '../lib/emailUtils';
import { Navigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const defaultFrom = '/admin';
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? defaultFrom;

  if (user) {
    return <Navigate to={from} replace />;
  }

  const emailValid = isValidInstitutionalEmail(email);
  const canSubmit = email.trim() && password && emailValid;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error('Email and password are required');
      return;
    }
    if (!emailValid) {
      toast.error('Only @slit.edu.au emails are allowed');
      return;
    }
    setLoading(true);
    const user = await loginWithEmailPassword(email.trim(), password);
    setLoading(false);
    if (user) {
      login(user);
      toast.success(`Welcome, ${user.full_name}`);
      navigate(from, { replace: true });
    } else {
      toast.error('Invalid email or password');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left: Branded panel with crest */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#F47A1F] via-[#ea580c] to-[#c2410c] flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-64 h-64 rounded-full bg-white" />
          <div className="absolute bottom-32 right-20 w-48 h-48 rounded-full bg-white" />
        </div>
        {!logoError ? (
          <img
            src="/logo-crest.png"
            alt="Skyline"
            className="relative z-10 h-32 w-auto object-contain drop-shadow-lg"
            onError={() => setLogoError(true)}
          />
        ) : (
          <div className="relative z-10 flex items-center justify-center h-32 w-32 rounded-full bg-white/20">
            <span className="text-2xl font-bold text-white">SKYLINE</span>
          </div>
        )}
        <h2 className="relative z-10 mt-6 text-2xl font-bold text-white tracking-tight">
          SignFlow
        </h2>
        <p className="relative z-10 mt-2 text-white/90 text-center max-w-xs">
          Assessment management for trainers and assessors
        </p>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-[var(--bg)]">
        <div className="w-full max-w-md">
          {/* Crest on mobile */}
          <div className="lg:hidden flex justify-center mb-8">
            {!logoError ? (
              <img
                src="/logo-crest.png"
                alt="Skyline"
                className="h-20 w-auto object-contain"
                onError={() => setLogoError(true)}
              />
            ) : (
              <div className="h-20 flex items-center justify-center px-6 rounded-lg bg-[#F47A1F]/10">
                <span className="text-xl font-bold text-[#F47A1F]">SKYLINE</span>
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-xl border border-[var(--border)] p-8 sm:p-10">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-[var(--text)]">Welcome back</h1>
              <p className="text-gray-600 mt-2">Sign in with your Skyline email to access the app</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email
                </label>
                <Input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@slit.edu.au or name@student.slit.edu.au"
                  required
                  autoComplete="email"
                  className={`h-12 ${email.trim() && !emailValid ? 'border-amber-500 focus:ring-amber-500' : ''}`}
                />
                {email.trim() && !emailValid && (
                  <p className="mt-1.5 text-sm text-amber-600">Only @slit.edu.au or @student.slit.edu.au emails can sign in.</p>
                )}
              </div>
              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1.5">
                  Password
                </label>
                <Input
                  id="login-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="h-12"
                />
              </div>
              <Button
                type="submit"
                disabled={loading || !canSubmit}
                className="w-full h-12 text-base font-semibold"
              >
                {loading ? (
                  <>
                    <Loader variant="dots" size="sm" inline className="mr-2" />
                    Signing in...
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
            <p className="mt-6 text-center text-xs text-gray-500">
              Secure access for authorised users only
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
