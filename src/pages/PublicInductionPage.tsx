import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Loader } from '../components/ui/Loader';
import { SlitDocumentHeader } from '../components/SlitDocumentHeader';
import { InductionDocumentPages } from '../components/induction/InductionDocumentPages';
import {
  getSkylineInductionByToken,
  getSkylineInductionSubmissionState,
  requestInductionOtp,
  submitSkylineInductionForm,
  unlockSkylineInductionSession,
  type SkylineInductionRow,
} from '../lib/formEngine';
import {
  emptyInductionFormPayload,
  parseInductionPayload,
  synchronizeInductionDerivedFields,
  validateInductionFormPayload,
  type InductionFormPayload,
} from '../lib/inductionForm';
import { isValidInstitutionalEmail } from '../lib/emailUtils';
import { toast } from '../utils/toast';
import { formatMelbourneDateTime, inductionWindowStatus } from '../utils/melbourneTime';
import { requestNotificationPreference } from '../services/pushNotificationService';

function inductionSessionStorageKey(accessToken: string): string {
  return `signflow.induction.session.${accessToken}`;
}

/** Dev/staging only: set `VITE_INDUCTION_OTP_BYPASS=true` for non-DEV builds. */
const INDUCTION_OTP_BYPASS_EMAIL = 'gourav.gupta@siyanainfo.com';
const INDUCTION_OTP_BYPASS_CODE = '1111';

function inductionOtpBypassEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_INDUCTION_OTP_BYPASS === 'true';
}

function isInductionOtpBypassEmail(emailValue: string): boolean {
  return emailValue.trim().toLowerCase() === INDUCTION_OTP_BYPASS_EMAIL;
}

interface ClientInductionSession {
  sessionToken: string;
  email: string;
}

/** Public induction: valid link + OTP (student or staff on file) to view and submit the pack. */
export const PublicInductionPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [row, setRow] = useState<SkylineInductionRow | null | undefined>(undefined);
  const [session, setSession] = useState<ClientInductionSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<InductionFormPayload>(() => emptyInductionFormPayload());
  const [submitted, setSubmitted] = useState(false);
  /** Server says session is valid but DB `now()` is outside start_at/end_at (keeps session on refresh). */
  const [outsideWindowServer, setOutsideWindowServer] = useState(false);
  const [windowTick, setWindowTick] = useState(0);

  const mergeInductionForm = useCallback((next: InductionFormPayload) => {
    setForm(synchronizeInductionDerivedFields(next));
  }, []);

  useEffect(() => {
    if (!token) {
      setRow(null);
      return;
    }
    setEmail('');
    setOtp('');
    setOtpSent(false);
    setSession(null);
    setSessionReady(false);
    setSubmitted(false);
    setOutsideWindowServer(false);
    setForm(emptyInductionFormPayload());
    let cancelled = false;
    (async () => {
      const r = await getSkylineInductionByToken(token);
      if (!cancelled) setRow(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || row === undefined || row === null) return;
    let cancelled = false;
    (async () => {
      setSessionReady(false);
      try {
        const raw = sessionStorage.getItem(inductionSessionStorageKey(token));
        if (!raw) {
          if (!cancelled) {
            setSession(null);
            setSessionReady(true);
          }
          return;
        }
        const parsed = JSON.parse(raw) as { sessionToken?: string; email?: string };
        if (!parsed.sessionToken) {
          sessionStorage.removeItem(inductionSessionStorageKey(token));
          if (!cancelled) {
            setSession(null);
            setSessionReady(true);
          }
          return;
        }
        const st = await getSkylineInductionSubmissionState({
          accessToken: token,
          sessionToken: parsed.sessionToken,
        });
        if (cancelled) return;
        if (!st.ok) {
          sessionStorage.removeItem(inductionSessionStorageKey(token));
          setSession(null);
          setSessionReady(true);
          return;
        }
        setSession({ sessionToken: parsed.sessionToken, email: parsed.email || '' });
        if (st.submitted) {
          setSubmitted(true);
          setOutsideWindowServer(false);
          const p = parseInductionPayload(st.payload);
          if (p) setForm(synchronizeInductionDerivedFields(p));
        } else {
          setSubmitted(false);
          setOutsideWindowServer(st.outsideWindow ?? false);
        }
      } catch {
        try {
          sessionStorage.removeItem(inductionSessionStorageKey(token));
        } catch {
          /* ignore */
        }
        setSession(null);
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, row?.id]);

  useEffect(() => {
    const id = window.setInterval(() => setWindowTick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  const emailValid = isValidInstitutionalEmail(email);
  const emailOkForInduction =
    emailValid || (inductionOtpBypassEnabled() && isInductionOtpBypassEmail(email));
  const canSendOtp = !!email.trim() && emailOkForInduction && !otpSent;
  const bypassOtpReady =
    inductionOtpBypassEnabled() &&
    isInductionOtpBypassEmail(email) &&
    otp.trim() === INDUCTION_OTP_BYPASS_CODE;
  const canVerifyOtp = !!email.trim() && emailOkForInduction && (otp.trim().length >= 6 || bypassOtpReady);

  const windowStatus = useMemo(
    () => (row ? inductionWindowStatus(row.start_at, row.end_at) : 'ended'),
    [row, row?.start_at, row?.end_at, windowTick],
  );
  /** Only client window + already submitted disable the button — not `outsideWindowServer` (server can disagree with browser time; submit still validates server-side). */
  const submitBlocked = windowStatus !== 'open';

  const handleSendOtp = async () => {
    if (!email.trim() || !emailOkForInduction) return;
    if (windowStatus !== 'open') {
      toast.error('This induction is not open yet or has already closed.');
      return;
    }
    if (inductionOtpBypassEnabled() && isInductionOtpBypassEmail(email.trim())) {
      setOtpSent(true);
      toast.success(`Enter code ${INDUCTION_OTP_BYPASS_CODE} to continue (OTP bypass).`);
      return;
    }
    setSubmitting(true);
    const res = await requestInductionOtp(email.trim());
    setSubmitting(false);
    if (res.success) {
      setOtpSent(true);
      toast.success('OTP sent! Check your email. Valid for 10 minutes.');
    } else {
      toast.error(res.message || 'Failed to send OTP');
    }
  };

  const persistSession = (s: ClientInductionSession) => {
    try {
      sessionStorage.setItem(inductionSessionStorageKey(token!), JSON.stringify(s));
    } catch {
      /* ignore */
    }
    setSession(s);
  };

  const runUnlock = async (otpValue: string) => {
    if (!token || !email.trim() || !otpValue.trim()) return;
    if (windowStatus !== 'open') {
      toast.error('This induction is not open yet or has already closed.');
      return;
    }
    if (!emailOkForInduction) {
      toast.error('Only @student.slit.edu.au or @slit.edu.au emails can access induction.');
      return;
    }
    setSubmitting(true);
    const result = await unlockSkylineInductionSession({
      accessToken: token,
      email: email.trim(),
      otp: otpValue.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error || 'Could not verify. Try again.');
      return;
    }
    persistSession({ sessionToken: result.sessionToken, email: email.trim() });
    // Ask for notification preference at authentication time (best-effort; does not affect induction flow).
    try {
      const key = 'signflow.notifications.induction_prompted_v1';
      const already = sessionStorage.getItem(key);
      if (!already && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
        sessionStorage.setItem(key, '1');
        void requestNotificationPreference();
      }
    } catch {
      void requestNotificationPreference();
    }
    toast.success('Welcome — complete all sections below, then submit.');
  };

  const handleSubmitForm = async () => {
    if (!token || !session || submitBlocked) return;
    const err = validateInductionFormPayload(form);
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    const res = await submitSkylineInductionForm({
      accessToken: token,
      sessionToken: session.sessionToken,
      payload: form as unknown as Record<string, unknown>,
    });
    setSubmitting(false);
    if (!res.ok) {
      toast.error(res.error || 'Submit failed.');
      return;
    }
    setSubmitted(true);
    toast.success(submitted ? 'Induction updated. Thank you.' : 'Induction submitted. Thank you.');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runUnlock(otp);
  };

  if (row === undefined || !sessionReady) {
    return <Loader fullPage variant="dots" size="lg" message="Loading…" />;
  }

  if (!row) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
        <Card className="max-w-lg w-full p-8 text-center">
          <p className="text-[var(--text)] font-medium">This induction link is not valid or has been removed.</p>
          <p className="text-sm text-gray-600 mt-2">Contact the office if you need a new link.</p>
        </Card>
      </div>
    );
  }

  if (!session && windowStatus !== 'open') {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-gray-200 bg-white px-4 pt-3 pb-2 shadow-sm mb-6">
            <SlitDocumentHeader />
          </div>
          <Card className="w-full p-6 md:p-8 text-center">
            <h1 className="text-lg font-bold text-[var(--text)] mb-2">Induction not available</h1>
            <p className="text-sm text-gray-600 mb-1">{row.title}</p>
            {windowStatus === 'upcoming' ? (
              <p className="text-sm text-gray-700 mt-4">
                This induction opens at{' '}
                <span className="font-medium">{formatMelbourneDateTime(row.start_at)}</span> (Melbourne time).
              </p>
            ) : (
              <p className="text-sm text-gray-700 mt-4">
                This induction period ended at{' '}
                <span className="font-medium">{formatMelbourneDateTime(row.end_at)}</span> (Melbourne time).
              </p>
            )}
            <p className="text-xs text-gray-500 mt-4">Contact the office if you need help.</p>
          </Card>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="rounded-lg border border-gray-200 bg-white px-4 pt-3 pb-2 shadow-sm mb-6">
            <SlitDocumentHeader />
          </div>
          <Card className="w-full p-6 md:p-8">
            <h1 className="text-xl font-bold text-[var(--text)] mb-2">Verify to view induction</h1>
            <p className="text-sm text-gray-600 mb-1">{row.title}</p>
            <p className="text-xs text-gray-500 mb-6">
              Enter your institutional email (@student.slit.edu.au or @slit.edu.au) and use the one-time code we send you.
              You must be on file as an enrolled student or staff user. You can submit once; complete all fields before
              submit.
            </p>
            <div>
              <Input
                type="email"
                label="Email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (otpSent) setOtpSent(false);
                }}
                placeholder="firstname.lastname@student.slit.edu.au"
                autoComplete="email"
                required
                className={email.trim() && !emailOkForInduction ? 'border-amber-500' : ''}
              />
              {email.trim() && !emailOkForInduction && (
                <p className="mt-1.5 text-sm text-amber-600">Only @student.slit.edu.au or @slit.edu.au emails are accepted.</p>
              )}
            </div>
            {!otpSent ? (
              <div className="mt-6">
                <p className="text-sm text-gray-600 mb-3">Request a code valid for 10 minutes.</p>
                <Button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={submitting || !canSendOtp || windowStatus !== 'open'}
                  className="w-full"
                >
                  {submitting ? 'Sending…' : 'Send OTP'}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <Input
                  type="text"
                  inputMode="numeric"
                  maxLength={
                    inductionOtpBypassEnabled() && isInductionOtpBypassEmail(email) ? 4 : 6
                  }
                  label={
                    inductionOtpBypassEnabled() && isInductionOtpBypassEmail(email)
                      ? 'OTP'
                      : '6-digit OTP'
                  }
                  value={otp}
                  onChange={(e) => {
                    const maxLen =
                      inductionOtpBypassEnabled() && isInductionOtpBypassEmail(email) ? 4 : 6;
                    const next = e.target.value.replace(/\D/g, '').slice(0, maxLen);
                    setOtp(next);
                    const autoVerify =
                      !submitting &&
                      email.trim() &&
                      emailOkForInduction &&
                      (next.length === 6 ||
                        (inductionOtpBypassEnabled() &&
                          isInductionOtpBypassEmail(email) &&
                          next === INDUCTION_OTP_BYPASS_CODE));
                    if (autoVerify) void runUnlock(next);
                  }}
                  placeholder={
                    inductionOtpBypassEnabled() && isInductionOtpBypassEmail(email) ? '1111' : '000000'
                  }
                  autoComplete="one-time-code"
                  className="text-center text-lg tracking-widest"
                />
                <Button
                  type="submit"
                  disabled={submitting || !canVerifyOtp || windowStatus !== 'open'}
                  className="w-full"
                >
                  {submitting ? 'Verifying…' : 'Unlock induction'}
                </Button>
                <button
                  type="button"
                  onClick={() => {
                    setOtpSent(false);
                    setOtp('');
                  }}
                  className="w-full text-sm text-gray-500 hover:text-gray-700"
                >
                  Use a different email or resend OTP
                </button>
              </form>
            )}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] pb-28">
      <div className="mx-auto w-full max-w-full px-3 py-6 sm:max-w-[220mm] sm:px-4 sm:py-8">
        {!submitted && submitBlocked ? (
          <Card className="mb-4 border-red-200 bg-red-50/90 p-4 text-sm text-gray-800">
            <p className="font-semibold text-red-900">Submission closed</p>
            <p className="mt-1">
              {windowStatus === 'upcoming'
                ? `This induction opens at ${formatMelbourneDateTime(row.start_at)} (Melbourne time). You cannot submit until then.`
                : `This induction period ended at ${formatMelbourneDateTime(row.end_at)} (Melbourne time). Submissions are no longer accepted.`}
            </p>
          </Card>
        ) : null}
        {!submitted && !submitBlocked && outsideWindowServer ? (
          <Card className="mb-4 border-sky-200 bg-sky-50/90 p-4 text-sm text-gray-800">
            <p className="font-semibold text-sky-900">Server time check</p>
            <p className="mt-1">
              The server reported a possible mismatch with the induction window. You can still try <strong>Submit induction</strong>
              — if it fails, refresh the page or contact the office.
            </p>
          </Card>
        ) : null}
        {submitted ? (
          <Card className="mb-4 border-green-200 bg-green-50/90 p-4 text-sm text-gray-800">
            <p className="font-semibold text-green-900">Induction submitted</p>
            <p className="mt-1">Your responses are on file. You can update and submit again to replace your previous submission.</p>
          </Card>
        ) : !submitBlocked ? (
          <Card className="mb-4 border-amber-100 bg-amber-50/80 p-4 text-sm text-gray-800">
            <p className="font-semibold text-amber-950">Before you submit</p>
            <p className="mt-1">
              Complete all required student fields: Step 1 login (Yes/No for Outlook and Teams), Step 4 documents (Yes/No for
              each line; file attach is optional), checklist (Yes + initials on every topic), full enrolment details, and the
              CCTV acknowledgement on the last page. Visa number and expiry are optional; the promotional consent block at
              the bottom of the last page is optional. You only get one submission per induction link.
            </p>
          </Card>
        ) : null}
        <InductionDocumentPages
          title={row.title}
          startAt={row.start_at}
          endAt={row.end_at}
          interactive={{
            value: form,
            onChange: mergeInductionForm,
            readOnly: false,
            inductionSubmissionFolder: session?.email?.trim().toLowerCase() || undefined,
          }}
        />
      </div>

      {!submitted ? (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm">
          <div className="mx-auto flex max-w-[220mm] flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            {submitBlocked ? (
              <p className="text-xs text-gray-600 sm:max-w-[min(100%,28rem)]">
                {windowStatus === 'upcoming'
                  ? 'Submit unlocks when this induction window opens (see dates at the top).'
                  : 'Submit is not available — this induction window has ended.'}
              </p>
            ) : (
              <span className="hidden sm:block" aria-hidden />
            )}
            <div className="flex flex-col items-stretch gap-1 sm:items-end">
              <Button
                type="button"
                onClick={handleSubmitForm}
                disabled={submitting || submitBlocked}
                className="w-full sm:w-auto sm:min-w-[200px]"
              >
                {submitting ? 'Submitting…' : 'Submit induction'}
              </Button>
              {!submitBlocked ? (
                <p className="text-center text-[11px] text-gray-500 sm:text-right">
                  Missing fields? You&apos;ll see an error after you tap submit.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
