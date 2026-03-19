import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { loginWithOtp, requestOtp } from '../lib/formEngine';
import { useAuth } from '../contexts/AuthContext';
import { isValidInstitutionalEmail } from '../lib/emailUtils';
import { Navigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Loader } from '../components/ui/Loader';
import { toast } from '../utils/toast';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
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
  const canSendOtp = email.trim() && emailValid && !otpSent;
  const canVerifyOtp = email.trim() && otp.trim().length >= 6;

  const handleSendOtp = async () => {
    if (!email.trim() || !emailValid) return;
    setLoading(true);
    const res = await requestOtp(email.trim());
    setLoading(false);
    if (res.success) {
      setOtpSent(true);
      toast.success('OTP sent! Check your email. Valid for 10 minutes.');
    } else {
      toast.error(res.message || 'Failed to send OTP');
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !otp.trim()) return;
    setLoading(true);
    const u = await loginWithOtp(email.trim(), otp.trim());
    setLoading(false);
    if (u) {
      login(u);
      toast.success(`Welcome, ${u.full_name}`);
      navigate(from, { replace: true });
    } else {
      toast.error('Invalid or expired OTP');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left: Branded panel with crest in circle */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#F47A1F] via-[#ea580c] to-[#c2410c] items-start justify-center pt-16 p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute bottom-32 right-20 w-48 h-48 rounded-full bg-white" />
        </div>
        <div className="relative z-10 flex flex-row items-center gap-8">
          {/* Logo inside top-left circle */}
          <div className="shrink-0 w-64 h-64 rounded-full bg-white/20 flex items-center justify-center p-6 drop-shadow-lg">
            {!logoError ? (
              <img
                src="/logo-crest.png"
                alt="Skyline"
                className="w-full h-full object-contain"
                onError={() => setLogoError(true)}
              />
            ) : (
              <span className="text-2xl font-bold text-white">SKYLINE</span>
            )}
          </div>
          {/* Text beside the circle */}
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold text-white tracking-tight">
              Skyline Submissions
            </h2>
            <p className="text-white/90 max-w-xs">
              Manage Assessments Smartly
            </p>
          </div>
        </div>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-[var(--bg)]">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-8">
            {!logoError ? (
              <img
                src="/logo-crest.png"
                alt="Skyline"
                className="h-20 w-auto object-contain"
                onError={() => setLogoError(true)}
              />
            ) : (
              <div className="h-20 flex justify-center items-center px-6 rounded-lg bg-[#F47A1F]/10">
                <span className="text-xl font-bold text-[#F47A1F]">SKYLINE</span>
              </div>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-xl border border-[var(--border)] p-8 sm:p-10">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-[var(--text)]">Welcome back</h1>
              <p className="text-gray-600 mt-2">Sign in with your Skyline email to access the app</p>
            </div>

            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email
              </label>
              <Input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (otpSent) setOtpSent(false);
                }}
                placeholder="name@slit.edu.au or name@student.slit.edu.au"
                required
                autoComplete="email"
                className={`h-12 ${email.trim() && !emailValid ? 'border-amber-500 focus:ring-amber-500' : ''}`}
              />
              {email.trim() && !emailValid && (
                <p className="mt-1.5 text-sm text-amber-600">Only @slit.edu.au or @student.slit.edu.au emails can sign in.</p>
              )}
            </div>

            <div className="space-y-5 mt-5">
                {!otpSent ? (
                  <>
                    <p className="text-sm text-gray-600">
                      Request a one-time code sent to your email. Valid for 10 minutes.
                    </p>
                    <Button
                      type="button"
                      onClick={handleSendOtp}
                      disabled={loading || !canSendOtp}
                      className="w-full h-12 text-base font-semibold"
                    >
                      {loading ? (
                        <>
                          <Loader variant="dots" size="sm" inline className="mr-2" />
                          Sending...
                        </>
                      ) : (
                        'Send OTP'
                      )}
                    </Button>
                  </>
                ) : (
                  <form onSubmit={handleOtpSubmit} className="space-y-5">
                    <div>
                      <label htmlFor="login-otp" className="block text-sm font-medium text-gray-700 mb-1.5">
                        Enter 6-digit OTP
                      </label>
                      <Input
                        id="login-otp"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={otp}
                        onChange={(e) => {
                          const next = e.target.value.replace(/\D/g, '');
                          setOtp(next);
                          if (next.length === 6 && !loading && email.trim()) {
                            // Auto-submit when 6 digits are entered
                            void (async () => {
                              setLoading(true);
                              const u = await loginWithOtp(email.trim(), next);
                              setLoading(false);
                              if (u) {
                                login(u);
                                toast.success(`Welcome, ${u.full_name}`);
                                navigate(from, { replace: true });
                              } else {
                                toast.error('Invalid or expired OTP');
                              }
                            })();
                          }
                        }}
                        placeholder="000000"
                        autoComplete="one-time-code"
                        className="h-12 text-center text-lg tracking-widest"
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={loading || !canVerifyOtp}
                      className="w-full h-12 text-base font-semibold"
                    >
                      {loading ? (
                        <>
                          <Loader variant="dots" size="sm" inline className="mr-2" />
                          Verifying...
                        </>
                      ) : (
                        'Verify & Sign in'
                      )}
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setOtpSent(false); setOtp(''); }}
                      className="w-full text-sm text-gray-500 hover:text-gray-700"
                    >
                      Use a different email or resend OTP
                    </button>
                  </form>
                )}
              </div>

            <p className="mt-6 text-center text-xs text-gray-500">
              Secure access for authorised users only
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
