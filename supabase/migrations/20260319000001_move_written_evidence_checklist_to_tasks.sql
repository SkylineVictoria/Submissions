-- Move Written Evidence Checklist from standalone step to inside each assessment task
-- (between Questions and Results). Remove the standalone step from existing forms.

-- 1. Add task_written_evidence_checklist to pdf_render_mode constraint
ALTER TABLE skyline_form_sections DROP CONSTRAINT IF EXISTS skyline_form_sections_pdf_render_mode_check;
ALTER TABLE skyline_form_sections ADD CONSTRAINT skyline_form_sections_pdf_render_mode_check
  CHECK (pdf_render_mode IN (
    'normal', 'likert_table', 'grid_table', 'declarations',
    'assessment_tasks', 'assessment_submission', 'reasonable_adjustment',
    'task_instructions', 'task_questions', 'task_results', 'task_written_evidence_checklist',
    'assessment_summary'
  ));

-- 2. For each assessment task step, add Written Evidence Checklist section between Questions and Results
DO $$
DECLARE
  rec RECORD;
  new_sec_id BIGINT;
  new_q_id BIGINT;
BEGIN
  FOR rec IN
    SELECT sec.step_id, sec.assessment_task_row_id
    FROM skyline_form_sections sec
    WHERE sec.pdf_render_mode = 'task_questions'
      AND sec.assessment_task_row_id IS NOT NULL
  LOOP
    -- Insert Written Evidence Checklist section (sort_order 2)
    INSERT INTO skyline_form_sections (step_id, title, pdf_render_mode, assessment_task_row_id, sort_order)
    VALUES (rec.step_id, 'Written Evidence Checklist', 'task_written_evidence_checklist', rec.assessment_task_row_id, 2)
    RETURNING id INTO new_sec_id;

    -- Insert the written evidence checklist question
    INSERT INTO skyline_form_questions (section_id, type, code, label, sort_order, role_visibility, role_editability)
    VALUES (new_sec_id, 'single_choice', 'written.evidence.checklist', 'Written Evidence Checklist', 0,
      '{"student": false, "trainer": true, "office": true}'::jsonb,
      '{"student": false, "trainer": true, "office": true}'::jsonb)
    RETURNING id INTO new_q_id;

    -- Insert Yes/No options
    INSERT INTO skyline_form_question_options (question_id, value, label, sort_order)
    VALUES (new_q_id, 'yes', 'Yes', 0), (new_q_id, 'no', 'No', 1);

    -- Update task_results section to sort_order 3
    UPDATE skyline_form_sections
    SET sort_order = 3
    WHERE step_id = rec.step_id AND pdf_render_mode = 'task_results';
  END LOOP;
END $$;

-- 3. Delete the standalone Written Evidence Checklist step and its sections
-- (sections cascade to questions, options, etc.)
DELETE FROM skyline_form_steps
WHERE title = 'Written Evidence Checklist';
