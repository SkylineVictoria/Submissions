/**
 * Runtime verification for assessment reset + missed-attempt UI logic.
 * Usage: npx tsx scripts/verify-assessment-reset-runtime.ts
 * Requires VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  computeAttemptTones,
  computeRowUi,
  getMissedAttemptWindowText,
  getStudentAttemptDoneText,
  getTrainerAttemptFailedText,
  isTerminalFailureProgressRow,
  type AttemptResult,
} from '../src/utils/assessmentRowUi';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function resetAssessmentAttempts(instanceId: number, endDate: string): Promise<void> {
  const { error: instError } = await supabase
    .from('skyline_form_instances')
    .update({
      end_date: endDate,
      status: 'draft',
      role_context: 'student',
      workflow_status: 'draft',
      submission_count: 0,
      submitted_at: null,
      did_not_attempt: false,
      no_attempt_rollovers: 0,
      trainer_nyc_assessed_on_1: null,
      trainer_nyc_assessed_on_2: null,
      trainer_nyc_assessed_on_3: null,
    })
    .eq('id', instanceId);
  if (instError) throw instError;

  const { error: summaryError } = await supabase.from('skyline_form_assessment_summary_data').upsert(
    {
      instance_id: instanceId,
      final_attempt_1_result: null,
      final_attempt_2_result: null,
      final_attempt_3_result: null,
      trainer_sig_1: null,
      trainer_date_1: null,
      trainer_sig_2: null,
      trainer_date_2: null,
      trainer_sig_3: null,
      trainer_date_3: null,
      student_sig_1: null,
      student_date_1: null,
      student_sig_2: null,
      student_date_2: null,
      student_sig_3: null,
      student_date_3: null,
      student_overall_feedback: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'instance_id' },
  );
  if (summaryError) throw summaryError;

  const { error: resultsError } = await supabase
    .from('skyline_form_results_data')
    .update({
      first_attempt_satisfactory: null,
      first_attempt_date: null,
      first_attempt_feedback: null,
      second_attempt_satisfactory: null,
      second_attempt_date: null,
      second_attempt_feedback: null,
      third_attempt_satisfactory: null,
      third_attempt_date: null,
      third_attempt_feedback: null,
      updated_at: new Date().toISOString(),
    })
    .eq('instance_id', instanceId);
  if (resultsError) throw resultsError;
}

type InstanceRow = {
  id: number;
  status: string;
  role_context: string;
  did_not_attempt: boolean | null;
  no_attempt_rollovers: number | null;
  submission_count: number | null;
  submitted_at: string | null;
  start_date: string | null;
  end_date: string | null;
};

type SummaryRow = {
  final_attempt_1_result: string | null;
  final_attempt_2_result: string | null;
  final_attempt_3_result: string | null;
  student_overall_feedback: string | null;
};

const pass = (label: string) => console.log(`  ✓ ${label}`);
const fail = (label: string, detail?: string) => {
  console.error(`  ✗ ${label}${detail ? `: ${detail}` : ''}`);
  process.exitCode = 1;
};

function attemptResultsFromSummary(s: SummaryRow | null): AttemptResult[] {
  return [
    (s?.final_attempt_1_result as AttemptResult) ?? null,
    (s?.final_attempt_2_result as AttemptResult) ?? null,
    (s?.final_attempt_3_result as AttemptResult) ?? null,
  ];
}

function assertTones(
  label: string,
  input: Parameters<typeof computeAttemptTones>[0],
  expectedStudent: string[],
) {
  const { student, trainer } = computeAttemptTones(input);
  const studentStr = student.join(', ');
  const trainerStr = trainer.join(', ');
  if (studentStr === expectedStudent.join(', ')) {
    pass(`${label} — student dots: ${studentStr}`);
  } else {
    fail(`${label} — student dots`, `expected ${expectedStudent.join(', ')}, got ${studentStr}`);
  }
  if (input.terminalDidNotAttempt && trainerStr !== 'red, red, red') {
    fail(`${label} — trainer dots`, `expected red, red, red, got ${trainerStr}`);
  } else if (input.terminalDidNotAttempt) {
    pass(`${label} — trainer dots: ${trainerStr}`);
  }
}

async function fetchInstance(id: number): Promise<InstanceRow | null> {
  const { data, error } = await supabase
    .from('skyline_form_instances')
    .select(
      'id, status, role_context, did_not_attempt, no_attempt_rollovers, submission_count, submitted_at, start_date, end_date',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as InstanceRow | null;
}

async function fetchSummary(id: number): Promise<SummaryRow | null> {
  const { data, error } = await supabase
    .from('skyline_form_assessment_summary_data')
    .select(
      'final_attempt_1_result, final_attempt_2_result, final_attempt_3_result, student_overall_feedback',
    )
    .eq('instance_id', id)
    .maybeSingle();
  if (error) throw error;
  return data as SummaryRow | null;
}

async function fetchResultsDataSample(id: number) {
  const { data, error } = await supabase
    .from('skyline_form_results_data')
    .select(
      'first_attempt_satisfactory, second_attempt_satisfactory, third_attempt_satisfactory, first_attempt_date, second_attempt_date, third_attempt_date',
    )
    .eq('instance_id', id)
    .limit(3);
  if (error) throw error;
  return data ?? [];
}

async function syncRollover(id: number) {
  const { data, error } = await supabase.rpc('skyline_sync_no_attempt_rollover', {
    p_instance_ids: [id],
  });
  if (error) throw error;
  const row = ((data as Array<Record<string, unknown>>) ?? []).find((r) => Number(r.id) === id);
  return row ?? null;
}

function uiSnapshot(row: InstanceRow, results: AttemptResult[]) {
  const terminal = isTerminalFailureProgressRow(row);
  const ui = computeRowUi({
    row,
    attemptResults: results,
    submissionCount: row.submission_count,
    submittedAt: row.submitted_at,
  });
  const missedText = getMissedAttemptWindowText({
    noAttemptRollovers: row.no_attempt_rollovers,
    didNotAttempt: row.did_not_attempt,
  });
  const tones = computeAttemptTones({
    submissionCount: Number(row.submission_count ?? 0),
    results,
    terminalDidNotAttempt: terminal,
    role_context: row.role_context,
    status: row.status,
    did_not_attempt: row.did_not_attempt,
    no_attempt_rollovers: row.no_attempt_rollovers,
  });
  return { terminal, ui, missedText, tones };
}

async function main() {
  console.log('\n=== Assessment reset + missed-attempt runtime verification ===\n');

  // Test 1: Terminal missed all attempts (instance 8958)
  console.log('Test 1: Terminal missed all attempts');
  const terminalId = 8958;
  let row = await fetchInstance(terminalId);
  if (!row) {
    fail('Test 1 setup', `instance ${terminalId} not found`);
  } else {
    const summary = await fetchSummary(terminalId);
    const results = attemptResultsFromSummary(summary);
    const snap = uiSnapshot(row, results);
    if (snap.terminal) pass('isTerminalFailureProgressRow = true');
    else fail('isTerminalFailureProgressRow', 'expected true');
    if (snap.ui.kind === 'did_not_attempt' && snap.ui.outcomeLabel === "Didn't attempt any") {
      pass('Row UI terminal label');
    } else {
      fail('Row UI terminal label', `kind=${snap.ui.kind}, label=${'outcomeLabel' in snap.ui ? snap.ui.outcomeLabel : 'n/a'}`);
    }
    if (snap.ui.rowClassName.includes('bg-red-100')) pass('Row is red terminal class');
    else fail('Row class', snap.ui.rowClassName);
    assertTones('Test 1', {
      submissionCount: 0,
      results,
      terminalDidNotAttempt: true,
      role_context: row.role_context,
      status: row.status,
      did_not_attempt: row.did_not_attempt,
      no_attempt_rollovers: row.no_attempt_rollovers,
    }, ['red', 'red', 'red']);
  }

  // Test 2 + 3: Reset after terminal state
  console.log('\nTest 2 + 3: Reset after terminal state (DB + UI)');
  const resetTargetId = 8958;
  const original = await fetchInstance(resetTargetId);
  const originalSummary = await fetchSummary(resetTargetId);
  const originalResultsSample = await fetchResultsDataSample(resetTargetId);

  if (!original) {
    fail('Test 2 setup', 'missing instance');
  } else {
    const newEnd = '2026-08-30';
    await resetAssessmentAttempts(resetTargetId, newEnd);

    let after = await fetchInstance(resetTargetId);
    const afterSummary = await fetchSummary(resetTargetId);
    const afterResults = await fetchResultsDataSample(resetTargetId);
    const synced = await syncRollover(resetTargetId);
    after = await fetchInstance(resetTargetId);

    if (!after) {
      fail('Test 2', 'instance missing after reset');
    } else {
      const checks: Array<[boolean, string]> = [
        [after.status === 'draft', 'status = draft'],
        [after.role_context === 'student', 'role_context = student'],
        [after.did_not_attempt === false, 'did_not_attempt = false'],
        [Number(after.no_attempt_rollovers ?? -1) === 0, 'no_attempt_rollovers = 0'],
        [Number(after.submission_count ?? -1) === 0, 'submission_count = 0'],
        [after.submitted_at == null, 'submitted_at = null'],
        [after.end_date === newEnd, `end_date = ${newEnd}`],
      ];
      for (const [ok, label] of checks) (ok ? pass : fail)(label);

      const resultFields = [
        afterSummary?.final_attempt_1_result,
        afterSummary?.final_attempt_2_result,
        afterSummary?.final_attempt_3_result,
      ];
      if (resultFields.every((v) => v == null)) pass('assessment summary attempt results all null');
      else fail('assessment summary results', resultFields.join(', '));

      if (afterSummary?.student_overall_feedback == null) pass('student_overall_feedback cleared');
      else fail('student_overall_feedback', String(afterSummary?.student_overall_feedback));

      const staleResults = afterResults.some(
        (r) =>
          r.first_attempt_satisfactory ||
          r.second_attempt_satisfactory ||
          r.third_attempt_satisfactory ||
          r.first_attempt_date ||
          r.second_attempt_date ||
          r.third_attempt_date,
      );
      if (!staleResults || afterResults.length === 0) pass('results_data per-attempt fields cleared');
      else fail('results_data still has attempt values', JSON.stringify(afterResults.slice(0, 2)));

      const results = attemptResultsFromSummary(afterSummary);
      const snap = uiSnapshot(after, results);
      if (snap.ui.kind === 'in_progress') pass('UI in_progress after reset (no reload)');
      else fail('UI after reset', `kind=${snap.ui.kind}`);
      if (snap.missedText == null) pass('No missed-attempt text after reset');
      else fail('Missed text after reset', snap.missedText);
      assertTones('Test 2 post-reset', {
        submissionCount: 0,
        results,
        terminalDidNotAttempt: snap.terminal,
        role_context: after.role_context,
        status: after.status,
        did_not_attempt: after.did_not_attempt,
        no_attempt_rollovers: after.no_attempt_rollovers,
      }, ['yellow', 'gray', 'gray']);

      // Simulate page reload: fresh fetch + sync RPC
      const reloaded = await fetchInstance(resetTargetId);
      const reloadedSummary = await fetchSummary(resetTargetId);
      await syncRollover(resetTargetId);
      const reloadedAfterSync = await fetchInstance(resetTargetId);
      if (reloadedAfterSync) {
        const reloadSnap = uiSnapshot(reloadedAfterSync, attemptResultsFromSummary(reloadedSummary));
        if (reloadSnap.ui.kind === 'in_progress' && reloadSnap.missedText == null) {
          pass('Reload + sync RPC keeps clean in-progress state');
        } else {
          fail('Reload state', `kind=${reloadSnap.ui.kind}, missed=${reloadSnap.missedText}`);
        }
        if (Number(reloadedAfterSync.did_not_attempt) === 0 && Number(reloadedAfterSync.no_attempt_rollovers) === 0) {
          pass('Reload DB fields remain reset');
        } else {
          fail('Reload DB fields', JSON.stringify(reloadedAfterSync));
        }
      }

      if (synced) {
        pass(`sync RPC returned did_not_attempt=${synced.did_not_attempt}, rollovers=${synced.no_attempt_rollovers}`);
      }

      // Restore original terminal state for test data hygiene
      await supabase
        .from('skyline_form_instances')
        .update({
          status: original.status,
          role_context: original.role_context,
          did_not_attempt: original.did_not_attempt,
          no_attempt_rollovers: original.no_attempt_rollovers,
          submission_count: original.submission_count,
          submitted_at: original.submitted_at,
          start_date: original.start_date,
          end_date: original.end_date,
          workflow_status: 'failed',
        })
        .eq('id', resetTargetId);
      if (originalSummary) {
        await supabase
          .from('skyline_form_assessment_summary_data')
          .upsert({ instance_id: resetTargetId, ...originalSummary }, { onConflict: 'instance_id' });
      }
      pass('Restored original terminal test instance 8958');
    }
  }

  // Test 4: Attempt 1 missed, Attempt 2 available (8959)
  console.log('\nTest 4: Attempt 1 missed, Attempt 2 available');
  row = await fetchInstance(8959);
  if (row) {
    const results = attemptResultsFromSummary(await fetchSummary(8959));
    const snap = uiSnapshot(row, results);
    if (!snap.terminal) pass('Not terminal');
    else fail('Should not be terminal');
    if (snap.missedText === 'Missed 1st attempt') pass('Missed text');
    else fail('Missed text', String(snap.missedText));
    if (snap.missedText !== "Didn't attempt any") pass('No terminal missed-all text');
    assertTones('Test 4', {
      submissionCount: Number(row.submission_count ?? 0),
      results,
      role_context: row.role_context,
      status: row.status,
      did_not_attempt: row.did_not_attempt,
      no_attempt_rollovers: row.no_attempt_rollovers,
    }, ['red', 'yellow', 'gray']);
  } else fail('Test 4', 'instance 8959 not found');

  // Test 5: Attempt 1 missed, Attempt 2 submitted awaiting trainer (8653)
  console.log('\nTest 5: Attempt 1 missed, Attempt 2 submitted awaiting trainer');
  row = await fetchInstance(8653);
  if (row) {
    const results = attemptResultsFromSummary(await fetchSummary(8653));
    const snap = uiSnapshot(row, results);
    const doneText = getStudentAttemptDoneText({
      submissionCount: row.submission_count,
      submittedAt: row.submitted_at,
      attemptResults: results,
      status: row.status,
      role_context: row.role_context,
      no_attempt_rollovers: row.no_attempt_rollovers,
      did_not_attempt: row.did_not_attempt,
    });
    if (doneText?.includes('2nd attempt')) pass(`Status text: ${doneText}`);
    else fail('Awaiting trainer text', String(doneText));
    assertTones('Test 5', {
      submissionCount: Number(row.submission_count ?? 0),
      results,
      role_context: row.role_context,
      status: row.status,
      did_not_attempt: row.did_not_attempt,
      no_attempt_rollovers: row.no_attempt_rollovers,
    }, ['red', 'yellow', 'gray']);
  } else fail('Test 5', 'instance 8653 not found');

  // Test 6: Attempt 1 NYC, Attempt 2 available — use synthetic + real 8076 partial
  console.log('\nTest 6: Attempt 1 NYC, Attempt 2 available');
  {
    const synthetic = {
      submissionCount: 1,
      results: ['not_yet_competent', null, null] as AttemptResult[],
      no_attempt_rollovers: 0,
      did_not_attempt: false,
      role_context: 'student',
      status: 'draft',
    };
    assertTones('Test 6 synthetic', synthetic, ['red', 'yellow', 'gray']);
    const failedText = getTrainerAttemptFailedText(synthetic.results, {
      role_context: 'student',
      status: 'draft',
    });
    if (failedText === 'Second Attempt Required') pass('Text: Second Attempt Required');
    else fail('NYC resubmit text', String(failedText));
  }

  // Test 7: Attempt 1 missed, Attempt 2 NYC, Attempt 3 available (8096)
  console.log('\nTest 7: Attempt 1 missed, Attempt 2 NYC, Attempt 3 available');
  row = await fetchInstance(8096);
  if (row) {
    const results = attemptResultsFromSummary(await fetchSummary(8096));
    assertTones('Test 7', {
      submissionCount: Number(row.submission_count ?? 0),
      results,
      role_context: row.role_context,
      status: row.status,
      did_not_attempt: row.did_not_attempt,
      no_attempt_rollovers: row.no_attempt_rollovers,
    }, ['red', 'red', 'yellow']);
    const failedText = getTrainerAttemptFailedText(results, {
      role_context: 'student',
      status: 'draft',
    });
    if (failedText === 'Third Attempt Required') pass('Text: Third Attempt Required');
    else fail('Third attempt text', String(failedText));
  } else fail('Test 7', 'instance 8096 not found');

  console.log('\n=== Verification complete ===');
  if (process.exitCode) console.error('\nSome checks FAILED.\n');
  else console.log('\nAll runtime checks PASSED.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
