-- =============================================================================
-- Carpentry units with incomplete student answers (trainer-pending)
-- =============================================================================
-- Run in Supabase SQL Editor (or psql) as a read-only SELECT. No writes.
--
-- Pending trainer = role_context = 'trainer' AND status <> 'locked'
--   (same as trainer dashboard / admin awaiting_trainer)
-- Carpentry = skyline_courses.qualification_code = 'CPC30220' (id 14 today)
-- Painting (CPC30620 / id 13) is excluded via skyline_course_forms.
-- One skyline_form_instances row per student+form (no paired role instances).
-- Student incompleteness mirrors InstanceFillPage.getStepValidationErrors /
-- rowAnswerHasContent / isGridTableFilled for the student role.
-- =============================================================================

WITH
wanted AS (
  SELECT * FROM (VALUES
    ('12944626'), ('12944502'), ('12991649'), ('12975392'), ('12947482'),
    ('12957400'), ('12955037'), ('12938839'), ('12965400'), ('12960898'),
    ('12945074'), ('12978161'), ('13072537'), ('12996653'), ('12630703'),
    ('13048298'), ('12896231'), ('13065366'), ('12951505'), ('12942320'),
    ('12944644'), ('12945021'), ('12944643'), ('12949966'), ('12949479'),
    ('12946839'), ('12968057'), ('12942302'), ('12996637'), ('12945559'),
    ('12942271'), ('12225990'), ('13035684')
  ) AS t(external_id)
),

carpentry AS (
  SELECT id AS course_id
  FROM public.skyline_courses
  WHERE qualification_code = 'CPC30220'
  ORDER BY id DESC
  LIMIT 1
),

-- Unresolved supplied IDs (do not silently remap 12225990 → 12942282)
unresolved AS (
  SELECT
    w.external_id AS external_student_id,
    NULL::text AS student_name,
    NULL::text AS student_email,
    NULL::text AS unit_code,
    NULL::text AS unit_name,
    NULL::bigint AS form_id,
    NULL::bigint AS instance_id,
    NULL::text AS instance_status,
    NULL::text AS workflow_status,
    0 AS missing_answer_count,
    CASE
      WHEN w.external_id = '12225990' THEN
        'External student_id 12225990 not found in skyline_students. Chanpreet Singh exists under 12942282 — do not auto-replace; confirm the correct ID.'
      ELSE
        'External student_id not found in skyline_students.'
    END AS missing_fields,
    NULL::timestamptz AS last_saved_at
  FROM wanted w
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.skyline_students s
    WHERE lower(trim(s.student_id)) = lower(trim(w.external_id))
  )
),

cohort AS (
  SELECT
    s.id AS internal_student_id,
    s.student_id AS external_student_id,
    s.name AS student_name,
    s.email AS student_email,
    c.course_id
  FROM wanted w
  JOIN public.skyline_students s
    ON lower(trim(s.student_id)) = lower(trim(w.external_id))
  JOIN carpentry c ON true
  JOIN public.skyline_student_courses sc
    ON sc.student_id = s.id
   AND sc.course_id = c.course_id
   AND sc.status = 'active'
),

pending AS (
  SELECT
    co.*,
    i.id AS instance_id,
    i.form_id,
    i.status AS instance_status,
    i.workflow_status,
    i.submission_count,
    f.unit_code,
    f.unit_name,
    f.name AS form_name
  FROM cohort co
  JOIN public.skyline_form_instances i ON i.student_id = co.internal_student_id
  JOIN public.skyline_forms f ON f.id = i.form_id
  JOIN public.skyline_course_forms cf
    ON cf.form_id = f.id AND cf.course_id = co.course_id
  WHERE i.role_context = 'trainer'
    AND coalesce(i.status, '') <> 'locked'
),

summary_step AS (
  SELECT st.form_id, min(st.sort_order) AS summary_sort
  FROM public.skyline_form_steps st
  JOIN public.skyline_form_sections sec ON sec.step_id = st.id
  WHERE sec.pdf_render_mode = 'assessment_summary'
  GROUP BY st.form_id
),

-- Answer has content (mirrors rowAnswerHasContent; 0/false/No are content)
answer AS (
  SELECT
    a.instance_id,
    a.question_id,
    a.row_id,
    a.value_text,
    a.value_number,
    a.value_json,
    a.updated_at,
    (
      a.value_number IS NOT NULL
      OR (a.value_text IS NOT NULL AND btrim(a.value_text) <> '')
      OR (
        a.value_json IS NOT NULL AND (
          jsonb_typeof(a.value_json) IN ('boolean', 'number')
          OR (jsonb_typeof(a.value_json) = 'string' AND btrim(a.value_json #>> '{}') <> '')
          OR (jsonb_typeof(a.value_json) = 'array' AND jsonb_array_length(a.value_json) > 0)
          OR (
            jsonb_typeof(a.value_json) = 'object'
            AND EXISTS (
              SELECT 1 FROM jsonb_each_text(a.value_json) e
              WHERE nullif(btrim(e.value), '') IS NOT NULL
            )
          )
        )
      )
    ) AS has_content
  FROM public.skyline_form_answers a
  WHERE a.instance_id IN (SELECT instance_id FROM pending)
),

student_required_q AS (
  SELECT
    p.instance_id,
    sec.id AS section_id,
    sec.title AS section_title,
    q.id AS question_id,
    q.label AS question_label,
    q.type AS question_type,
    q.code AS question_code,
    q.pdf_meta
  FROM pending p
  JOIN public.skyline_form_steps st ON st.form_id = p.form_id
  JOIN public.skyline_form_sections sec ON sec.step_id = st.id
  JOIN public.skyline_form_questions q ON q.section_id = sec.id
  LEFT JOIN summary_step ss ON ss.form_id = p.form_id
  WHERE q.required IS TRUE
    AND q.type NOT IN ('instruction_block', 'page_break')
    AND coalesce((q.role_editability ->> 'student')::boolean, true) IS TRUE
    AND coalesce((q.role_visibility ->> 'student')::boolean, true) IS TRUE
    AND (q.pdf_meta ->> 'isAdditionalBlockOf') IS NULL
    AND sec.pdf_render_mode NOT IN ('task_results', 'assessment_summary')
    AND st.title !~* 'Appendix[[:space:]]*A'
    AND NOT (
      ss.summary_sort IS NOT NULL
      AND st.sort_order > ss.summary_sort
      AND sec.pdf_render_mode IN (
        'task_instructions', 'task_questions', 'task_written_evidence_checklist',
        'task_marking_checklist', 'task_results', 'assessment_tasks'
      )
    )
),

missing_items AS (
  -- Scalar / choice / yes_no / date / multi_choice (no checklist rows)
  SELECT
    q.instance_id,
    coalesce(nullif(btrim(q.question_label), ''), 'Question ' || q.question_id) AS field_label
  FROM student_required_q q
  LEFT JOIN answer a
    ON a.instance_id = q.instance_id
   AND a.question_id = q.question_id
   AND a.row_id IS NULL
  WHERE q.question_type NOT IN ('grid_table', 'likert_5', 'signature')
    AND NOT (
      q.question_type = 'single_choice'
      AND EXISTS (
        SELECT 1 FROM public.skyline_form_question_rows r WHERE r.question_id = q.question_id
      )
    )
    AND NOT coalesce(a.has_content, false)

  UNION ALL

  -- Checklist rows (single_choice + rows)
  SELECT
    q.instance_id,
    coalesce(nullif(btrim(q.question_label), ''), 'Checklist')
      || ' — ' || coalesce(nullif(btrim(r.row_label), ''), 'row ' || r.id)
  FROM student_required_q q
  JOIN public.skyline_form_question_rows r ON r.question_id = q.question_id
  LEFT JOIN answer a
    ON a.instance_id = q.instance_id
   AND a.question_id = q.question_id
   AND a.row_id = r.id
  WHERE q.question_type = 'single_choice'
    AND NOT coalesce(a.has_content, false)

  UNION ALL

  -- Likert rows
  SELECT
    q.instance_id,
    coalesce(nullif(btrim(q.question_label), ''), 'Likert')
      || ' — ' || coalesce(nullif(btrim(r.row_label), ''), 'row ' || r.id)
  FROM student_required_q q
  JOIN public.skyline_form_question_rows r ON r.question_id = q.question_id
  LEFT JOIN answer a
    ON a.instance_id = q.instance_id
   AND a.question_id = q.question_id
   AND a.row_id = r.id
  WHERE q.question_type = 'likert_5'
    AND NOT coalesce(a.has_content, false)

  UNION ALL

  -- Signatures / declaration (+ optional date)
  SELECT
    q.instance_id,
    CASE
      WHEN nullif(btrim(coalesce(
             a.value_json ->> 'signature',
             a.value_json ->> 'imageDataUrl',
             CASE WHEN a.value_json IS NULL THEN a.value_text END,
             ''
           )), '') IS NULL
        THEN CASE
               WHEN q.question_code = 'student.declarationSignature'
                 THEN 'Declaration signature'
               ELSE coalesce(nullif(btrim(q.question_label), ''), 'Student signature')
             END
      ELSE coalesce(nullif(btrim(q.question_label), ''), 'Signature') || ' date'
    END
  FROM student_required_q q
  LEFT JOIN answer a
    ON a.instance_id = q.instance_id
   AND a.question_id = q.question_id
   AND a.row_id IS NULL
  WHERE q.question_type = 'signature'
    AND (
      nullif(btrim(coalesce(
        a.value_json ->> 'signature',
        a.value_json ->> 'imageDataUrl',
        CASE WHEN a.value_json IS NULL THEN a.value_text END,
        ''
      )), '') IS NULL
      OR (
        coalesce((q.pdf_meta ->> 'showDateField')::boolean, false)
        AND nullif(btrim(coalesce(
          a.value_json ->> 'date',
          a.value_json ->> 'signedAtDate',
          ''
        )), '') IS NULL
      )
    )

  UNION ALL

  -- Incomplete grid questions (one summary label per incomplete grid)
  SELECT
    g.instance_id,
    coalesce(nullif(btrim(g.question_label), ''), 'Table question ' || g.question_id)
      || ' (incomplete table)'
  FROM (
    SELECT
      q.instance_id,
      q.question_id,
      q.question_label,
      coalesce(q.pdf_meta ->> 'layout', 'no_image') AS layout,
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(coalesce(q.pdf_meta -> 'columnsMeta', '[]'::jsonb)) e
        WHERE lower(trim(coalesce(e ->> 'type', ''))) = 'question'
      ) AS has_question_col,
      COALESCE(
        (
          SELECT array_agg((ord - 1)::int ORDER BY ord)
          FROM jsonb_array_elements(coalesce(q.pdf_meta -> 'columnsMeta', '[]'::jsonb))
            WITH ORDINALITY AS t(elem, ord)
          WHERE lower(trim(coalesce(elem ->> 'type', 'answer'))) <> 'question'
        ),
        ARRAY[0]
      ) AS answer_cols,
      (
        SELECT nullif(btrim(coalesce(a.value_text, '')), '')
        FROM public.skyline_form_answers a
        WHERE a.instance_id = q.instance_id
          AND a.question_id = q.question_id
          AND a.row_id IS NULL
      ) AS legacy_text
    FROM student_required_q q
    WHERE q.question_type = 'grid_table'
  ) g
  JOIN public.skyline_form_question_rows r ON r.question_id = g.question_id
  LEFT JOIN public.skyline_form_answers a
    ON a.instance_id = g.instance_id
   AND a.question_id = g.question_id
   AND a.row_id = r.id
  GROUP BY
    g.instance_id, g.question_id, g.question_label, g.layout,
    g.has_question_col, g.answer_cols, g.legacy_text
  HAVING
    g.legacy_text IS NULL
    AND CASE
      WHEN g.layout = 'no_image_no_header' AND g.has_question_col THEN
        NOT coalesce((
          SELECT bool_or(col_ok)
          FROM (
            SELECT bool_and(
              nullif(btrim(coalesce(a2.value_json ->> ('r' || r2.id || '_c' || c), '')), '') IS NOT NULL
            ) AS col_ok
            FROM unnest(g.answer_cols) AS c
            CROSS JOIN public.skyline_form_question_rows r2
            LEFT JOIN public.skyline_form_answers a2
              ON a2.instance_id = g.instance_id
             AND a2.question_id = g.question_id
             AND a2.row_id = r2.id
            WHERE r2.question_id = g.question_id
            GROUP BY c
          ) x
        ), false)
      ELSE
        NOT bool_or(
          CASE
            WHEN a.value_json IS NULL THEN false
            ELSE (
              SELECT bool_and(
                nullif(btrim(coalesce(a.value_json ->> ('r' || r.id || '_c' || c), '')), '') IS NOT NULL
              )
              FROM unnest(g.answer_cols) AS c
            )
          END
        )
    END

  UNION ALL

  -- Results sheet student name / signature (pre-summary only)
  SELECT
    p.instance_id,
    'Results sheet (' || coalesce(nullif(btrim(sec.title), ''), 'Results') || '): student name'
  FROM pending p
  JOIN public.skyline_form_steps st ON st.form_id = p.form_id
  JOIN public.skyline_form_sections sec
    ON sec.step_id = st.id AND sec.pdf_render_mode = 'task_results'
  LEFT JOIN summary_step ss ON ss.form_id = p.form_id
  LEFT JOIN public.skyline_form_results_data rd
    ON rd.instance_id = p.instance_id AND rd.section_id = sec.id
  WHERE (ss.summary_sort IS NULL OR st.sort_order < ss.summary_sort)
    AND nullif(btrim(rd.student_name), '') IS NULL

  UNION ALL

  SELECT
    p.instance_id,
    'Results sheet (' || coalesce(nullif(btrim(sec.title), ''), 'Results') || '): student signature'
  FROM pending p
  JOIN public.skyline_form_steps st ON st.form_id = p.form_id
  JOIN public.skyline_form_sections sec
    ON sec.step_id = st.id AND sec.pdf_render_mode = 'task_results'
  LEFT JOIN summary_step ss ON ss.form_id = p.form_id
  LEFT JOIN public.skyline_form_results_data rd
    ON rd.instance_id = p.instance_id AND rd.section_id = sec.id
  WHERE (ss.summary_sort IS NULL OR st.sort_order < ss.summary_sort)
    AND nullif(btrim(rd.student_signature), '') IS NULL

  UNION ALL

  -- Assessment summary student signature / date for current submission wave
  SELECT
    p.instance_id,
    'Summary sheet: student signature (attempt ' || wave.attempt || ')'
  FROM pending p
  JOIN public.skyline_form_steps st ON st.form_id = p.form_id
  JOIN public.skyline_form_sections sec
    ON sec.step_id = st.id AND sec.pdf_render_mode = 'assessment_summary'
  LEFT JOIN public.skyline_form_assessment_summary_data sum ON sum.instance_id = p.instance_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN coalesce(p.submission_count, 1) >= 3 THEN 3
      WHEN coalesce(p.submission_count, 1) = 2 THEN 2
      ELSE 1
    END AS attempt
  ) wave
  WHERE nullif(
    btrim(
      CASE wave.attempt
        WHEN 1 THEN sum.student_sig_1
        WHEN 2 THEN sum.student_sig_2
        ELSE sum.student_sig_3
      END
    ),
    ''
  ) IS NULL

  UNION ALL

  SELECT
    p.instance_id,
    'Summary sheet: student date (attempt ' || wave.attempt || ')'
  FROM pending p
  JOIN public.skyline_form_steps st ON st.form_id = p.form_id
  JOIN public.skyline_form_sections sec
    ON sec.step_id = st.id AND sec.pdf_render_mode = 'assessment_summary'
  LEFT JOIN public.skyline_form_assessment_summary_data sum ON sum.instance_id = p.instance_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN coalesce(p.submission_count, 1) >= 3 THEN 3
      WHEN coalesce(p.submission_count, 1) = 2 THEN 2
      ELSE 1
    END AS attempt
  ) wave
  WHERE nullif(
    btrim(
      CASE wave.attempt
        WHEN 1 THEN sum.student_date_1
        WHEN 2 THEN sum.student_date_2
        ELSE sum.student_date_3
      END
    ),
    ''
  ) IS NULL
),

agg AS (
  SELECT
    m.instance_id,
    count(*)::int AS missing_answer_count,
    string_agg(m.field_label, ', ' ORDER BY m.field_label) AS missing_fields
  FROM missing_items m
  GROUP BY m.instance_id
),

last_saved AS (
  SELECT instance_id, max(updated_at) AS last_saved_at
  FROM answer
  GROUP BY instance_id
),

incomplete_units AS (
  SELECT
    p.external_student_id,
    p.student_name,
    p.student_email,
    p.unit_code,
    p.unit_name,
    p.form_id,
    p.instance_id,
    p.instance_status,
    p.workflow_status,
    a.missing_answer_count,
    a.missing_fields,
    ls.last_saved_at
  FROM pending p
  JOIN agg a ON a.instance_id = p.instance_id
  LEFT JOIN last_saved ls ON ls.instance_id = p.instance_id
  WHERE a.missing_answer_count > 0
)

SELECT
  external_student_id,
  student_name,
  student_email,
  unit_code,
  unit_name,
  form_id,
  instance_id,
  instance_status,
  workflow_status,
  missing_answer_count,
  missing_fields,
  last_saved_at
FROM incomplete_units

UNION ALL

SELECT
  external_student_id,
  student_name,
  student_email,
  unit_code,
  unit_name,
  form_id,
  instance_id,
  instance_status,
  workflow_status,
  missing_answer_count,
  missing_fields,
  last_saved_at
FROM unresolved

ORDER BY
  student_name NULLS LAST,
  unit_code NULLS LAST,
  external_student_id;
