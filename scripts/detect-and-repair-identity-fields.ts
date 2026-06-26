/**
 * Detect and repair missing first-page identity fields on submitted/attempted instances.
 *
 * Usage:
 *   npx tsx scripts/detect-and-repair-identity-fields.ts --dry-run
 *   npx tsx scripts/detect-and-repair-identity-fields.ts --apply
 *   npx tsx scripts/detect-and-repair-identity-fields.ts --dry-run --ids=8741,8744
 *
 * Requires VITE_SUPABASE_URL/SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import {
  buildIdentityBackfillPlan,
  buildIdentitySourceValues,
  detectAffectedIdentityInstance,
  IDENTITY_FIELD_CODES,
  type IdentityFieldCode,
  type IdentityQuestionRef,
} from '../src/utils/identityFieldRepair';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const idsFlagIndex = process.argv.indexOf('--ids');
const idsArg =
  idsFlagIndex >= 0
    ? String(process.argv[idsFlagIndex + 1] ?? '')
    : process.argv.find((a) => a.startsWith('--ids='))?.slice('--ids='.length) ?? '';
const filterIds = idsArg
  ? idsArg
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
  : null;

type InstanceRow = {
  id: number;
  form_id: number;
  student_id: number | null;
  submission_count: number | null;
  submitted_at: string | null;
  status: string | null;
  role_context: string | null;
};

async function fetchAttemptedInstances(): Promise<InstanceRow[]> {
  if (filterIds?.length) {
    const { data, error } = await supabase
      .from('skyline_form_instances')
      .select('id, form_id, student_id, submission_count, submitted_at, status, role_context')
      .in('id', filterIds);
    if (error) throw error;
    return (data as InstanceRow[]) ?? [];
  }

  const out: InstanceRow[] = [];
  const pageSize = 200;
  let from = 0;

  while (true) {
    let query = supabase
      .from('skyline_form_instances')
      .select('id, form_id, student_id, submission_count, submitted_at, status, role_context')
      .not('student_id', 'is', null)
      .or('submission_count.gt.0,submitted_at.not.is.null')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data as InstanceRow[]) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

async function fetchIdentityQuestionsForForm(formId: number): Promise<IdentityQuestionRef[]> {
  const { data: steps, error: stepsErr } = await supabase.from('skyline_form_steps').select('id').eq('form_id', formId);
  if (stepsErr) throw stepsErr;
  const stepIds = ((steps as Array<{ id: number }> | null) ?? []).map((s) => s.id);
  if (stepIds.length === 0) return [];

  const { data: sections, error: secErr } = await supabase.from('skyline_form_sections').select('id').in('step_id', stepIds);
  if (secErr) throw secErr;
  const sectionIds = ((sections as Array<{ id: number }> | null) ?? []).map((s) => s.id);
  if (sectionIds.length === 0) return [];

  const { data: questions, error: qErr } = await supabase
    .from('skyline_form_questions')
    .select('id, code')
    .in('section_id', sectionIds)
    .in('code', [...IDENTITY_FIELD_CODES]);
  if (qErr) throw qErr;

  return ((questions as Array<{ id: number; code: string }> | null) ?? [])
    .filter((q) => IDENTITY_FIELD_CODES.includes(q.code as IdentityFieldCode))
    .map((q) => ({ questionId: q.id, code: q.code as IdentityFieldCode }));
}

async function analyzeInstance(row: InstanceRow) {
  const [answersRes, resultsRes, studentRes, identityQuestions] = await Promise.all([
    supabase
      .from('skyline_form_answers')
      .select('question_id, value_text, value_json, row_id')
      .eq('instance_id', row.id),
    supabase
      .from('skyline_form_results_data')
      .select('student_name, trainer_name, student_signature')
      .eq('instance_id', row.id)
      .limit(10),
    row.student_id
      ? supabase
          .from('skyline_students')
          .select('name, first_name, last_name, email, student_id, batch_id')
          .eq('id', row.student_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    fetchIdentityQuestionsForForm(row.form_id),
  ]);

  if (answersRes.error) throw answersRes.error;
  if (resultsRes.error) throw resultsRes.error;
  if (studentRes.error) throw studentRes.error;

  const answers = answersRes.data ?? [];
  const results = resultsRes.data ?? [];
  const student = studentRes.data as {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    student_id?: string | null;
    batch_id?: number | null;
  } | null;

  let trainerName: string | null = null;
  const batchId = Number(student?.batch_id ?? 0);
  if (Number.isFinite(batchId) && batchId > 0) {
    const { data: batch } = await supabase.from('skyline_batches').select('trainer_id').eq('id', batchId).maybeSingle();
    const trainerId = Number((batch as { trainer_id?: number | null } | null)?.trainer_id ?? 0);
    if (Number.isFinite(trainerId) && trainerId > 0) {
      const { data: trainer } = await supabase.from('skyline_users').select('full_name').eq('id', trainerId).maybeSingle();
      trainerName = String((trainer as { full_name?: string | null } | null)?.full_name ?? '').trim() || null;
    }
  }

  const identityQuestionIds = new Set(identityQuestions.map((q) => q.questionId));
  const identityValues: Partial<Record<IdentityFieldCode, string | null>> = {};
  for (const code of IDENTITY_FIELD_CODES) identityValues[code] = null;
  for (const q of identityQuestions) {
    const ans = answers.find((a) => a.question_id === q.questionId && a.row_id == null);
    identityValues[q.code] = String((ans as { value_text?: string | null } | undefined)?.value_text ?? '').trim() || null;
  }

  const hasStudentSignature = results.some((r) => String((r as { student_signature?: string | null }).student_signature ?? '').trim());
  const hasQuestionAnswers = answers.some(
    (a) =>
      !identityQuestionIds.has((a as { question_id: number }).question_id) &&
      (String((a as { value_text?: string | null }).value_text ?? '').trim() ||
        (a as { value_json?: unknown }).value_json != null),
  );

  const hasAttemptEvidence =
    Number(row.submission_count ?? 0) > 0 ||
    Boolean(String(row.submitted_at ?? '').trim()) ||
    hasStudentSignature ||
    hasQuestionAnswers;

  if (!hasAttemptEvidence) return null;

  const profileName = String(student?.name ?? '').trim() || null;
  const profileEmail = String(student?.email ?? '').trim() || null;
  const profileStudentCode = String(student?.student_id ?? '').trim() || null;

  const affected = detectAffectedIdentityInstance({
    instanceId: row.id,
    studentId: row.student_id,
    formId: row.form_id,
    profileName,
    profileEmail,
    profileStudentCode,
    trainerName,
    submissionCount: row.submission_count,
    submittedAt: row.submitted_at,
    status: row.status,
    roleContext: row.role_context,
    hasStudentSignature,
    hasQuestionAnswers,
    identityValues,
  });

  if (!affected) return null;

  const sources = buildIdentitySourceValues({
    profileName: student?.name,
    profileFirstName: student?.first_name,
    profileLastName: student?.last_name,
    profileEmail: student?.email,
    profileStudentCode: student?.student_id,
    trainerName,
    resultsStudentName:
      results.map((r) => String((r as { student_name?: string | null }).student_name ?? '').trim()).find(Boolean) ?? null,
    resultsTrainerName:
      results.map((r) => String((r as { trainer_name?: string | null }).trainer_name ?? '').trim()).find(Boolean) ?? null,
  });

  const plan = buildIdentityBackfillPlan({
    instanceId: row.id,
    questions: identityQuestions,
    currentValues: identityValues,
    sources,
  });

  return { affected, plan, identityQuestions };
}

async function applyPlan(plan: NonNullable<Awaited<ReturnType<typeof analyzeInstance>>['plan']>) {
  for (const update of plan.updates) {
    const { data: existing } = await supabase
      .from('skyline_form_answers')
      .select('id, value_text')
      .eq('instance_id', plan.instanceId)
      .eq('question_id', update.questionId)
      .is('row_id', null)
      .maybeSingle();

    const current = String((existing as { value_text?: string | null } | null)?.value_text ?? '').trim();
    if (current) continue;

    if (existing) {
      const { error } = await supabase
        .from('skyline_form_answers')
        .update({ value_text: update.value, updated_at: new Date().toISOString() })
        .eq('id', (existing as { id: number }).id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('skyline_form_answers').insert({
        instance_id: plan.instanceId,
        question_id: update.questionId,
        row_id: null,
        value_text: update.value,
        value_number: null,
        value_json: null,
      });
      if (error) throw error;
    }
  }
}

async function main() {
  console.log(`\n=== Identity field detect/repair (${dryRun ? 'DRY RUN' : 'APPLY'}) ===\n`);
  if (filterIds?.length) console.log(`Filtered to instance IDs: ${filterIds.join(', ')}`);

  const instances = await fetchAttemptedInstances();
  console.log(`Scanning ${instances.length} instance(s)...`);

  const affectedRows: Array<NonNullable<Awaited<ReturnType<typeof analyzeInstance>>>> = [];

  for (const row of instances) {
    const result = await analyzeInstance(row);
    if (result) affectedRows.push(result);
  }

  if (affectedRows.length === 0) {
    console.log('\nNo affected instances found.\n');
    return;
  }

  console.log(`\nFound ${affectedRows.length} affected instance(s):\n`);
  for (const { affected, plan } of affectedRows) {
    console.log(
      JSON.stringify(
        {
          instance_id: affected.instanceId,
          student_id: affected.studentId,
          profile_name: affected.profileName,
          profile_email: affected.profileEmail,
          profile_student_code: affected.profileStudentCode,
          trainer_name: affected.trainerName,
          submission_count: affected.submissionCount,
          submitted_at: affected.submittedAt,
          status: affected.status,
          role_context: affected.roleContext,
          has_student_signature: affected.hasStudentSignature,
          has_question_answers: affected.hasQuestionAnswers,
          missing_fields: affected.missingFields,
          planned_updates: plan?.updates ?? [],
        },
        null,
        2,
      ),
    );
  }

  if (dryRun) {
    console.log('\nDry run complete — no changes applied. Re-run with --apply to backfill.\n');
    return;
  }

  let repaired = 0;
  for (const { plan } of affectedRows) {
    if (!plan) continue;
    await applyPlan(plan);
    repaired += 1;
  }

  console.log(`\nApplied backfill to ${repaired} instance(s).\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
