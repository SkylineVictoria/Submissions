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
  saveSkylineInductionDraft,
  submitSkylineInductionForm,
  unlockSkylineInductionSession,
  type SkylineInductionRow,
} from '../lib/formEngine';
import {
  emptyInductionFormPayload,
  parseInductionPayload,
  synchronizeInductionDerivedFields,
  type InductionFormSyncOptions,
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

function inductionDraftStorageKey(accessToken: string, email: string): string {
  return `signflow.induction.draft.v1.${accessToken}.${email.trim().toLowerCase()}`;
}

interface InductionDraftEnvelope {
  savedAt: number;
  payload: InductionFormPayload;
}

function readInductionDraftEnvelope(accessToken: string, email: string): InductionDraftEnvelope | null {
  try {
    const raw = localStorage.getItem(inductionDraftStorageKey(accessToken, email));
    if (!raw) return null;
    const o = JSON.parse(raw) as { savedAt?: unknown; payload?: unknown };
    const savedAt = typeof o.savedAt === 'number' ? o.savedAt : 0;
    const p = parseInductionPayload(o.payload);
    if (!p) return null;
    return { savedAt, payload: p };
  } catch {
    return null;
  }
}

function writeInductionDraft(accessToken: string, email: string, payload: InductionFormPayload): number {
  const savedAt = Date.now();
  const envelope: InductionDraftEnvelope = { savedAt, payload };
  localStorage.setItem(inductionDraftStorageKey(accessToken, email), JSON.stringify(envelope));
  return savedAt;
}

function clearInductionDraft(accessToken: string, email: string): void {
  try {
    localStorage.removeItem(inductionDraftStorageKey(accessToken, email));
  } catch {
    /* ignore */
  }
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
  /** Last successful local draft save (this browser); shown next to Save draft. */
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  /** Server says session is valid but DB `now()` is outside start_at/end_at (keeps session on refresh). */
  const [outsideWindowServer, setOutsideWindowServer] = useState(false);
  const [windowTick, setWindowTick] = useState(0);

  const mergeInductionForm = useCallback(
    (next: InductionFormPayload | ((prev: InductionFormPayload) => InductionFormPayload), sync?: InductionFormSyncOptions) => {
      setForm((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        return synchronizeInductionDerivedFields(resolved, sync);
      });
    },
    []
  );

  /** Restore submitted pack or server/local draft after OTP or session refresh. */
  const hydrateFormAfterAuth = useCallback(
    async (sess: ClientInductionSession, options?: { toastOnDraft?: boolean }): Promise<boolean> => {
      if (!token) return false;
      const st = await getSkylineInductionSubmissionState({
        accessToken: token,
        sessionToken: sess.sessionToken,
      });
      if (!st.ok) return false;

      if (st.submitted) {
        setSubmitted(true);
        setOutsideWindowServer(false);
        setDraftSavedAt(null);
        clearInductionDraft(token, sess.email);
        const p = parseInductionPayload(st.payload);
        if (p) setForm(synchronizeInductionDerivedFields(p));
        return false;
      }

      setSubmitted(false);
      setOutsideWindowServer(st.outsideWindow ?? false);

      let restored = false;
      let savedAtMs: number | null = null;
      let restoredPayload: InductionFormPayload | null = null;

      if (st.draftPayload) {
        restoredPayload = parseInductionPayload(st.draftPayload);
        if (restoredPayload) {
          setForm(synchronizeInductionDerivedFields(restoredPayload));
          restored = true;
          if (st.draftSavedAt) {
            const t = Date.parse(st.draftSavedAt);
            if (!Number.isNaN(t)) savedAtMs = t;
          }
        }
      }

      if (!restored) {
        const local = readInductionDraftEnvelope(token, sess.email);
        if (local) {
          restoredPayload = local.payload;
          setForm(synchronizeInductionDerivedFields(local.payload));
          restored = true;
          savedAtMs = local.savedAt > 0 ? local.savedAt : null;
        }
      }

      if (restoredPayload) {
        try {
          writeInductionDraft(token, sess.email, restoredPayload);
        } catch {
          /* local cache best-effort */
        }
      }

      setDraftSavedAt(savedAtMs);

      if (restored && options?.toastOnDraft) {
        toast.success('Your saved draft has been restored. You can continue where you left off.');
      }
      return restored;
    },
    [token]
  );

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
    setDraftSavedAt(null);
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
        const sess: ClientInductionSession = {
          sessionToken: parsed.sessionToken,
          email: (parsed.email || '').trim(),
        };
        setSession(sess);
        await hydrateFormAfterAuth(sess);
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
  }, [token, row?.id, hydrateFormAfterAuth]);

  useEffect(() => {
    const id = window.setInterval(() => setWindowTick((n) => n + 1), 30000);
    return () => window.clearInterval(id);
  }, []);

  /** Persist draft locally (fast) and on server (resume on any device after OTP). */
  useEffect(() => {
    if (!token || !session || submitted) return;
    const email = session.email.trim();
    if (!email) return;
    const payload = form as unknown as Record<string, unknown>;
    const localId = window.setTimeout(() => {
      try {
        const at = writeInductionDraft(token, email, form);
        setDraftSavedAt(at);
      } catch {
        /* ignore quota / private mode */
      }
    }, 650);
    const serverId = window.setTimeout(() => {
      void saveSkylineInductionDraft({
        accessToken: token,
        sessionToken: session.sessionToken,
        payload,
      }).then((res) => {
        if (res.ok && res.savedAt) {
          const t = Date.parse(res.savedAt);
          if (!Number.isNaN(t)) setDraftSavedAt(t);
        }
      });
    }, 2200);
    return () => {
      window.clearTimeout(localId);
      window.clearTimeout(serverId);
    };
  }, [form, token, session, submitted]);

  const saveDraftManually = useCallback(async () => {
    if (!token || !session || submitted) return;
    const email = session.email.trim();
    if (!email) return;
    const res = await saveSkylineInductionDraft({
      accessToken: token,
      sessionToken: session.sessionToken,
      payload: form as unknown as Record<string, unknown>,
    });
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save draft.');
      return;
    }
    try {
      writeInductionDraft(token, email, form);
    } catch {
      /* ignore */
    }
    if (res.savedAt) {
      const t = Date.parse(res.savedAt);
      setDraftSavedAt(Number.isNaN(t) ? Date.now() : t);
    } else {
      setDraftSavedAt(Date.now());
    }
    toast.success('Draft saved. Sign in again with the same email to continue.');
  }, [token, session, submitted, form]);

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
    const sess = { sessionToken: result.sessionToken, email: email.trim() };
    persistSession(sess);
    const draftRestored = await hydrateFormAfterAuth(sess, { toastOnDraft: true });
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
    if (!draftRestored) {
      toast.success('Welcome — complete all sections below, then submit.');
    }
  };

  const handleSubmitForm = async () => {
    if (!token || !session || submitBlocked) return;
    const err = validateInductionFormPayload(form);
    if (err) {
      toast.error(err);
      return;
    }
    const wasAlreadySubmitted = submitted;
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
    clearInductionDraft(token, session.email);
    setDraftSavedAt(null);
    setSubmitted(true);
    toast.success(wasAlreadySubmitted ? 'Induction updated. Thank you.' : 'Induction submitted. Thank you.');
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

  /** Submitted: dedicated thank-you screen (same pattern as InstanceFillPage after final submit). */
  if (session && submitted) {
    return (
      <div className="min-h-screen bg-[var(--bg)]">
        <header className="bg-white border-b border-[var(--border)] shadow-sm sticky top-0 z-20">
          <div className="w-full min-w-0 px-4 md:px-6 py-4">
            <div className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white px-4 pt-3 pb-2 shadow-sm mb-4">
              <SlitDocumentHeader />
            </div>
            <div className="mx-auto max-w-3xl flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <h1 className="min-w-0 text-lg sm:text-xl font-bold text-[var(--text)] break-words">{row.title}</h1>
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0 self-start">
                Submitted
              </span>
            </div>
          </div>
        </header>
        <div className="w-full px-4 md:px-6 py-8">
          <div className="max-w-3xl mx-auto">
            <Card className="p-6 md:p-8">
              <h2 className="text-xl font-bold text-[var(--text)] mb-2">Thank you</h2>
              <p className="text-sm text-gray-600">
                Your induction has been submitted successfully. Your responses are on file.
              </p>
              <p className="text-sm text-gray-600 mt-3">
                You can open this link again later to review or change your answers and submit again — your latest submission
                replaces the previous one.
              </p>
              <p className="text-xs text-gray-500 mt-6">Contact the office if you need help.</p>
            </Card>
          </div>
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
        {!submitBlocked ? (
          <Card className="mb-4 border-amber-100 bg-amber-50/80 p-4 text-sm text-gray-800">
            <p className="font-semibold text-amber-950">Before you submit</p>
            <p className="mt-1">
              Complete all required student fields: Step 1 login (Yes/No for Outlook and Teams), Step 4 documents (Yes/No for
              each line — attach a file when you select Yes), checklist (Yes + initials on every topic), full enrolment details, and the
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
            inductionSubmissionFolder: session?.sessionToken || session?.email?.trim().toLowerCase() || undefined,
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
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                {!submitBlocked ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={saveDraftManually}
                    disabled={submitting}
                    className="w-full sm:w-auto"
                  >
                    Save draft
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={handleSubmitForm}
                  disabled={submitting || submitBlocked}
                  className="w-full sm:w-auto sm:min-w-[200px]"
                >
                  {submitting ? 'Submitting…' : 'Submit induction'}
                </Button>
              </div>
              {!submitBlocked ? (
                <p className="text-center text-[11px] text-gray-500 sm:text-right">
                  Draft autosaves while you edit.{' '}
                  {draftSavedAt ? (
                    <>
                      Last saved{' '}
                      {new Date(draftSavedAt).toLocaleString(undefined, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                      . Sign in again with the same email to continue on another device.
                    </>
                  ) : (
                    <>Use Save draft before closing the tab.</>
                  )}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
