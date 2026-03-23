-- Add Written Evidence Checklist and Assessment Marking Checklist to assessment task steps
-- that have task_questions and task_results but are missing these sections.
-- Target: forms like Form 55 that were created before or bypassed prior backfill migrations.

-- Pass 1: Add Written Evidence Checklist where missing
DO $$
DECLARE
  rec RECORD;
  wec_sec_id BIGINT;
  written_q_id BIGINT;
BEGIN
  FOR rec IN
    SELECT DISTINCT sec.step_id, sec.assessment_task_row_id
    FROM skyline_form_sections sec
    WHERE sec.pdf_render_mode = 'task_questions'
      AND sec.assessment_task_row_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM skyline_form_sections s2
        WHERE s2.step_id = sec.step_id AND s2.pdf_render_mode = 'task_written_evidence_checklist'
      )
      AND EXISTS (
        SELECT 1 FROM skyline_form_sections s3
        WHERE s3.step_id = sec.step_id AND s3.pdf_render_mode = 'task_results'
      )
  LOOP
    -- Insert Written Evidence Checklist section (sort_order 2)
    INSERT INTO skyline_form_sections (step_id, title, pdf_render_mode, assessment_task_row_id, sort_order)
    VALUES (rec.step_id, 'Written Evidence Checklist', 'task_written_evidence_checklist', rec.assessment_task_row_id, 2)
    RETURNING id INTO wec_sec_id;

    INSERT INTO skyline_form_questions (section_id, type, code, label, sort_order, role_visibility, role_editability)
    VALUES (wec_sec_id, 'single_choice', 'written.evidence.checklist', 'Written Evidence Checklist', 0,
      '{"student": false, "trainer": true, "office": true}'::jsonb,
      '{"student": false, "trainer": true, "office": true}'::jsonb)
    RETURNING id INTO written_q_id;

    INSERT INTO skyline_form_question_options (question_id, value, label, sort_order)
    VALUES (written_q_id, 'yes', 'Yes', 0), (written_q_id, 'no', 'No', 1);

    -- Bump task_results sort_order to make room for Written Evidence at 2
    UPDATE skyline_form_sections
    SET sort_order = 3
    WHERE step_id = rec.step_id AND pdf_render_mode = 'task_results';
  END LOOP;
END $$;

-- Pass 2: Add Assessment Marking Checklist where missing (Evidence + Performance Outcome only, no candidate/assessor/date)
DO $$
DECLARE
  rec RECORD;
  mc_sec_id BIGINT;
  evidence_q_id BIGINT;
  perf_q_id BIGINT;
BEGIN
  FOR rec IN
    SELECT DISTINCT sec.step_id, sec.assessment_task_row_id
    FROM skyline_form_sections sec
    WHERE sec.pdf_render_mode = 'task_written_evidence_checklist'
      AND sec.assessment_task_row_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM skyline_form_sections s2
        WHERE s2.step_id = sec.step_id AND s2.pdf_render_mode = 'task_marking_checklist'
      )
      AND EXISTS (
        SELECT 1 FROM skyline_form_sections s3
        WHERE s3.step_id = sec.step_id AND s3.pdf_render_mode = 'task_results'
      )
  LOOP
    -- Update task_results sort_order to 4 (make room for marking checklist at 3)
    UPDATE skyline_form_sections
    SET sort_order = 4
    WHERE step_id = rec.step_id AND pdf_render_mode = 'task_results';

    -- Insert Assessment Marking Checklist section
    INSERT INTO skyline_form_sections (step_id, title, pdf_render_mode, assessment_task_row_id, sort_order)
    VALUES (rec.step_id, 'Assessment Marking Checklist', 'task_marking_checklist', rec.assessment_task_row_id, 3)
    RETURNING id INTO mc_sec_id;

    -- Insert Evidence Outcome question with Yes/No options
    INSERT INTO skyline_form_questions (section_id, type, code, label, sort_order, role_visibility, role_editability)
    VALUES (mc_sec_id, 'single_choice', 'assessment.marking.evidence_outcome', 'Evidence Outcome', 0,
      '{"student": false, "trainer": true, "office": true}'::jsonb,
      '{"student": false, "trainer": true, "office": true}'::jsonb)
    RETURNING id INTO evidence_q_id;
    INSERT INTO skyline_form_question_options (question_id, value, label, sort_order)
    VALUES (evidence_q_id, 'yes', 'Yes', 0), (evidence_q_id, 'no', 'No', 1);

    -- Insert Performance Outcome question with Yes/No options
    INSERT INTO skyline_form_questions (section_id, type, code, label, sort_order, role_visibility, role_editability)
    VALUES (mc_sec_id, 'single_choice', 'assessment.marking.performance_outcome', 'Performance Outcome', 1,
      '{"student": false, "trainer": true, "office": true}'::jsonb,
      '{"student": false, "trainer": true, "office": true}'::jsonb)
    RETURNING id INTO perf_q_id;
    INSERT INTO skyline_form_question_options (question_id, value, label, sort_order)
    VALUES (perf_q_id, 'yes', 'Yes', 0), (perf_q_id, 'no', 'No', 1);
  END LOOP;
END $$;
