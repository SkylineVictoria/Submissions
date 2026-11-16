-- Assessment stage: single source of truth for "which attempt / which stage".
--
-- Hotfix for the admin Progress column + Admin check queue:
--   Bug 1: rows reached the office stage (role_context = 'office' / waiting_office) with NO trainer
--          outcome recorded for the attempt under review, so the Admin dot lit up and the row sat in
--          the Admin check queue while the trainer had only partially marked it.
--   Bug 2: the attempt index was read from submission_count (and shifted by missed-window rollovers),
--          so a completed trainer review recorded in summary column 1 was displayed as an unmarked
--          attempt 2/3 ("Not Checked") and the trainer could not even submit the review.
--
-- Rule (mirrors src/utils/assessmentWorkflowState.ts — keep both in sync):
--   * attempt n = n-th student hand-in = summary column final_attempt_n_result;
--   * only a Not Yet Competent outcome opens the next attempt, so submission_count is capped by the
--     NYC chain (a stray extra hand-in never moves the trainer to a column they have not reached);
--   * trainer review is complete when an outcome exists for the current attempt;
--   * the office stage (Admin pending / Admin check queue) is only reachable when that outcome exists;
--     the trainer's final submit is the only thing that moves a row to office.
--
-- Idempotent: every step is guarded; re-running changes nothing once applied.
-- No columns/tables are dropped; no marks, comments, files or attempts are deleted.

-- ---------------------------------------------------------------------------
-- 1. Rule functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.skyline_assessment_normalize_outcome(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_value, '')))
    WHEN 'competent' THEN 'competent'
    WHEN 'not_yet_competent' THEN 'not_yet_competent'
    WHEN 'not_competent' THEN 'not_yet_competent'
    WHEN 'not competent' THEN 'not_yet_competent'
    ELSE NULL
  END
$$;

-- Attempt the workflow is on (1..3). With the student: the attempt after the NYC chain. With
-- trainer / office / locked: the latest hand-in the NYC chain has opened.
CREATE OR REPLACE FUNCTION public.skyline_assessment_current_attempt(
  p_r1 text,
  p_r2 text,
  p_r3 text,
  p_submission_count integer,
  p_submitted_at timestamptz,
  p_status text,
  p_role_context text
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_r1 text := public.skyline_assessment_normalize_outcome(p_r1);
  v_r2 text := public.skyline_assessment_normalize_outcome(p_r2);
  v_r3 text := public.skyline_assessment_normalize_outcome(p_r3);
  v_leading_nyc integer := 0;
  v_opened integer;
  v_raw integer;
  v_handed integer;
BEGIN
  IF v_r1 = 'not_yet_competent' THEN
    v_leading_nyc := 1;
    IF v_r2 = 'not_yet_competent' THEN
      v_leading_nyc := 2;
      IF v_r3 = 'not_yet_competent' THEN
        v_leading_nyc := 3;
      END IF;
    END IF;
  END IF;
  v_opened := LEAST(3, v_leading_nyc + 1);

  v_raw := LEAST(3, GREATEST(0, COALESCE(p_submission_count, 0)));
  IF v_raw = 0 AND p_submitted_at IS NOT NULL THEN
    v_raw := 1;
  END IF;

  IF COALESCE(p_status, '') = 'locked' OR COALESCE(p_role_context, '') IN ('trainer', 'office') THEN
    v_handed := GREATEST(1, LEAST(3, v_raw));
    RETURN GREATEST(1, LEAST(v_opened, v_handed));
  END IF;
  RETURN v_opened;
END;
$$;

-- Outcome recorded for the current attempt (NULL = trainer review not complete).
CREATE OR REPLACE FUNCTION public.skyline_assessment_trainer_outcome(
  p_r1 text,
  p_r2 text,
  p_r3 text,
  p_submission_count integer,
  p_submitted_at timestamptz,
  p_status text,
  p_role_context text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE public.skyline_assessment_current_attempt(p_r1, p_r2, p_r3, p_submission_count, p_submitted_at, p_status, p_role_context)
    WHEN 1 THEN public.skyline_assessment_normalize_outcome(p_r1)
    WHEN 2 THEN public.skyline_assessment_normalize_outcome(p_r2)
    ELSE public.skyline_assessment_normalize_outcome(p_r3)
  END
$$;

-- Convenience: review complete for a stored instance (summary joined by instance id).
CREATE OR REPLACE FUNCTION public.skyline_assessment_trainer_review_complete(p_instance_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT public.skyline_assessment_trainer_outcome(
      sm.final_attempt_1_result,
      sm.final_attempt_2_result,
      sm.final_attempt_3_result,
      i.submission_count,
      i.submitted_at,
      i.status,
      i.role_context
    ) IS NOT NULL
    FROM public.skyline_form_instances i
    LEFT JOIN public.skyline_form_assessment_summary_data sm ON sm.instance_id = i.id
    WHERE i.id = p_instance_id
  ), false)
$$;

-- Forms that carry a result sheet / assessment summary require a recorded outcome before office.
CREATE OR REPLACE FUNCTION public.skyline_assessment_requires_trainer_outcome(p_form_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.skyline_form_sections sec
    JOIN public.skyline_form_steps st ON st.id = sec.step_id
    WHERE st.form_id = p_form_id
      AND sec.pdf_render_mode IN ('task_results', 'assessment_summary')
  )
$$;

-- Queue predicates used by every admin queue RPC.
CREATE OR REPLACE FUNCTION public.skyline_assessment_is_awaiting_office(
  p_role_context text,
  p_status text,
  p_did_not_attempt boolean,
  p_instance_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p_role_context, '') = 'office'
     AND COALESCE(p_status, '') <> 'locked'
     AND NOT COALESCE(p_did_not_attempt, false)
     AND public.skyline_assessment_trainer_review_complete(p_instance_id)
$$;

CREATE OR REPLACE FUNCTION public.skyline_assessment_is_awaiting_trainer(
  p_role_context text,
  p_status text,
  p_did_not_attempt boolean,
  p_instance_id bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT (COALESCE(p_role_context, '') = 'trainer' AND COALESCE(p_status, '') <> 'locked')
      OR (
        COALESCE(p_role_context, '') = 'office'
        AND COALESCE(p_status, '') <> 'locked'
        AND NOT COALESCE(p_did_not_attempt, false)
        AND NOT public.skyline_assessment_trainer_review_complete(p_instance_id)
      )
$$;

-- Full stage resolution for one instance (debug / verification / future consumers).
CREATE OR REPLACE FUNCTION public.skyline_assessment_stage(p_instance_id bigint)
RETURNS TABLE (
  instance_id bigint,
  current_attempt integer,
  submitted_attempts integer,
  trainer_outcome text,
  handoff_stage text,
  student_stage text,
  trainer_stage text,
  admin_stage text,
  admin_queue_eligible boolean
)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT
      i.id,
      i.status,
      i.role_context,
      i.workflow_status,
      COALESCE(i.did_not_attempt, false) AS did_not_attempt,
      LEAST(3, GREATEST(0, COALESCE(i.submission_count, 0), CASE WHEN i.submitted_at IS NOT NULL THEN 1 ELSE 0 END)) AS raw_submitted,
      public.skyline_assessment_current_attempt(
        sm.final_attempt_1_result, sm.final_attempt_2_result, sm.final_attempt_3_result,
        i.submission_count, i.submitted_at, i.status, i.role_context
      ) AS current_attempt,
      public.skyline_assessment_trainer_outcome(
        sm.final_attempt_1_result, sm.final_attempt_2_result, sm.final_attempt_3_result,
        i.submission_count, i.submitted_at, i.status, i.role_context
      ) AS trainer_outcome,
      public.skyline_assessment_normalize_outcome(sm.final_attempt_1_result) AS r1,
      CASE
        WHEN i.status = 'locked' THEN 'locked'
        WHEN i.role_context = 'office' THEN 'office'
        WHEN i.role_context = 'trainer' THEN 'trainer'
        ELSE 'student'
      END AS handoff_stage,
      (
        i.workflow_status = 'completed'
        OR (i.status = 'locked' AND i.role_context = 'office'
            AND public.skyline_assessment_trainer_outcome(
              sm.final_attempt_1_result, sm.final_attempt_2_result, sm.final_attempt_3_result,
              i.submission_count, i.submitted_at, i.status, i.role_context) = 'competent')
      ) AS office_completed
    FROM public.skyline_form_instances i
    LEFT JOIN public.skyline_form_assessment_summary_data sm ON sm.instance_id = i.id
    WHERE i.id = p_instance_id
  ),
  derived AS (
    SELECT
      b.*,
      LEAST(b.raw_submitted, b.current_attempt) AS submitted_attempts,
      (LEAST(b.raw_submitted, b.current_attempt) >= b.current_attempt) AS student_submitted_current,
      (b.trainer_outcome IS NOT NULL) AS trainer_review_complete,
      (b.handoff_stage IN ('office', 'locked')) AS trainer_handed_off,
      (b.handoff_stage = 'student' AND b.r1 = 'not_yet_competent' AND b.current_attempt <= 3
        AND LEAST(b.raw_submitted, b.current_attempt) < b.current_attempt) AS resubmission_required
    FROM base b
  )
  SELECT
    d.id,
    d.current_attempt,
    d.submitted_attempts,
    d.trainer_outcome,
    d.handoff_stage,
    CASE WHEN d.office_completed OR d.student_submitted_current THEN 'done'
         WHEN d.resubmission_required THEN 'pending'
         ELSE 'idle' END AS student_stage,
    CASE WHEN d.office_completed OR d.trainer_review_complete OR d.trainer_handed_off THEN 'done'
         WHEN (d.handoff_stage = 'trainer' AND d.submitted_attempts > 0)
           OR (d.handoff_stage = 'student' AND d.status = 'draft' AND d.submitted_attempts > 0 AND d.student_submitted_current) THEN 'pending'
         ELSE 'idle' END AS trainer_stage,
    CASE WHEN d.office_completed THEN 'done'
         WHEN d.handoff_stage = 'office' AND d.trainer_review_complete AND NOT d.did_not_attempt THEN 'pending'
         ELSE 'idle' END AS admin_stage,
    (NOT d.office_completed AND d.handoff_stage = 'office' AND d.trainer_review_complete AND NOT d.did_not_attempt) AS admin_queue_eligible
  FROM derived d
$$;

-- ---------------------------------------------------------------------------
-- 2. Guard: a row can only ENTER the office stage with a trainer outcome for the current attempt.
--    Partial trainer saves never touch skyline_form_instances; only the trainer's final submit
--    (updateInstanceWorkflowStatus → waiting_office) does, and it is rejected here when the
--    review is incomplete. Admin "hand off to office" paths go through the same gate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.skyline_guard_office_handoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_office boolean;
  v_now_office boolean;
  v_outcome text;
  v_attempt integer;
BEGIN
  v_was_office := (COALESCE(OLD.role_context, '') = 'office' OR COALESCE(OLD.workflow_status, '') = 'waiting_office')
    AND COALESCE(OLD.status, '') <> 'locked';
  v_now_office := (COALESCE(NEW.role_context, '') = 'office' OR COALESCE(NEW.workflow_status, '') = 'waiting_office')
    AND COALESCE(NEW.status, '') <> 'locked'
    AND NOT COALESCE(NEW.did_not_attempt, false);

  IF v_now_office AND NOT v_was_office AND public.skyline_assessment_requires_trainer_outcome(NEW.form_id) THEN
    SELECT
      public.skyline_assessment_trainer_outcome(
        sm.final_attempt_1_result, sm.final_attempt_2_result, sm.final_attempt_3_result,
        NEW.submission_count, NEW.submitted_at, 'submitted', 'trainer'),
      public.skyline_assessment_current_attempt(
        sm.final_attempt_1_result, sm.final_attempt_2_result, sm.final_attempt_3_result,
        NEW.submission_count, NEW.submitted_at, 'submitted', 'trainer')
    INTO v_outcome, v_attempt
    FROM public.skyline_form_assessment_summary_data sm
    WHERE sm.instance_id = NEW.id;

    IF v_outcome IS NULL THEN
      RAISE EXCEPTION 'Trainer review is not complete for attempt %: record Competent / Not Yet Competent on the Assessment Summary Sheet before sending this assessment to office.',
        COALESCE(v_attempt, 1)
        USING ERRCODE = 'check_violation',
              HINT = 'trainer_review_incomplete';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skyline_guard_office_handoff ON public.skyline_form_instances;
CREATE TRIGGER skyline_guard_office_handoff
  BEFORE UPDATE OF status, role_context, workflow_status ON public.skyline_form_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_guard_office_handoff();

-- ---------------------------------------------------------------------------
-- 3. Backup + repair log tables (created once; rows appended only for instances we modify).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.skyline_form_instances_status_backup_20261116 (
  LIKE public.skyline_form_instances,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  repair_reason text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.skyline_form_instances_status_repair_log_20261116 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id bigint NOT NULL,
  student_ext_id text,
  student_name text,
  form_name text,
  reason text NOT NULL,
  before_status text,
  before_role_context text,
  before_workflow_status text,
  after_status text,
  after_role_context text,
  after_workflow_status text,
  repaired_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Data repair (idempotent): recompute the stage for every non-terminal row.
--    A. office stage without a trainer outcome for the current attempt → back to the trainer queue
--       (or back to the student when nothing was ever handed in).
--    B. trainer stage with a stale workflow_status → waiting_trainer.
--    C. office stage (outcome present) with a stale workflow_status → waiting_office.
--    Locked rows are never touched.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_changed integer := 0;
BEGIN
  CREATE TEMP TABLE tmp_stage_repair ON COMMIT DROP AS
  WITH target AS (
    SELECT
      i.id,
      i.status,
      i.role_context,
      i.workflow_status,
      COALESCE(i.did_not_attempt, false) AS did_not_attempt,
      (COALESCE(i.submission_count, 0) > 0 OR i.submitted_at IS NOT NULL) AS has_handin,
      public.skyline_assessment_trainer_outcome(
        sm.final_attempt_1_result, sm.final_attempt_2_result, sm.final_attempt_3_result,
        i.submission_count, i.submitted_at, i.status, i.role_context
      ) AS outcome
    FROM public.skyline_form_instances i
    LEFT JOIN public.skyline_form_assessment_summary_data sm ON sm.instance_id = i.id
    WHERE COALESCE(i.status, '') <> 'locked'
  ),
  planned AS (
    SELECT
      t.id,
      t.status AS before_status,
      t.role_context AS before_role_context,
      t.workflow_status AS before_workflow_status,
      CASE
        WHEN t.role_context = 'office' AND NOT t.did_not_attempt AND t.outcome IS NULL THEN
          CASE WHEN t.has_handin THEN 'office_without_trainer_outcome_to_trainer' ELSE 'office_without_handin_to_student' END
        WHEN t.role_context = 'trainer' AND t.workflow_status IS DISTINCT FROM 'waiting_trainer' THEN 'trainer_stage_workflow_normalized'
        WHEN t.role_context = 'office' AND NOT t.did_not_attempt AND t.outcome IS NOT NULL AND t.workflow_status IS DISTINCT FROM 'waiting_office' THEN 'office_stage_workflow_normalized'
        ELSE NULL
      END AS reason,
      CASE
        WHEN t.role_context = 'office' AND NOT t.did_not_attempt AND t.outcome IS NULL THEN
          CASE WHEN t.has_handin THEN 'submitted' ELSE 'draft' END
        ELSE t.status
      END AS after_status,
      CASE
        WHEN t.role_context = 'office' AND NOT t.did_not_attempt AND t.outcome IS NULL THEN
          CASE WHEN t.has_handin THEN 'trainer' ELSE 'student' END
        ELSE t.role_context
      END AS after_role_context,
      CASE
        WHEN t.role_context = 'office' AND NOT t.did_not_attempt AND t.outcome IS NULL THEN
          CASE WHEN t.has_handin THEN 'waiting_trainer' ELSE 'draft' END
        WHEN t.role_context = 'trainer' THEN 'waiting_trainer'
        WHEN t.role_context = 'office' AND NOT t.did_not_attempt THEN 'waiting_office'
        ELSE t.workflow_status
      END AS after_workflow_status
    FROM target t
  )
  SELECT * FROM planned p WHERE p.reason IS NOT NULL;

  -- Backup full rows once per instance + reason.
  INSERT INTO public.skyline_form_instances_status_backup_20261116
  SELECT i.*, now(), r.reason
  FROM public.skyline_form_instances i
  JOIN tmp_stage_repair r ON r.id = i.id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.skyline_form_instances_status_backup_20261116 b
    WHERE b.id = i.id AND b.repair_reason = r.reason
  );

  INSERT INTO public.skyline_form_instances_status_repair_log_20261116 (
    instance_id, student_ext_id, student_name, form_name, reason,
    before_status, before_role_context, before_workflow_status,
    after_status, after_role_context, after_workflow_status
  )
  SELECT
    r.id,
    s.student_id,
    NULLIF(trim(concat_ws(' ', NULLIF(s.first_name, ''), NULLIF(s.last_name, ''))), ''),
    f.name,
    r.reason,
    r.before_status, r.before_role_context, r.before_workflow_status,
    r.after_status, r.after_role_context, r.after_workflow_status
  FROM tmp_stage_repair r
  JOIN public.skyline_form_instances i ON i.id = r.id
  LEFT JOIN public.skyline_students s ON s.id = i.student_id
  LEFT JOIN public.skyline_forms f ON f.id = i.form_id;

  UPDATE public.skyline_form_instances i
  SET
    status = r.after_status,
    role_context = r.after_role_context,
    workflow_status = r.after_workflow_status,
    updated_at = now()
  FROM tmp_stage_repair r
  WHERE i.id = r.id;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RAISE NOTICE 'assessment stage repair: % instance row(s) corrected', v_changed;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Verification helpers (read-only): rows still violating the rule must be zero.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.skyline_assessment_stage_violations AS
SELECT i.id, i.student_id, i.form_id, i.status, i.role_context, i.workflow_status, i.submission_count
FROM public.skyline_form_instances i
WHERE COALESCE(i.status, '') <> 'locked'
  AND i.role_context = 'office'
  AND NOT COALESCE(i.did_not_attempt, false)
  AND NOT public.skyline_assessment_trainer_review_complete(i.id);

-- ---------------------------------------------------------------------------
-- 6. Queue RPCs: awaiting_trainer / awaiting_office come from the shared rule.
--    Bodies copied verbatim from 20261105000002_extension_deadline_functions.sql; only the
--    two workflow predicates changed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.skyline_list_submitted_instances_paged(p_page integer DEFAULT 1, p_page_size integer DEFAULT 20, p_search text DEFAULT NULL::text, p_course_id bigint DEFAULT NULL::bigint, p_form_id bigint DEFAULT NULL::bigint, p_student_id bigint DEFAULT NULL::bigint, p_active_on date DEFAULT NULL::date, p_workflow_status text DEFAULT NULL::text, p_start_from date DEFAULT NULL::date, p_end_date_to date DEFAULT NULL::date, p_sort_key text DEFAULT 'created'::text, p_sort_dir text DEFAULT 'desc'::text, p_batch_id bigint DEFAULT NULL::bigint, p_search_student_ext_id text DEFAULT NULL::text, p_search_unit_code text DEFAULT NULL::text)
 RETURNS TABLE(id bigint, form_id bigint, form_name text, form_version text, student_id bigint, student_name text, student_email text, status text, role_context text, created_at timestamp with time zone, submitted_at timestamp with time zone, submission_count integer, start_date date, end_date date, total_count bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_from integer := GREATEST(0, (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20));
  v_limit integer := GREATEST(1, COALESCE(p_page_size, 20));
  v_dir text := CASE WHEN lower(COALESCE(p_sort_dir, 'desc')) = 'asc' THEN 'asc' ELSE 'desc' END;
  v_key text := lower(COALESCE(p_sort_key, 'created'));
  v_sql text;
  v_raw text := NULLIF(trim(COALESCE(p_search, '')), '');
  v_ext_id text := NULLIF(trim(COALESCE(p_search_student_ext_id, '')), '');
  v_unit text := NULLIF(trim(COALESCE(p_search_unit_code, '')), '');
  v_general text := NULL;
  v_tokens text[];
  v_tok text;
  v_rest text[] := ARRAY[]::text[];
BEGIN
  -- Prefer explicit structured args; otherwise parse whitespace-delimited p_search.
  -- When structured args are provided alongside a full raw string, strip known tokens
  -- so the leftover becomes general (avoid requiring the whole "ID UNIT" phrase in one field).
  IF v_ext_id IS NOT NULL OR v_unit IS NOT NULL THEN
    IF v_raw IS NOT NULL THEN
      v_tokens := regexp_split_to_array(v_raw, '\s+');
      FOREACH v_tok IN ARRAY v_tokens
      LOOP
        IF v_ext_id IS NOT NULL AND lower(v_tok) = lower(v_ext_id) THEN
          CONTINUE;
        END IF;
        IF v_unit IS NOT NULL AND lower(v_tok) = lower(v_unit) THEN
          CONTINUE;
        END IF;
        v_rest := array_append(v_rest, v_tok);
      END LOOP;
      IF coalesce(array_length(v_rest, 1), 0) > 0 THEN
        v_general := array_to_string(v_rest, ' ');
      END IF;
    END IF;
  ELSIF v_raw IS NOT NULL THEN
    v_tokens := regexp_split_to_array(v_raw, '\s+');
    IF coalesce(array_length(v_tokens, 1), 0) = 1 THEN
      v_tok := v_tokens[1];
      IF v_tok ~ '^\d{4,}$' THEN
        v_ext_id := v_tok;
      ELSIF length(v_tok) >= 5
        AND v_tok ~ '[A-Za-z]'
        AND v_tok ~ '[0-9]'
        AND v_tok !~ '\s'
        AND v_tok ~ '^[A-Za-z0-9._-]+$'
        AND v_tok !~ '^\d+$'
      THEN
        v_unit := v_tok;
      ELSE
        v_general := v_tok;
      END IF;
    ELSE
      FOREACH v_tok IN ARRAY v_tokens
      LOOP
        IF v_ext_id IS NULL AND v_tok ~ '^\d{4,}$' THEN
          v_ext_id := v_tok;
        ELSIF v_unit IS NULL
          AND length(v_tok) >= 5
          AND v_tok ~ '[A-Za-z]'
          AND v_tok ~ '[0-9]'
          AND v_tok !~ '\s'
          AND v_tok ~ '^[A-Za-z0-9._-]+$'
          AND v_tok !~ '^\d+$'
        THEN
          v_unit := v_tok;
        ELSE
          v_rest := array_append(v_rest, v_tok);
        END IF;
      END LOOP;
      -- Name phrases like "AARON BINU" — no structured tokens → keep full raw as general.
      IF v_ext_id IS NULL AND v_unit IS NULL THEN
        v_general := v_raw;
      ELSIF coalesce(array_length(v_rest, 1), 0) > 0 THEN
        v_general := array_to_string(v_rest, ' ');
      END IF;
    END IF;
  END IF;

  v_sql := $q$
    WITH base AS (
      SELECT
        i.id,
        i.form_id,
        f.name AS form_name,
        f.version AS form_version,
        i.student_id,
        COALESCE(
          NULLIF(trim(concat_ws(' ', NULLIF(s.first_name,''), NULLIF(s.last_name,''))), ''),
          NULLIF(s.name,''),
          s.email,
          'Unknown student'
        ) AS student_name,
        COALESCE(s.email, '') AS student_email,
        i.status,
        i.role_context,
        i.created_at,
        i.submitted_at,
        COALESCE(i.submission_count, 0)::int AS submission_count,
        i.start_date,
        i.end_date
      FROM public.skyline_form_instances i
      JOIN public.skyline_forms f ON f.id = i.form_id
      JOIN public.skyline_students s ON s.id = i.student_id
      WHERE i.student_id IS NOT NULL
        AND (s.status IS NULL OR s.status = 'active')
        AND ($1::bigint IS NULL OR i.form_id = $1::bigint)
        AND ($2::bigint IS NULL OR i.student_id = $2::bigint)
        AND (
          $3::bigint IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.skyline_course_forms cf
            WHERE cf.course_id = $3::bigint
              AND cf.form_id = i.form_id
          )
        )
        -- Exact external Student ID when detected / provided
        AND (
          COALESCE($12::text, '') = ''
          OR lower(trim(COALESCE(s.student_id, ''))) = lower(trim($12::text))
        )
        -- Unit code (partial, case-insensitive) when detected / provided
        AND (
          COALESCE($13::text, '') = ''
          OR COALESCE(f.unit_code, '') ILIKE ('%' || $13::text || '%')
          OR COALESCE(f.name, '') ILIKE ('%' || $13::text || '%')
        )
        -- Remaining general free-text (OR across fields)
        AND (
          COALESCE($4::text, '') = ''
          OR (
            i.status ILIKE ('%' || $4::text || '%')
            OR i.role_context ILIKE ('%' || $4::text || '%')
            OR f.name ILIKE ('%' || $4::text || '%')
            OR COALESCE(f.version,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(f.unit_code,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(f.unit_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.student_id,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.first_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.last_name,'') ILIKE ('%' || $4::text || '%')
            OR COALESCE(s.email,'') ILIKE ('%' || $4::text || '%')
          )
        )
        AND (
          $5::date IS NULL
          OR (
            i.start_date IS NOT NULL
            AND i.start_date <= $5::date
            AND (COALESCE(i.extension_date, i.end_date) IS NULL OR COALESCE(i.extension_date, i.end_date) >= $5::date)
          )
        )
        AND (
          $6::text IS NULL
          OR trim(BOTH FROM $6::text) = ''
          OR lower(trim(BOTH FROM $6::text)) = 'all'
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_student'
            AND i.status = 'draft'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_trainer'
            AND public.skyline_assessment_is_awaiting_trainer(i.role_context, i.status, i.did_not_attempt, i.id)
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'awaiting_office'
            AND public.skyline_assessment_is_awaiting_office(i.role_context, i.status, i.did_not_attempt, i.id)
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'did_not_attempt'
            AND COALESCE(i.did_not_attempt, false) = true
          )
          OR (
            lower(trim(BOTH FROM $6::text)) = 'completed'
            AND i.status = 'locked'
            AND NOT COALESCE(i.did_not_attempt, false)
          )
        )
        AND (
          $7::date IS NULL
          OR COALESCE(i.extension_date, i.end_date, i.start_date) >= $7::date
        )
        AND (
          $8::date IS NULL
          OR COALESCE(i.start_date, i.extension_date, i.end_date) <= $8::date
        )
        AND (
          i.start_date IS NULL
          OR COALESCE(i.extension_date, i.end_date) IS NULL
          OR COALESCE(i.extension_date, i.end_date) >= i.start_date
        )
        AND (
          $9::bigint IS NULL
          OR s.batch_id = $9::bigint
        )
    )
    SELECT
      b.*,
      COUNT(*) OVER() AS total_count
    FROM base b
  $q$;

  IF v_key = 'student' THEN
    v_sql := v_sql || format(' ORDER BY b.student_name %s, b.student_email %s, b.id %s ', v_dir, v_dir, v_dir);
  ELSIF v_key = 'form' THEN
    v_sql := v_sql || format(' ORDER BY b.form_name %s, b.form_version %s, b.id %s ', v_dir, v_dir, v_dir);
  ELSIF v_key = 'start' THEN
    v_sql := v_sql || format(' ORDER BY (b.start_date::date) %s NULLS LAST, b.id %s ', v_dir, v_dir);
  ELSIF v_key = 'end' THEN
    v_sql := v_sql || format(' ORDER BY (b.end_date::date) %s NULLS LAST, b.id %s ', v_dir, v_dir);
  ELSIF v_key = 'workflow' THEN
    v_sql := v_sql || format(' ORDER BY b.role_context %s, b.status %s, b.id %s ', v_dir, v_dir);
  ELSE
    v_sql := v_sql || format(' ORDER BY b.created_at %s, b.id %s ', v_dir, v_dir);
  END IF;

  v_sql := v_sql || ' LIMIT $10 OFFSET $11 ';

  RETURN QUERY EXECUTE v_sql
    USING
      p_form_id,
      p_student_id,
      p_course_id,
      NULLIF(trim(COALESCE(v_general, '')), ''),
      p_active_on,
      p_workflow_status,
      p_start_from,
      p_end_date_to,
      p_batch_id,
      v_limit,
      v_from,
      NULLIF(trim(COALESCE(v_ext_id, '')), ''),
      NULLIF(trim(COALESCE(v_unit, '')), '');
END;
$function$;

CREATE OR REPLACE FUNCTION public.skyline_admin_dashboard_instances_paged(p_page integer DEFAULT 1, p_page_size integer DEFAULT 20, p_status text DEFAULT 'awaiting_student'::text, p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_batch_id bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, form_id bigint, form_name text, form_version text, student_id bigint, student_name text, student_email text, status text, role_context text, start_date date, end_date date, created_at timestamp with time zone, batch_id bigint, batch_name text, trainer_name text, total_count bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_from integer := GREATEST(0, (COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20));
  v_limit integer := GREATEST(1, COALESCE(p_page_size, 20));
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      i.id,
      i.form_id,
      f.name AS form_name,
      f.version AS form_version,
      i.student_id,
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', NULLIF(s.first_name,''), NULLIF(s.last_name,''))), ''),
        NULLIF(s.name,''),
        s.email,
        'Unknown student'
      ) AS student_name,
      COALESCE(s.email, '') AS student_email,
      i.status,
      i.role_context,
      i.start_date,
      i.end_date,
      i.created_at,
      s.batch_id,
      b.name AS batch_name,
      u.full_name AS trainer_name
    FROM public.skyline_form_instances i
    JOIN public.skyline_forms f ON f.id = i.form_id
    JOIN public.skyline_students s ON s.id = i.student_id
    LEFT JOIN public.skyline_batches b ON b.id = s.batch_id
    LEFT JOIN public.skyline_users u ON u.id = b.trainer_id
    WHERE i.student_id IS NOT NULL
      AND (s.status IS NULL OR s.status = 'active')
      AND (p_batch_id IS NULL OR s.batch_id = p_batch_id)
      AND (
        p_from_date IS NULL OR p_to_date IS NULL
        OR (i.start_date IS NOT NULL AND i.start_date BETWEEN p_from_date AND p_to_date)
        OR (COALESCE(i.extension_date, i.end_date) IS NOT NULL AND COALESCE(i.extension_date, i.end_date) BETWEEN p_from_date AND p_to_date)
      )
      AND (
        p_status = 'all'
        OR (p_status = 'awaiting_student' AND i.status = 'draft' AND NOT COALESCE(i.did_not_attempt, false))
        OR (p_status = 'awaiting_trainer' AND public.skyline_assessment_is_awaiting_trainer(i.role_context, i.status, i.did_not_attempt, i.id))
        OR (p_status = 'awaiting_office' AND public.skyline_assessment_is_awaiting_office(i.role_context, i.status, i.did_not_attempt, i.id))
        OR (p_status = 'did_not_attempt' AND COALESCE(i.did_not_attempt, false) = true)
        OR (p_status = 'completed' AND i.status = 'locked' AND NOT COALESCE(i.did_not_attempt, false))
      )
  )
  SELECT
    b.*,
    COUNT(*) OVER() AS total_count
  FROM base b
  ORDER BY
    COALESCE(b.start_date, b.end_date, b.created_at::date) DESC,
    b.id DESC
  LIMIT v_limit OFFSET v_from;
END;
$function$;

CREATE OR REPLACE FUNCTION public.skyline_admin_dashboard_stats_v2(p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_status text DEFAULT 'awaiting_student'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_assessments int;
  v_total_students int;
  v_total_trainers int;
  v_total_admins int;

  v_awaiting_student int;
  v_awaiting_trainer int;
  v_awaiting_office int;
  v_completed int;
BEGIN
  -- Totals (all-time)
  SELECT COUNT(*)::int
  INTO v_total_students
  FROM skyline_students s
  WHERE s.status IS NULL OR s.status = 'active';

  SELECT COUNT(*)::int INTO v_total_trainers FROM skyline_users WHERE role = 'trainer';
  SELECT COUNT(*)::int INTO v_total_admins FROM skyline_users WHERE role IN ('admin', 'superadmin');

  SELECT COUNT(*)::int
  INTO v_total_assessments
  FROM skyline_form_instances i
  JOIN skyline_students s ON s.id = i.student_id
  WHERE i.student_id IS NOT NULL
    AND (s.status IS NULL OR s.status = 'active');

  -- Workflow counts for the filtered slice.
  WITH filtered AS (
    SELECT i.*
    FROM skyline_form_instances i
    JOIN skyline_students s ON s.id = i.student_id
    WHERE i.student_id IS NOT NULL
      AND (s.status IS NULL OR s.status = 'active')
      AND (
        p_from_date IS NULL OR p_to_date IS NULL
        OR (i.start_date IS NOT NULL AND i.start_date BETWEEN p_from_date AND p_to_date)
        OR (COALESCE(i.extension_date, i.end_date) IS NOT NULL AND COALESCE(i.extension_date, i.end_date) BETWEEN p_from_date AND p_to_date)
      )
      AND (
        p_status = 'all'
        OR (p_status = 'awaiting_student' AND i.status = 'draft')
        OR (p_status = 'awaiting_trainer' AND public.skyline_assessment_is_awaiting_trainer(i.role_context, i.status, i.did_not_attempt, i.id))
        OR (p_status = 'awaiting_office' AND public.skyline_assessment_is_awaiting_office(i.role_context, i.status, i.did_not_attempt, i.id))
        OR (p_status = 'completed' AND i.status = 'locked')
      )
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'draft')::int,
    COUNT(*) FILTER (WHERE public.skyline_assessment_is_awaiting_trainer(role_context, status, did_not_attempt, id))::int,
    COUNT(*) FILTER (WHERE public.skyline_assessment_is_awaiting_office(role_context, status, did_not_attempt, id))::int,
    COUNT(*) FILTER (WHERE status = 'locked')::int
  INTO v_awaiting_student, v_awaiting_trainer, v_awaiting_office, v_completed
  FROM filtered;

  RETURN jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'assessments', v_total_assessments,
      'students', v_total_students,
      'trainers', v_total_trainers,
      'admins', v_total_admins
    ),
    'workflow', jsonb_build_object(
      'awaiting_student', COALESCE(v_awaiting_student, 0),
      'awaiting_trainer', COALESCE(v_awaiting_trainer, 0),
      'awaiting_office', COALESCE(v_awaiting_office, 0),
      'completed', COALESCE(v_completed, 0)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.skyline_admin_dashboard_stats_v2(p_from_date date DEFAULT NULL::date, p_to_date date DEFAULT NULL::date, p_status text DEFAULT 'awaiting_student'::text, p_batch_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_assessments int;
  v_total_students int;
  v_total_trainers int;
  v_total_admins int;

  v_awaiting_student int;
  v_awaiting_trainer int;
  v_awaiting_office int;
  v_completed int;
BEGIN
  SELECT COUNT(*)::int
  INTO v_total_students
  FROM skyline_students s
  WHERE s.status IS NULL OR s.status = 'active';

  SELECT COUNT(*)::int INTO v_total_trainers FROM skyline_users WHERE role = 'trainer';
  SELECT COUNT(*)::int INTO v_total_admins FROM skyline_users WHERE role IN ('admin', 'superadmin');

  SELECT COUNT(*)::int
  INTO v_total_assessments
  FROM skyline_form_instances i
  JOIN skyline_students s ON s.id = i.student_id
  WHERE i.student_id IS NOT NULL
    AND (s.status IS NULL OR s.status = 'active');

  WITH filtered AS (
    SELECT i.*
    FROM skyline_form_instances i
    JOIN skyline_students s ON s.id = i.student_id
    WHERE i.student_id IS NOT NULL
      AND (s.status IS NULL OR s.status = 'active')
      AND (p_batch_id IS NULL OR s.batch_id = p_batch_id)
      AND (
        p_from_date IS NULL OR p_to_date IS NULL
        OR (i.start_date IS NOT NULL AND i.start_date BETWEEN p_from_date AND p_to_date)
        OR (COALESCE(i.extension_date, i.end_date) IS NOT NULL AND COALESCE(i.extension_date, i.end_date) BETWEEN p_from_date AND p_to_date)
      )
      AND (
        p_status = 'all'
        OR (p_status = 'awaiting_student' AND i.status = 'draft' AND NOT COALESCE(i.did_not_attempt, false))
        OR (p_status = 'awaiting_trainer' AND public.skyline_assessment_is_awaiting_trainer(i.role_context, i.status, i.did_not_attempt, i.id))
        OR (p_status = 'awaiting_office' AND public.skyline_assessment_is_awaiting_office(i.role_context, i.status, i.did_not_attempt, i.id))
        OR (p_status = 'did_not_attempt' AND COALESCE(i.did_not_attempt, false) = true)
        OR (p_status = 'completed' AND i.status = 'locked' AND NOT COALESCE(i.did_not_attempt, false))
      )
  )
  SELECT
    COUNT(*) FILTER (WHERE status = 'draft' AND NOT COALESCE(did_not_attempt, false))::int,
    COUNT(*) FILTER (WHERE public.skyline_assessment_is_awaiting_trainer(role_context, status, did_not_attempt, id))::int,
    COUNT(*) FILTER (WHERE public.skyline_assessment_is_awaiting_office(role_context, status, did_not_attempt, id))::int,
    COUNT(*) FILTER (WHERE status = 'locked' AND NOT COALESCE(did_not_attempt, false))::int
  INTO v_awaiting_student, v_awaiting_trainer, v_awaiting_office, v_completed
  FROM filtered;

  RETURN jsonb_build_object(
    'ok', true,
    'totals', jsonb_build_object(
      'assessments', v_total_assessments,
      'students', v_total_students,
      'trainers', v_total_trainers,
      'admins', v_total_admins
    ),
    'workflow', jsonb_build_object(
      'awaiting_student', COALESCE(v_awaiting_student, 0),
      'awaiting_trainer', COALESCE(v_awaiting_trainer, 0),
      'awaiting_office', COALESCE(v_awaiting_office, 0),
      'completed', COALESCE(v_completed, 0)
    )
  );
END;
$function$;
