import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { DatePicker } from '../components/ui/DatePicker';
import { MelbourneTime12hSelect } from '../components/induction/MelbourneTime12hSelect';
import {
  countSkylineInductionSubmissions,
  createSkylineInduction,
  deleteSkylineInduction,
  listSkylineInductions,
  listSkylineInductionSubmissions,
  patchSkylineInductionEndAt,
  patchSkylineInductionSubmissionOffice,
  type SkylineInductionRow,
  type SkylineInductionSubmissionRow,
} from '../lib/formEngine';
import { normalizeInductionDateToIso } from '../lib/inductionForm';
import { toast } from '../utils/toast';
import { formatMelbourneDateTime, melbourneLocalToUtcIso, utcIsoToMelbourneDateAndTime } from '../utils/melbourneTime';

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
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState<Set<number>>(() => new Set());
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [submissionsPage, setSubmissionsPage] = useState(1);
  const SUBMISSIONS_PAGE_SIZE = 10;
  const [officeModalSub, setOfficeModalSub] = useState<SkylineInductionSubmissionRow | null>(null);
  const [officeSmsBy, setOfficeSmsBy] = useState('');
  const [officeSmsDate, setOfficeSmsDate] = useState('');
  const [officePrismsBy, setOfficePrismsBy] = useState('');
  const [officePrismsDate, setOfficePrismsDate] = useState('');
  const [officeSaving, setOfficeSaving] = useState(false);
  const [editEndInduction, setEditEndInduction] = useState<SkylineInductionRow | null>(null);
  const [editEndDate, setEditEndDate] = useState('');
  const [editEndTime, setEditEndTime] = useState('17:00');
  const [savingEnd, setSavingEnd] = useState(false);

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
    setSubmissionsPage(1);
    setSubmissionsLoadError(null);
    setSelectedSubmissionIds(new Set());
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

  const downloadSubmissionPdfNoToast = async (sub: SkylineInductionSubmissionRow, accessToken: string) => {
    const base = PDF_BASE.replace(/\/$/, '');
    if (!base) return;
    setPdfGeneratingId(sub.id);
    try {
      const res = await fetch(`${base}/pdf/induction/${accessToken}/filled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: sub.payload }),
      });
      if (!res.ok) return;
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
    } finally {
      setPdfGeneratingId(null);
    }
  };

  const toggleSelectedSubmission = useCallback((id: number) => {
    setSelectedSubmissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setSelectedForIds = useCallback((ids: number[], checked: boolean) => {
    setSelectedSubmissionIds((prev) => {
      const next = new Set(prev);
      if (checked) for (const id of ids) next.add(id);
      else for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const downloadSelectedSubmissions = useCallback(async () => {
    if (!submissionsModal) return;
    const token = submissionsModal.access_token;
    const base = PDF_BASE.replace(/\/$/, '');
    if (!base) {
      toast.error('Set VITE_PDF_API_URL to use PDF export.');
      return;
    }
    const selected = submissionsList.filter((s) => selectedSubmissionIds.has(s.id));
    if (selected.length === 0) return;
    setBulkDownloading(true);
    try {
      for (const sub of selected) {
        // eslint-disable-next-line no-await-in-loop
        await downloadSubmissionPdfNoToast(sub, token);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 250));
      }
      toast.success(`Downloading ${selected.length} PDF${selected.length === 1 ? '' : 's'}…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download selected PDFs.');
    } finally {
      setBulkDownloading(false);
    }
  }, [PDF_BASE, downloadSubmissionPdfNoToast, selectedSubmissionIds, submissionsList, submissionsModal]);

  useEffect(() => {
    // Keep page within range after filtering/refetch.
    const totalPages = Math.max(1, Math.ceil(submissionsList.length / SUBMISSIONS_PAGE_SIZE));
    setSubmissionsPage((p) => Math.min(Math.max(1, p), totalPages));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionsList.length, submissionsModal?.id]);

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
    if (
      !window.confirm(
        'Remove this induction window from the list? The public link will stop working. Student submissions are kept in the database.'
      )
    )
      return;
    const { error } = await deleteSkylineInduction(id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Induction window removed.');
    await load();
  };

  const openEditEnd = (r: SkylineInductionRow) => {
    setEditEndInduction(r);
    const { date, time } = utcIsoToMelbourneDateAndTime(r.end_at);
    setEditEndDate(date);
    setEditEndTime(time || '17:00');
  };

  const saveEditEnd = async () => {
    if (!editEndInduction || !editEndDate.trim()) return;
    setSavingEnd(true);
    try {
      const endIso = melbourneLocalToUtcIso(editEndDate, editEndTime);
      const res = await patchSkylineInductionEndAt({ inductionId: editEndInduction.id, end_at_iso: endIso });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('End time updated. The public link is unchanged.');
      setEditEndInduction(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid date or time.');
    } finally {
      setSavingEnd(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="w-full max-w-[100vw] px-3 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6">
        <Card className="mb-4 sm:mb-6 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold text-[var(--text)]">Skyline inductions</h2>
              <p className="text-sm text-gray-600 mt-1 break-words">
                Start and end times use Australian Eastern time (Melbourne). Share the link or QR so students can complete
                induction online. Use <strong>View submissions</strong> to download each response as a{' '}
                <strong>filled PDF</strong> (same four-page pack). Download the <strong>blank PDF pack</strong> from the Share column or inside the
                submissions window to email or print for students; the public page has no PDF download.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:shrink-0">
              <Button type="button" className="w-full sm:w-auto" onClick={() => setShowCreate(true)}>
                New induction
              </Button>
              <Link to="/admin/enrollment" className="w-full sm:w-auto">
                <Button variant="outline" className="w-full sm:w-auto">
                  Back
                </Button>
              </Link>
            </div>
          </div>
        </Card>

        <Card className="overflow-x-auto" padding="none">
          {submissionCountsRpcError ? (
            <div className="mx-4 mt-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Submission counts could not be loaded. Refresh the page or contact your administrator if this continues.
            </div>
          ) : null}
          {loading ? (
            <div className="px-4 py-10 text-center text-sm text-gray-600">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-600">No induction windows yet. Create one to get a link and QR.</div>
          ) : (
            <>
              {/* Mobile: stacked cards (readable without horizontal scroll) */}
              <div className="divide-y divide-gray-100 lg:hidden">
                {rows.map((r) => (
                  <div key={r.id} className="space-y-4 p-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Title</div>
                      <div className="mt-0.5 font-medium text-[var(--text)] break-words">{r.title}</div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 text-sm text-gray-700 sm:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium text-gray-500">Start (Melbourne)</div>
                        <div className="break-words">{formatMelbourneDateTime(r.start_at)}</div>
                      </div>
                      <div>
                        <div className="text-xs font-medium text-gray-500">End (Melbourne)</div>
                        <div className="break-words">{formatMelbourneDateTime(r.end_at)}</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-2">Share &amp; PDF</div>
                      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                        {qrByToken[r.access_token] ? (
                          <img
                            src={qrByToken[r.access_token]}
                            alt=""
                            className="h-[120px] w-[120px] shrink-0 border border-gray-200 rounded bg-white"
                          />
                        ) : (
                          <div className="h-[120px] w-[120px] shrink-0 border border-dashed border-gray-200 rounded bg-gray-50" />
                        )}
                        <div className="flex min-w-0 w-full flex-col gap-2">
                          <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => void copyLink(r.access_token)}>
                            Copy link
                          </Button>
                          {PDF_BASE ? (
                            <a
                              href={`${PDF_BASE}/pdf/induction/${r.access_token}?download=1`}
                              className="text-sm font-medium text-blue-600 underline decoration-blue-600/80 hover:text-blue-700 break-words"
                            >
                              Download PDF pack
                            </a>
                          ) : null}
                          <code className="block text-xs text-gray-600 break-all">{publicInductionUrl(r.access_token)}</code>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
                      <div className="text-xs text-gray-600">
                        Submissions:{' '}
                        {submissionCountsRpcError ? (
                          '—'
                        ) : submissionCountById[r.id] !== undefined ? (
                          <>
                            <strong className="text-gray-900">{submissionCountById[r.id]}</strong> received
                          </>
                        ) : (
                          '…'
                        )}
                      </div>
                      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => void openSubmissions(r)}>
                        View submissions
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="button" variant="outline" size="sm" className="w-full sm:flex-1" onClick={() => openEditEnd(r)}>
                        Edit end time
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full border-red-200 text-red-700 sm:flex-1"
                        onClick={() => void onDelete(r.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: wide table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left">
                      <th className="py-3 px-3 font-semibold text-gray-800">Title</th>
                      <th className="py-3 px-3 font-semibold text-gray-800">Start (Melbourne)</th>
                      <th className="py-3 px-3 font-semibold text-gray-800">End (Melbourne)</th>
                      <th className="py-3 px-3 font-semibold text-gray-800">Share &amp; PDF</th>
                      <th className="py-3 px-3 font-semibold text-gray-800 whitespace-nowrap">Submissions</th>
                      <th className="py-3 px-3 font-semibold text-gray-800 whitespace-nowrap min-w-[132px]">Actions</th>
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
                          <div className="flex flex-col gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => openEditEnd(r)}>
                              Edit end time
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-red-700 border-red-200"
                              onClick={() => void onDelete(r.id)}
                            >
                              Remove
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {submissionsModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto" role="dialog">
            <Card className="w-full max-w-[min(100vw-1rem,72rem)] max-h-[90vh] overflow-hidden flex flex-col shadow-xl my-4">
              <div className="p-4 border-b border-gray-200 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-[var(--text)]">Submitted inductions</h3>
                  <p className="text-sm text-gray-600 mt-1 break-words">{submissionsModal.title}</p>
                  <p className="text-xs text-gray-500 mt-2 break-words">
                    Melbourne: {formatMelbourneDateTime(submissionsModal.start_at)} → {formatMelbourneDateTime(submissionsModal.end_at)}
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                  {PDF_BASE ? (
                    <a
                      href={`${PDF_BASE}/pdf/induction/${submissionsModal.access_token}?download=1`}
                      className="inline-flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-medium bg-[var(--brand)] text-white hover:opacity-95 sm:w-auto"
                    >
                      Download blank PDF pack
                    </a>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    disabled={!PDF_BASE || bulkDownloading || selectedSubmissionIds.size === 0}
                    title={!PDF_BASE ? 'Set VITE_PDF_API_URL to the PDF server URL' : undefined}
                    onClick={() => void downloadSelectedSubmissions()}
                  >
                    {bulkDownloading ? 'Downloading…' : `Download selected (${selectedSubmissionIds.size})`}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full sm:w-auto"
                    onClick={() => {
                      setOfficeModalSub(null);
                      setSubmissionsModal(null);
                      setSelectedSubmissionIds(new Set());
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
                  <>
                    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 text-center text-xs text-gray-600 sm:text-left">
                        {(() => {
                          const total = submissionsList.length;
                          const totalPages = Math.max(1, Math.ceil(total / SUBMISSIONS_PAGE_SIZE));
                          const start = (submissionsPage - 1) * SUBMISSIONS_PAGE_SIZE + 1;
                          const end = Math.min(total, submissionsPage * SUBMISSIONS_PAGE_SIZE);
                          return (
                            <span>
                              Showing <strong className="text-gray-900">{start}</strong>–<strong className="text-gray-900">{end}</strong> of{' '}
                              <strong className="text-gray-900">{total}</strong> submissions (page{' '}
                              <strong className="text-gray-900">{submissionsPage}</strong> / <strong className="text-gray-900">{totalPages}</strong>)
                            </span>
                          );
                        })()}
                      </div>
                      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={() => setSelectedForIds(submissionsList.map((s) => s.id), true)}
                          disabled={submissionsList.length === 0}
                        >
                          Select all
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={() => setSelectedSubmissionIds(new Set())}
                          disabled={selectedSubmissionIds.size === 0}
                        >
                          Clear selection
                        </Button>
                      </div>
                      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-nowrap sm:justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-w-0"
                          onClick={() => setSubmissionsPage(1)}
                          disabled={submissionsPage <= 1}
                        >
                          First
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-w-0"
                          onClick={() => setSubmissionsPage((p) => Math.max(1, p - 1))}
                          disabled={submissionsPage <= 1}
                        >
                          Prev
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-w-0"
                          onClick={() => {
                            const totalPages = Math.max(1, Math.ceil(submissionsList.length / SUBMISSIONS_PAGE_SIZE));
                            setSubmissionsPage((p) => Math.min(totalPages, p + 1));
                          }}
                          disabled={submissionsPage >= Math.max(1, Math.ceil(submissionsList.length / SUBMISSIONS_PAGE_SIZE))}
                        >
                          Next
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-w-0"
                          onClick={() => {
                            const totalPages = Math.max(1, Math.ceil(submissionsList.length / SUBMISSIONS_PAGE_SIZE));
                            setSubmissionsPage(totalPages);
                          }}
                          disabled={submissionsPage >= Math.max(1, Math.ceil(submissionsList.length / SUBMISSIONS_PAGE_SIZE))}
                        >
                          Last
                        </Button>
                      </div>
                    </div>
                    {(() => {
                      const pageSlice = submissionsList.slice(
                        (submissionsPage - 1) * SUBMISSIONS_PAGE_SIZE,
                        submissionsPage * SUBMISSIONS_PAGE_SIZE
                      );
                      const pageIds = pageSlice.map((s) => s.id);
                      const pageAllChecked = pageIds.length > 0 && pageIds.every((id) => selectedSubmissionIds.has(id));
                      const pageAnyChecked = pageIds.some((id) => selectedSubmissionIds.has(id));
                      return (
                        <>
                          <div className="space-y-3 lg:hidden">
                            {pageSlice.map((sub) => (
                              <div key={sub.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="text-xs font-medium uppercase tracking-wide text-gray-500">Submitted (Melbourne)</div>
                                  <label className="inline-flex items-center gap-2 text-xs text-gray-700 select-none">
                                    <input
                                      type="checkbox"
                                      checked={selectedSubmissionIds.has(sub.id)}
                                      onChange={() => toggleSelectedSubmission(sub.id)}
                                      className="h-4 w-4"
                                    />
                                    Select
                                  </label>
                                </div>
                                <div className="mt-0.5 text-sm text-gray-800 break-words">{formatMelbourneDateTime(sub.submitted_at)}</div>
                                <div className="mt-3 text-xs font-medium text-gray-500">Type</div>
                                <div className="mt-0.5">
                                  {sub.guest_email ? (
                                    <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-900">Guest</span>
                                  ) : sub.student_id != null ? (
                                    <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800">Student</span>
                                  ) : (
                                    <span className="text-sm text-gray-500">—</span>
                                  )}
                                </div>
                                <div className="mt-3 text-xs font-medium text-gray-500">Email</div>
                                <div className="mt-0.5 text-sm text-gray-800 break-all">{sub.student_email || sub.guest_email || '—'}</div>
                                <div className="mt-3 text-xs font-medium text-gray-500">Name (checklist)</div>
                                <div className="mt-0.5 text-sm text-gray-800 break-words">{payloadDisplayName(sub.payload)}</div>
                                <div className="mt-4 flex flex-col gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="w-full justify-center"
                                    disabled={pdfGeneratingId === sub.id || !PDF_BASE}
                                    title={!PDF_BASE ? 'Set VITE_PDF_API_URL to the PDF server URL' : undefined}
                                    onClick={() => void downloadSubmissionPdf(sub, submissionsModal.access_token)}
                                  >
                                    {pdfGeneratingId === sub.id ? '…' : 'Download PDF'}
                                  </Button>
                                  <Button type="button" variant="outline" size="sm" className="w-full justify-center" onClick={() => openOfficeModal(sub)}>
                                    Office use — Edit
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 lg:block">
                            <table className="w-full min-w-[920px] text-sm border-collapse">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                                  <th className="whitespace-nowrap py-2 px-3 font-semibold text-gray-800">
                                    <label className="inline-flex items-center gap-2 select-none">
                                      <input
                                        type="checkbox"
                                        checked={pageAllChecked}
                                        ref={(el) => {
                                          if (el) el.indeterminate = !pageAllChecked && pageAnyChecked;
                                        }}
                                        onChange={(e) => setSelectedForIds(pageIds, e.target.checked)}
                                        className="h-4 w-4"
                                      />
                                      Select
                                    </label>
                                  </th>
                                  <th className="whitespace-nowrap py-2 px-3 font-semibold text-gray-800">Submitted (Melbourne)</th>
                                  <th className="whitespace-nowrap py-2 px-3 font-semibold text-gray-800">Type</th>
                                  <th className="min-w-[12rem] py-2 px-3 font-semibold text-gray-800">Email</th>
                                  <th className="min-w-[10rem] py-2 px-3 font-semibold text-gray-800">Name (checklist)</th>
                                  <th className="whitespace-nowrap py-2 px-3 font-semibold text-gray-800">PDF</th>
                                  <th className="whitespace-nowrap py-2 px-3 font-semibold text-gray-800">Office use</th>
                                </tr>
                              </thead>
                              <tbody>
                                {pageSlice.map((sub) => (
                                  <tr key={sub.id} className="border-b border-gray-100 hover:bg-gray-50/80">
                                    <td className="py-2 px-3 align-top">
                                      <input
                                        type="checkbox"
                                        checked={selectedSubmissionIds.has(sub.id)}
                                        onChange={() => toggleSelectedSubmission(sub.id)}
                                        className="h-4 w-4"
                                      />
                                    </td>
                                    <td className="py-2 px-3 align-top text-gray-700">
                                      <span className="whitespace-nowrap">{formatMelbourneDateTime(sub.submitted_at)}</span>
                                    </td>
                                    <td className="py-2 px-3 align-top whitespace-nowrap">
                                      {sub.guest_email ? (
                                        <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-900">Guest</span>
                                      ) : sub.student_id != null ? (
                                        <span className="inline-flex rounded px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-800">Student</span>
                                      ) : (
                                        <span className="text-gray-500">—</span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 align-top text-gray-800 break-all">{sub.student_email || sub.guest_email || '—'}</td>
                                    <td className="max-w-[16rem] py-2 px-3 align-top text-gray-800 break-words" title={payloadDisplayName(sub.payload)}>
                                      {payloadDisplayName(sub.payload)}
                                    </td>
                                    <td className="py-2 px-3 align-top">
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
                                    <td className="py-2 px-3 align-top">
                                      <Button type="button" variant="outline" size="sm" onClick={() => openOfficeModal(sub)}>
                                        Edit
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      );
                    })()}
                  </>
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

        {editEndInduction ? (
          <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-labelledby="edit-end-title">
            <Card className="w-full max-w-md p-6 shadow-xl">
              <h3 id="edit-end-title" className="text-lg font-bold text-[var(--text)]">
                Change end time
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                The public link and QR code stay the same. Only the window closing time changes.
              </p>
              <p className="text-xs text-gray-500 mt-2">
                Current start (Melbourne):{' '}
                <span className="font-medium text-gray-800">{formatMelbourneDateTime(editEndInduction.start_at)}</span>
              </p>
              <div className="mt-4 space-y-3">
                <DatePicker
                  label="End date (Melbourne)"
                  value={editEndDate}
                  onChange={setEditEndDate}
                  placement="below"
                  required
                  className="w-full"
                />
                <MelbourneTime12hSelect
                  label="End time (Melbourne)"
                  value={editEndTime}
                  onChange={setEditEndTime}
                  disabled={savingEnd}
                />
              </div>
              <div className="mt-6 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditEndInduction(null)} disabled={savingEnd}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void saveEditEnd()} disabled={savingEnd || !editEndDate.trim()}>
                  {savingEnd ? 'Saving…' : 'Save'}
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
                <MelbourneTime12hSelect label="Start time" value={startTime} onChange={setStartTime} />
                <DatePicker
                  label="End date"
                  value={endDate}
                  onChange={setEndDate}
                  placement="below"
                  required
                  className="w-full"
                />
                <MelbourneTime12hSelect label="End time" value={endTime} onChange={setEndTime} />
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
