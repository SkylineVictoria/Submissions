-- Atomic repair for forms where multiple parents embed the same contentBlocks.questionId.
-- Clones shared child questions (options + rows) for non-owner parents and rewires pdf_meta.
-- Does NOT copy student answers onto clones (historical shared answers stay on the owner child).

CREATE OR REPLACE FUNCTION public.skyline_diagnose_shared_content_block_grids(p_form_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
  v_shared_count int;
BEGIN
  IF p_form_id IS NULL OR p_form_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid form id.');
  END IF;

  WITH form_qs AS (
    SELECT q.id, q.label, q.type, q.sort_order, q.pdf_meta, s.id AS section_id
    FROM skyline_form_questions q
    JOIN skyline_form_sections s ON s.id = q.section_id
    JOIN skyline_form_steps st ON st.id = s.step_id
    WHERE st.form_id = p_form_id
  ),
  blocks AS (
    SELECT
      fq.id AS parent_question_id,
      LEFT(COALESCE(fq.label, ''), 120) AS parent_question_label,
      fq.sort_order AS parent_display_order,
      (b.ordinality - 1) AS block_index,
      b.elem->>'type' AS block_type,
      NULLIF(b.elem->>'questionId', '')::bigint AS referenced_child_question_id,
      fq.pdf_meta->>'isAdditionalBlockOf' AS is_additional_block_of
    FROM form_qs fq
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(fq.pdf_meta->'contentBlocks', '[]'::jsonb))
      WITH ORDINALITY AS b(elem, ordinality)
  ),
  enriched AS (
    SELECT
      b.*,
      EXISTS (SELECT 1 FROM skyline_form_questions cq WHERE cq.id = b.referenced_child_question_id) AS child_question_exists,
      (SELECT cq.type FROM skyline_form_questions cq WHERE cq.id = b.referenced_child_question_id) AS child_question_type,
      COUNT(*) FILTER (WHERE b.referenced_child_question_id IS NOT NULL)
        OVER (PARTITION BY b.referenced_child_question_id) AS duplicate_reference_count,
      (
        SELECT COALESCE(jsonb_agg(r.id ORDER BY r.sort_order), '[]'::jsonb)
        FROM skyline_form_question_rows r
        WHERE r.question_id = b.referenced_child_question_id
      ) AS row_ids
    FROM blocks b
    WHERE b.referenced_child_question_id IS NOT NULL
  )
  SELECT
    COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.duplicate_reference_count DESC, e.referenced_child_question_id, e.parent_display_order, e.block_index)
      FROM enriched e
    ), '[]'::jsonb),
    COALESCE((
      SELECT COUNT(DISTINCT referenced_child_question_id)::int
      FROM enriched
      WHERE duplicate_reference_count > 1
    ), 0)
  INTO v_rows, v_shared_count;

  RETURN jsonb_build_object(
    'ok', true,
    'formId', p_form_id,
    'sharedChildCount', COALESCE(v_shared_count, 0),
    'blocks', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_repair_shared_content_block_grids(p_form_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_before jsonb;
  v_after jsonb;
  v_plan RECORD;
  v_parent_id bigint;
  v_source RECORD;
  v_section_id bigint;
  v_next_sort int;
  v_new_child_id bigint;
  v_parent_pm jsonb;
  v_blocks jsonb;
  v_child_pm jsonb;
  v_clones int := 0;
  v_rewired int := 0;
  v_remaining int;
BEGIN
  IF p_form_id IS NULL OR p_form_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Invalid form id.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM skyline_forms WHERE id = p_form_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Form not found.');
  END IF;

  v_before := public.skyline_diagnose_shared_content_block_grids(p_form_id);

  -- Each shared child + its referencing parents (distinct).
  FOR v_plan IN
    WITH form_qs AS (
      SELECT q.id, q.pdf_meta
      FROM skyline_form_questions q
      JOIN skyline_form_sections s ON s.id = q.section_id
      JOIN skyline_form_steps st ON st.id = s.step_id
      WHERE st.form_id = p_form_id
    ),
    refs AS (
      SELECT
        fq.id AS parent_id,
        NULLIF(b.elem->>'questionId', '')::bigint AS child_id
      FROM form_qs fq
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(fq.pdf_meta->'contentBlocks', '[]'::jsonb)) AS b(elem)
      WHERE NULLIF(b.elem->>'questionId', '') IS NOT NULL
    ),
    shared AS (
      SELECT child_id, array_agg(DISTINCT parent_id ORDER BY parent_id) AS parent_ids
      FROM refs
      GROUP BY child_id
      HAVING COUNT(DISTINCT parent_id) > 1
    )
    SELECT
      s.child_id AS shared_child_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM skyline_form_questions cq
          WHERE cq.id = s.child_id
            AND NULLIF(cq.pdf_meta->>'isAdditionalBlockOf', '')::bigint = ANY (s.parent_ids)
        )
        THEN (
          SELECT NULLIF(cq.pdf_meta->>'isAdditionalBlockOf', '')::bigint
          FROM skyline_form_questions cq
          WHERE cq.id = s.child_id
        )
        ELSE s.parent_ids[1]
      END AS owner_parent_id,
      s.parent_ids AS parent_ids
    FROM shared s
  LOOP
    SELECT q.* INTO v_source FROM skyline_form_questions q WHERE q.id = v_plan.shared_child_id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    SELECT s.id INTO v_section_id
    FROM skyline_form_sections s
    JOIN skyline_form_steps st ON st.id = s.step_id
    WHERE st.form_id = p_form_id
      AND (
        EXISTS (SELECT 1 FROM skyline_form_questions q WHERE q.section_id = s.id AND q.id = v_plan.shared_child_id)
        OR EXISTS (SELECT 1 FROM skyline_form_questions q WHERE q.section_id = s.id AND q.id = v_plan.owner_parent_id)
      )
    ORDER BY s.sort_order
    LIMIT 1;

    IF v_section_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', format('Could not resolve section for shared child %s', v_plan.shared_child_id),
        'before', v_before
      );
    END IF;

    FOREACH v_parent_id IN ARRAY v_plan.parent_ids
    LOOP
      IF v_parent_id = v_plan.owner_parent_id THEN
        CONTINUE;
      END IF;

      SELECT COALESCE(MAX(q.sort_order), 0) + 1 INTO v_next_sort
      FROM skyline_form_questions q
      WHERE q.section_id = v_section_id;

      v_child_pm := COALESCE(v_source.pdf_meta, '{}'::jsonb) || jsonb_build_object('isAdditionalBlockOf', v_parent_id);

      INSERT INTO skyline_form_questions (
        section_id, type, code, label, help_text, required, sort_order,
        role_visibility, role_editability, pdf_meta
      )
      VALUES (
        v_section_id,
        v_source.type,
        v_source.code,
        v_source.label,
        v_source.help_text,
        COALESCE(v_source.required, false),
        v_next_sort,
        COALESCE(v_source.role_visibility, '{}'::jsonb),
        COALESCE(v_source.role_editability, '{}'::jsonb),
        v_child_pm
      )
      RETURNING id INTO v_new_child_id;

      v_clones := v_clones + 1;

      INSERT INTO skyline_form_question_options (question_id, value, label, sort_order)
      SELECT v_new_child_id, o.value, o.label, o.sort_order
      FROM skyline_form_question_options o
      WHERE o.question_id = v_plan.shared_child_id
      ORDER BY o.sort_order;

      INSERT INTO skyline_form_question_rows (
        question_id, row_label, row_help, row_image_url, row_meta, sort_order
      )
      SELECT
        v_new_child_id, r.row_label, r.row_help, r.row_image_url, r.row_meta, r.sort_order
      FROM skyline_form_question_rows r
      WHERE r.question_id = v_plan.shared_child_id
      ORDER BY r.sort_order;

      SELECT COALESCE(q.pdf_meta, '{}'::jsonb) INTO v_parent_pm
      FROM skyline_form_questions q
      WHERE q.id = v_parent_id;

      SELECT COALESCE(
        jsonb_agg(
          CASE
            WHEN NULLIF(elem->>'questionId', '')::bigint = v_plan.shared_child_id
              THEN elem || jsonb_build_object('questionId', v_new_child_id)
            ELSE elem
          END
          ORDER BY ord
        ),
        '[]'::jsonb
      )
      INTO v_blocks
      FROM jsonb_array_elements(COALESCE(v_parent_pm->'contentBlocks', '[]'::jsonb))
        WITH ORDINALITY AS t(elem, ord);

      UPDATE skyline_form_questions
      SET pdf_meta = v_parent_pm || jsonb_build_object('contentBlocks', v_blocks)
      WHERE id = v_parent_id;

      v_rewired := v_rewired + 1;
    END LOOP;

    -- Owner child points at owner parent.
    IF v_plan.owner_parent_id IS NOT NULL THEN
      UPDATE skyline_form_questions
      SET pdf_meta = COALESCE(pdf_meta, '{}'::jsonb) || jsonb_build_object('isAdditionalBlockOf', v_plan.owner_parent_id)
      WHERE id = v_plan.shared_child_id;
    END IF;
  END LOOP;

  v_after := public.skyline_diagnose_shared_content_block_grids(p_form_id);
  v_remaining := COALESCE((v_after->>'sharedChildCount')::int, 0);

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Repair incomplete: % shared child reference(s) remain', v_remaining;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'formId', p_form_id,
    'duplicatesFound', COALESCE((v_before->>'sharedChildCount')::int, 0),
    'childrenCreated', v_clones,
    'parentsRemapped', v_rewired,
    'remainingDuplicates', v_remaining,
    'before', v_before,
    'after', v_after
  );
EXCEPTION
  WHEN others THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', SQLERRM,
      'formId', p_form_id,
      'childrenCreated', v_clones,
      'parentsRemapped', v_rewired
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_diagnose_shared_content_block_grids(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skyline_repair_shared_content_block_grids(bigint) TO anon, authenticated;

COMMENT ON FUNCTION public.skyline_diagnose_shared_content_block_grids(bigint) IS
  'Read-only: list contentBlocks child references and duplicate counts for a form.';
COMMENT ON FUNCTION public.skyline_repair_shared_content_block_grids(bigint) IS
  'Atomically clone shared content-block child questions and rewire parents; fails if any shared refs remain.';
