import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ClipboardCheck } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Loader } from '../ui/Loader';
import { cn } from '../utils/cn';
import { toast } from '../../utils/toast';
import {
  fetchAssessmentSummaries,
  issueInstanceAccessLink,
  listTrainerPendingForGradeMePanel,
  TRAINER_GRADE_ME_MAX_INSTANCES,
  type SubmittedInstanceRow,
} from '../../lib/formEngine';
import {
  computeRowUi,
  formatDDMMYYYY,
  getStudentAttemptDoneText,
  getMissedAttemptWindowText,
  melDateString,
  maskCompetentWhileAwaitingTrainer,
  type AttemptResult,
} from '../../utils/assessmentRowUi';
import {
  rowMatchesTrainerHighlightCourse,
  TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS,
  useTrainerHighlightCourseId,
} from '../../utils/trainerCourseHighlight';

const withinWindowMelbourne = (row: Pick<SubmittedInstanceRow, 'start_date' | 'end_date'>): { ok: boolean; reason?: string } => {
  const today = melDateString(new Date());
  const start = String(row.start_date ?? '').trim();
  const end = String(row.end_date ?? '').trim();
  if (start && today < start) return { ok: false, reason: `Available from ${formatDDMMYYYY(start)}` };
  if (end && today > end) return { ok: false, reason: `Expired on ${formatDDMMYYYY(end)} (23:59 AEDT)` };
  return { ok: true };
};

async function fetchSummariesChunked(instanceIds: number[]): Promise<
  Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
> {
  const ids = Array.from(new Set(instanceIds.filter((n) => Number.isFinite(n) && n > 0)));
  const chunk = 120;
  const out: Record<
    number,
    { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }
  > = {};
  for (let i = 0; i < ids.length; i += chunk) {
    const part = await fetchAssessmentSummaries(ids.slice(i, i + chunk));
    Object.assign(out, part as typeof out);
  }
  return out;
}

type Props = { trainerUserId: number };

export const TrainerGradeMePanel: React.FC<Props> = ({ trainerUserId }) => {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SubmittedInstanceRow[]>([]);
  const [totalPending, setTotalPending] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [expandedFormIds, setExpandedFormIds] = useState<Set<number>>(() => new Set());
  const [openingId, setOpeningId] = useState<number | null>(null);
  const trainerHighlightCourseId = useTrainerHighlightCourseId();
  const [attemptSummaryByInstanceId, setAttemptSummaryByInstanceId] = useState<
    Record<number, { final_attempt_1_result: AttemptResult; final_attempt_2_result: AttemptResult; final_attempt_3_result: AttemptResult }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listTrainerPendingForGradeMePanel(trainerUserId);
      setRows(res.rows);
      setTotalPending(res.total);
      setTruncated(res.truncated);
    } catch {
      toast.error('Failed to load Grade me');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [trainerUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (rows.length === 0) {
      setAttemptSummaryByInstanceId({});
      return;
    }
    const ids = rows.map((r) => r.id);
    let cancelled = false;
    void (async () => {
      const m = await fetchSummariesChunked(ids);
      if (cancelled) return;
      setAttemptSummaryByInstanceId(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  const groups = useMemo(() => {
    const m = new Map<number, { formId: number; unitLabel: string; rows: SubmittedInstanceRow[] }>();
    for (const row of rows) {
      const fid = row.form_id;
      if (!m.has(fid)) {
        const code = row.form_unit_code?.trim();
        const unitLabel = code || row.form_name || `Form #${fid}`;
        m.set(fid, { formId: fid, unitLabel, rows: [] });
      }
      m.get(fid)!.rows.push(row);
    }
    for (const g of m.values()) {
      g.rows.sort((a, b) => (a.student_name || '').localeCompare(b.student_name || '', undefined, { sensitivity: 'base' }));
    }
    return [...m.values()].sort((a, b) => a.unitLabel.localeCompare(b.unitLabel, undefined, { sensitivity: 'base' }));
  }, [rows]);

  const allFormIds = useMemo(() => groups.map((g) => g.formId), [groups]);
  const allExpanded = allFormIds.length > 0 && allFormIds.every((id) => expandedFormIds.has(id));

  const toggleExpandAll = () => {
    if (allExpanded) setExpandedFormIds(new Set());
    else setExpandedFormIds(new Set(allFormIds));
  };

  const toggleUnit = (formId: number) => {
    setExpandedFormIds((prev) => {
      const next = new Set(prev);
      if (next.has(formId)) next.delete(formId);
      else next.add(formId);
      return next;
    });
  };

  const handleOpen = async (row: SubmittedInstanceRow) => {
    const win = withinWindowMelbourne(row);
    if (!win.ok) {
      toast.error(win.reason || 'This assessment is not available right now.');
      return;
    }
    setOpeningId(row.id);
    const url = await issueInstanceAccessLink(row.id, 'trainer');
    setOpeningId(null);
    if (!url) {
      toast.error('Failed to open secure link');
      return;
    }
    window.open(url, '_blank');
  };

  return (
    <Card className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-[var(--brand)]" />
            Grade me
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Units with submissions awaiting your review. Expand a unit to see students — same activity window as the table below (amber = ready to
            grade).
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
          {groups.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={toggleExpandAll}>
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <Loader variant="dots" size="md" message="Loading units…" />
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-600 py-2">No pending assessments right now.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            {totalPending} pending assessment{totalPending !== 1 ? 's' : ''} across {groups.length} unit{groups.length !== 1 ? 's' : ''}
            {truncated ? ` (showing first ${TRAINER_GRADE_ME_MAX_INSTANCES} rows — use search below for the full list)` : ''}.
          </p>
          <ul className="space-y-2">
            {groups.map(({ formId, unitLabel, rows: unitRows }) => {
              const expanded = expandedFormIds.has(formId);
              return (
                <li key={formId} className="rounded-lg border border-[var(--border)] bg-gray-50/80 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleUnit(formId)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-100/90 transition-colors"
                  >
                    <ChevronRight
                      className={cn('w-4 h-4 text-gray-500 shrink-0 transition-transform', expanded && 'rotate-90')}
                      aria-hidden
                    />
                    <span className="font-semibold text-[var(--brand)] tabular-nums">{unitLabel}</span>
                    <span className="text-sm text-gray-600">· {unitRows.length} pending</span>
                  </button>
                  {expanded ? (
                    <div className="border-t border-[var(--border)] bg-white px-2 py-2 space-y-1">
                      {unitRows.map((row) => {
                        const sum = attemptSummaryByInstanceId[row.id] ?? null;
                        const rawAttemptResults: AttemptResult[] = [
                          sum?.final_attempt_1_result ?? null,
                          sum?.final_attempt_2_result ?? null,
                          sum?.final_attempt_3_result ?? null,
                        ];
                        const attemptResults = maskCompetentWhileAwaitingTrainer(row, rawAttemptResults);
                        const ui = computeRowUi({
                          row: { ...row, did_not_attempt: row.did_not_attempt ?? null },
                          attemptResults,
                        });
                        const attemptDoneText = getStudentAttemptDoneText({
                          submissionCount: Number(row.submission_count ?? 0) || (row.submitted_at ? 1 : 0),
                          submittedAt: row.submitted_at ?? null,
                          attemptResults: rawAttemptResults,
                        });
                        const missedAttemptText = getMissedAttemptWindowText({
                          noAttemptRollovers: row.no_attempt_rollovers ?? null,
                          didNotAttempt: row.did_not_attempt ?? null,
                        });
                        const win = withinWindowMelbourne(row);
                        const highlightExtra = rowMatchesTrainerHighlightCourse(row, trainerHighlightCourseId)
                          ? TRAINER_HIGHLIGHT_ROW_EXTRA_CLASS
                          : '';
                        const rowMuted = ui.disabled || !win.ok;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            disabled={openingId === row.id}
                            onClick={() => void handleOpen(row)}
                            className={cn(
                              'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                              ui.rowClassName,
                              highlightExtra,
                              rowMuted ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'
                            )}
                          >
                            <div className="font-medium text-[var(--text)]">{row.student_name}</div>
                            <div className="text-xs text-gray-500 break-all">{row.student_email || '—'}</div>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-gray-600">
                              {attemptDoneText ? <span>{attemptDoneText}</span> : null}
                              {missedAttemptText && ui.kind === 'in_progress' ? (
                                <span className="font-medium text-amber-800">{missedAttemptText}</span>
                              ) : null}
                              {!win.ok ? <span className="text-amber-800">{win.reason}</span> : null}
                            </div>
                            {openingId === row.id ? (
                              <div className="mt-1">
                                <Loader variant="dots" size="sm" inline />
                              </div>
                            ) : null}
                          </button>
                        );
                      })}
                      <div className="pt-1">
                        <Link
                          to={`/admin/course-units/${formId}/submissions`}
                          className="text-sm font-medium text-[var(--brand)] hover:underline inline-flex items-center gap-1"
                        >
                          View all submissions for this unit →
                        </Link>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {groups.length > 10 ? (
            <p className="text-xs text-gray-500 mt-4">There are more than 10 units with ungraded work — expand each unit to review students.</p>
          ) : null}
        </>
      )}
    </Card>
  );
};
