import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DatePicker } from '../components/ui/DatePicker';
import {
  countSkylineInductionSubmissions,
  createSkylineInduction,
  deleteSkylineInduction,
  listSkylineInductions,
  listSkylineInductionSubmissions,
  patchSkylineInductionSubmissionOffice,
  type SkylineInductionRow,
  type SkylineInductionSubmissionRow,
} from '../lib/formEngine';
import { normalizeInductionDateToIso } from '../lib/inductionForm';
import { toast } from '../utils/toast';
import { formatMelbourneDateTime, melbourneLocalToUtcIso } from '../utils/melbourneTime';

const PDF_BASE = import.meta.env.VITE_PDF_API_URL ?? '';

/** Matches pdf-server `inductionFilledPdfFilename` for download fallback when header is missing. */
function inductionPdfDownloadName(payload: Record<string, unknown>): string {
  const h = payload.checklistHeader as { fullName?: string } | undefined;
  let name = String(h?.fullName ?? '').trim();
  if (!name) {
    const e = payload.enrolment as { givenNames?: string; familyName?: string } | undefined;
    const parts = [e?.givenNames, e?.familyName].map((s) => String(s ?? '').trim()).filter(Boolean);
    name = parts.join(' ');
  }
  if (!name) name = 'Student';
  const safe = name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${safe || 'Student'} induction form.pdf`;
}

function publicInductionUrl(accessToken: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/induction/${accessToken}`;
}

export const AdminInductionPage: React.FC = () => {
  const [rows, setRows] = useState<SkylineInductionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('Skyline induction');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('17:00');
  const [saving, setSaving] = useState(false);
  const [qrByToken, setQrByToken] = useState<Record<string, string>>({});
  const [submissionCountById, setSubmissionCountById] = useState<Record<number, number>>({});
  const [submissionsModal, setSubmissionsModal] = useState<SkylineInductionRow | null>(null);
  const [submissionsList, setSubmissionsList] = useState<SkylineInductionSubmissionRow[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsLoadError, setSubmissionsLoadError] = useState<string | null>(null);
  const [submissionCountsRpcError, setSubmissionCountsRpcError] = useState<string | null>(null);
  const [pdfGeneratingId, setPdfGeneratingId] = useState<number | null>(null);
  const [officeModalSub, setOfficeModalSub] = useState<SkylineInductionSubmissionRow | null>(null);
  const [officeSmsBy, setOfficeSmsBy] = useState('');
  const [officeSmsDate, setOfficeSmsDate] = useState('');
  const [officePrismsBy, setOfficePrismsBy] = useState('');
  const [officePrismsDate, setOfficePrismsDate] = useState('');
  const [officeSaving, setOfficeSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await listSkylineInductions();
    setRows(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${d}`;
    setStartDate((s) => s || iso);
    setEndDate((e) => e || iso);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const r of rows) {
        const url = publicInductionUrl(r.access_token);
        try {
          const dataUrl = await QRCode.toDataURL(url, { width: 120, margin: 1 });
          if (!cancelled) next[r.access_token] = dataUrl;
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setQrByToken((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<number, number> = {};
      let firstErr: string | null = null;
      for (const r of rows) {
        const { count, error } = await countSkylineInductionSubmissions(r.id);
        if (error && !firstErr) firstErr = error;
        if (!cancelled) next[r.id] = count;
      }
      if (!cancelled) {
        setSubmissionCountById(next);
        setSubmissionCountsRpcError(firstErr);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const openSubmissions = async (induction: SkylineInductionRow) => {
    setSubmissionsModal(induction);
    setSubmissionsLoading(true);
    setSubmissionsList([]);
    setSubmissionsLoadError(null);
    try {
      const { rows: list, error: listErr } = await listSkylineInductionSubmissions(induction.id);
      if (listErr) {
        setSubmissionsLoadError(listErr);
        toast.error('Could not load submissions. Try again or contact your administrator if this keeps happening.');
      }
      setSubmissionsList(list);
      const { count, error: countErr } = await countSkylineInductionSubmissions(induction.id);
      if (countErr && !listErr) {
        setSubmissionsLoadError(countErr);
        toast.error('Could not refresh submission count.');
      }
      setSubmissionCountById((prev) => ({ ...prev, [induction.id]: count }));
    } finally {
      setSubmissionsLoading(false);
    }
  };

  const downloadSubmissionPdf = async (sub: SkylineInductionSubmissionRow, accessToken: string) => {
    const base = PDF_BASE.replace(/\/$/, '');
    if (!base) {
      toast.error('Set VITE_PDF_API_URL to use PDF export.');
      return;
    }
    setPdfGeneratingId(sub.id);
    try {
      const res = await fetch(`${base}/pdf/induction/${accessToken}/filled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: sub.payload }),
      });
      if (!res.ok) {
        const t = await res.text();
        toast.error(t.trim() || `PDF export failed (${res.status}). Is the PDF server running?`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('Content-Disposition');
      const m = cd?.match(/filename="([^"]+)"/);
      a.download = m?.[1] ?? inductionPdfDownloadName(sub.payload);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Filled induction PDF downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download PDF.');
    } finally {
      setPdfGeneratingId(null);
    }
  };

  const payloadDisplayName = (payload: Record<string, unknown>): string => {
    const h = payload.checklistHeader as { fullName?: string } | undefined;
    const n = h?.fullName?.trim();
    return n || '—';
  };

  const openOfficeModal = (sub: SkylineInductionSubmissionRow) => {
    const en = (sub.payload as { enrolment?: Record<string, unknown> }).enrolment ?? {};
    setOfficeSmsBy(String(en.officeSmsBy ?? ''));
    setOfficeSmsDate(normalizeInductionDateToIso(String(en.officeSmsDate ?? '')));
    setOfficePrismsBy(String(en.officePrismsBy ?? ''));
    setOfficePrismsDate(normalizeInductionDateToIso(String(en.officePrismsDate ?? '')));
    setOfficeModalSub(sub);
  };

  const saveOffice = async () => {
    if (!officeModalSub || !submissionsModal) return;
    setOfficeSaving(true);
    try {
      const res = await patchSkylineInductionSubmissionOffice({
        submissionId: officeModalSub.id,
        officeSmsBy: officeSmsBy.trim(),
        officeSmsDate: normalizeInductionDateToIso(officeSmsDate),
        officePrismsBy: officePrismsBy.trim(),
        officePrismsDate: normalizeInductionDateToIso(officePrismsDate),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Office use saved.');
      setOfficeModalSub(null);
      const { rows: list, error: listErr } = await listSkylineInductionSubmissions(submissionsModal.id);
      if (!listErr) setSubmissionsList(list);
    } finally {
      setOfficeSaving(false);
    }
  };

  const copyLink = async (token: string) => {
    const url = publicInductionUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied — induction link is on the clipboard.');
    } catch {
      toast.error(`Copy failed: ${url}`);
    }
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startDate || !endDate) return;
    setSaving(true);
    try {
      const startIso = melbourneLocalToUtcIso(startDate, startTime);
      const endIso = melbourneLocalToUtcIso(endDate, endTime);
      const { row, error } = await createSkylineInduction({
        title,
        start_at_iso: startIso,
        end_at_iso: endIso,
      });
      if (error || !row) {
        toast.error(error?.message ?? 'Could not create induction.');
        return;
      }
      toast.success('Induction created. Share the link or QR with students.');
      setShowCreate(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Check Melbourne date and time.');
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: number) => {
    if (!window.confirm('Delete this induction window? Links will stop working.')) return;
    const { error } = await deleteSkylineInduction(id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Induction deleted.');
    await load();
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full px-4 md:px-6 lg:px-8 py-6">
        <Card className="mb-6 p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[var(--text)]">Skyline inductions</h2>
              <p className="text-sm text-gray-600 mt-1">
                Start and end times use Australian Eastern time (Melbourne). Share the link or QR so students can complete
                induction online. Use <strong>View submissions</strong> to download each response as a{' '}
                <strong>filled PDF</strong> (same four-page pack). Download the <strong>blank PDF pack</strong> from the Share column or inside the
                submissions window to email or print for students; the public page has no PDF download.
              </p>

            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => setShowCreate(true)}>
                New induction
              </Button>
              <Link to="/admin/enrollment">
                <Button variant="outline">Back</Button>
              </Link>
            </div>
          </div>
        </Card>

        <Card className="overflow-x-auto">
          {submissionCountsRpcError ? (
            <div className="mx-4 mt-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Submission counts could not be loaded. Refresh the page or contact your administrator if this continues.
            </div>
          ) : null}
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-600">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-600">No induction windows yet. Create one to get a link and QR.</div>
          ) : (
            <table className="w-full min-w-[900px] text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left">
                  <th className="py-3 px-3 font-semibold text-gray-800">Title</th>
                  <th className="py-3 px-3 font-semibold text-gray-800">Start (Melbourne)</th>
                  <th className="py-3 px-3 font-semibold text-gray-800">End (Melbourne)</th>
                  <th className="py-3 px-3 font-semibold text-gray-800">Share &amp; PDF</th>
                  <th className="py-3 px-3 font-semibold text-gray-800 whitespace-nowrap">Submissions</th>
                  <th className="py-3 px-3 font-semibold text-gray-800 w-[100px]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                    <td className="py-3 px-3 font-medium text-[var(--text)]">{r.title}</td>
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{formatMelbourneDateTime(r.start_at)}</td>
                    <td className="py-3 px-3 text-gray-700 whitespace-nowrap">{formatMelbourneDateTime(r.end_at)}</td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap items-center gap-3">
                        {qrByToken[r.access_token] ? (
                          <img
                            src={qrByToken[r.access_token]}
                            alt=""
                            className="h-[120px] w-[120px] border border-gray-200 rounded bg-white"
                          />
                        ) : (
                          <div className="h-[120px] w-[120px] border border-dashed border-gray-200 rounded bg-gray-50" />
                        )}
                        <div className="flex flex-col gap-2 min-w-0">
                          <Button type="button" variant="outline" size="sm" onClick={() => void copyLink(r.access_token)}>
                            Copy link
                          </Button>
                          {PDF_BASE ? (
                            <a
                              href={`${PDF_BASE}/pdf/induction/${r.access_token}?download=1`}
                              className="text-sm font-medium text-blue-600 underline decoration-blue-600/80 hover:text-blue-700"
                            >
                              Download PDF pack
                            </a>
                          ) : null}
                          <code className="text-xs text-gray-600 break-all max-w-[280px]">
                            {publicInductionUrl(r.access_token)}
                          </code>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 align-top">
                      <div className="flex flex-col gap-2">
                        <span className="text-xs text-gray-600">
                          {submissionCountsRpcError ? (
                            '—'
                          ) : submissionCountById[r.id] !== undefined ? (
                            <>
                              <strong className="text-gray-900">{submissionCountById[r.id]}</strong> received
                            </>
                          ) : (
                            '…'
                          )}
                        </span>
                        <Button type="button" variant="outline" size="sm" onClick={() => void openSubmissions(r)}>
                          View submissions
                        </Button>
                      </div>
                    </td>
                    <td className="py-3 px-3 align-top">
                      <Button type="button" variant="outline" size="sm" className="text-red-700 border-red-200" onClick={() => void onDelete(r.id)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {submissionsModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" role="dialog">
            <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-xl my-4">
              <div className="p-4 border-b border-gray-200 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-[var(--text)]">Submitted inductions</h3>
                  <p className="text-sm text-gray-600 mt-1">{submissionsModal.title}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Melbourne: {formatMelbourneDateTime(submissionsModal.start_at)} → {formatMelbourneDateTime(submissionsModal.end_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {PDF_BASE ? (
                    <a
                      href={`${PDF_BASE}/pdf/induction/${submissionsModal.access_token}?download=1`}
                      className="inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium bg-[var(--brand)] text-white hover:opacity-95"
                    >
                      Download blank PDF pack
                    </a>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setOfficeModalSub(null);
                      setSubmissionsModal(null);
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                {submissionsLoading ? (
                  <div className="py-12 text-center text-sm text-gray-600">Loading submissions…</div>
                ) : submissionsLoadError ? (
                  <div className="py-12 text-center text-sm text-amber-900 bg-amber-50 rounded-lg px-4">
                    Could not load submissions. Try closing this window and opening it again, or contact your administrator.
                  </div>
                ) : submissionsList.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-600">No submissions yet for this window.</div>
                ) : (
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full min-w-[880px] text-sm border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-left">
                          <th className="py-2 px-3 font-semibold text-gray-800">Submitted (Melbourne)</th>
                          <th className="py-2 px-3 font-semibold text-gray-800">Type</th>
                          <th className="py-2 px-3 font-semibold text-gray-800">Email</th>
                          <th className="py-2 px-3 font-semibold text-gray-800">Name (checklist)</th>
                          <th className="py-2 px-3 font-semibold text-gray-800 w-[120px]">PDF</th>
                          <th className="py-2 px-3 font-semibold text-gray-800 w-[130px]">Office use</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submissionsList.map((sub) => (
                          <tr key={sub.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                            <td className="py-2 px-3 text-gray-700 whitespace-nowrap">{formatMelbourneDateTime(sub.submitted_at)}</td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {sub.guest_email ? (
                                <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-900">
                                  Guest
                                </span>
                              ) : sub.student_id != null ? (
                                <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800">
                                  Student
                                </span>
                              ) : (
                                <span className="text-gray-500">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-gray-800 break-all max-w-[200px]">
                              {sub.student_email || sub.guest_email || '—'}
                            </td>
                            <td className="py-2 px-3 text-gray-800">{payloadDisplayName(sub.payload)}</td>
                            <td className="py-2 px-3">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={pdfGeneratingId === sub.id || !PDF_BASE}
                                title={!PDF_BASE ? 'Set VITE_PDF_API_URL to the PDF server URL' : undefined}
                                onClick={() => void downloadSubmissionPdf(sub, submissionsModal.access_token)}
                              >
                                {pdfGeneratingId === sub.id ? '…' : 'Download'}
                              </Button>
                            </td>
                            <td className="py-2 px-3">
                              <Button type="button" variant="outline" size="sm" onClick={() => openOfficeModal(sub)}>
                                Edit
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs text-gray-500 mt-4">
                  <strong>Download</strong> saves the four-page induction pack with this submission&apos;s checklist, enrolment, and media fields.
                  Use <strong>Office use → Edit</strong> to record SMS / PRISMS updates (shown on filled PDFs). Use <strong>Download blank PDF pack</strong> above for unfilled copies.
                </p>
              </div>
            </Card>
          </div>
        ) : null}

        {officeModalSub ? (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 overflow-y-auto" role="dialog">
            <Card className="w-full max-w-md p-6 shadow-xl my-4">
              <h3 className="text-lg font-bold text-[var(--text)]">Office use only</h3>
              <p className="text-sm text-gray-600 mt-1">
                Enrolment form — staff fields for {payloadDisplayName(officeModalSub.payload)}
              </p>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Updated in SMS by</label>
                  <input
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={officeSmsBy}
                    onChange={(e) => setOfficeSmsBy(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <DatePicker
                  label="Date (SMS)"
                  value={officeSmsDate}
                  onChange={setOfficeSmsDate}
                  compact
                  className="w-full"
                />
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Updated in PRISMS by</label>
                  <input
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={officePrismsBy}
                    onChange={(e) => setOfficePrismsBy(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <DatePicker
                  label="Date (PRISMS)"
                  value={officePrismsDate}
                  onChange={setOfficePrismsDate}
                  compact
                  className="w-full"
                />
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOfficeModalSub(null)} disabled={officeSaving}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void saveOffice()} disabled={officeSaving}>
                  {officeSaving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </Card>
          </div>
        ) : null}

        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog">
            <Card className="w-full max-w-md p-6 shadow-xl">
              <h3 className="text-lg font-bold text-[var(--text)]">New induction window</h3>
              <p className="text-sm text-gray-600 mt-1">Dates and times are interpreted in Australia/Melbourne (AEDT/AEST).</p>
              <form onSubmit={(e) => void onCreate(e)} className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Title</label>
                  <input
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </div>
                {/*
                  Date + time on one row caused the calendar popover (~320px) to sit on top of the
                  adjacent time field — clicks never reached the time input. Full-width rows avoid overlap.
                */}
                <DatePicker
                  label="Start date"
                  value={startDate}
                  onChange={setStartDate}
                  placement="below"
                  required
                  className="w-full"
                />
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Start time</label>
                  <input
                    type="time"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    autoComplete="off"
                    required
                  />
                </div>
                <DatePicker
                  label="End date"
                  value={endDate}
                  onChange={setEndDate}
                  placement="below"
                  required
                  className="w-full"
                />
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">End time</label>
                  <input
                    type="time"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    autoComplete="off"
                    required
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Create'}
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminInductionPage;
