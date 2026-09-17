import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const migration = readFileSync(
  resolve(
    root,
    'supabase/migrations/20260917123000_assessment_submission_workflow_hardening.sql',
  ),
  'utf8',
);
const formEngine = readFileSync(resolve(root, 'src/lib/formEngine.ts'), 'utf8');
const studentAccess = readFileSync(
  resolve(root, 'src/lib/studentAssessmentAccess.ts'),
  'utf8',
);

describe('assessment workflow hardening migration', () => {
  it('classifies saved answers without a final submission as incomplete', () => {
    expect(migration).toContain("status = 'incomplete'");
    expect(migration).toContain("workflow_status = 'awaiting_submission'");
    expect(migration).toMatch(
      /submission_count,\s*0\)\s*=\s*0[\s\S]*EXISTS\s*\([\s\S]*skyline_form_answers/,
    );
  });

  it('keeps untouched expired instances on the did-not-attempt path', () => {
    expect(migration).toMatch(
      /did_not_attempt\s*=\s*true[\s\S]*submission_count,\s*0\)\s*=\s*0[\s\S]*NOT EXISTS\s*\([\s\S]*skyline_form_answers/,
    );
  });

  it('repairs legacy did-not-attempt records that have a competent trainer result', () => {
    expect(migration).toMatch(
      /Repair legacy contradictions[\s\S]*did_not_attempt\s*=\s*false[\s\S]*role_context\s*=\s*'office'[\s\S]*workflow_status\s*=\s*CASE[\s\S]*'completed'[\s\S]*'waiting_office'/,
    );
    expect(migration).toMatch(
      /COALESCE\(i\.did_not_attempt,\s*false\)[\s\S]*'competent'\s+IN\s*\([\s\S]*final_attempt_1_result[\s\S]*final_attempt_2_result[\s\S]*final_attempt_3_result/,
    );
  });

  it('repairs legacy did-not-attempt records that contain saved answers', () => {
    expect(migration).toMatch(
      /Repair legacy terminal rows that contain saved student work[\s\S]*did_not_attempt\s*=\s*false[\s\S]*status\s*=\s*'incomplete'[\s\S]*workflow_status\s*=\s*'awaiting_submission'[\s\S]*submission_count,\s*0\)\s*=\s*0[\s\S]*skyline_form_answers/,
    );
  });

  it('schedules rollover instead of mutating dashboard and link reads', () => {
    expect(migration).toContain("'skyline-assessment-no-attempt-rollover'");
    expect(migration).toContain('skyline_run_scheduled_no_attempt_rollover');
    expect(formEngine).not.toContain("supabase.rpc('skyline_sync_no_attempt_rollover'");
  });

  it('serializes submit against rollover and records an idempotency request', () => {
    expect(migration).toMatch(
      /skyline_submit_instance_to_trainer[\s\S]*request_id[\s\S]*FOR UPDATE/,
    );
    expect(migration).toContain('skyline_submission_events');
    expect(migration).toContain('UNIQUE (instance_id, request_id)');
  });

  it('does not increment a submission already waiting with the trainer', () => {
    expect(migration).toMatch(
      /submission_count,\s*0\)\s*>\s*0[\s\S]*status\s*=\s*'submitted'[\s\S]*final_submit_duplicate/,
    );
  });

  it('rejects student mutations after terminal workflow state', () => {
    expect(studentAccess).toMatch(
      /role === 'student'[\s\S]*status === 'locked'[\s\S]*wf === 'failed'[\s\S]*StudentCourseAccessError/,
    );
  });
});
