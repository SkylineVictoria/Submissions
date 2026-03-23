-- Add Assessment Marking Checklist section to all existing assessment task steps that have
-- Written Evidence Checklist and Results but are missing the Assessment Marking Checklist.
-- Order: Instructions (0), Questions (1), Written Evidence Checklist (2), Assessment Marking Checklist (3), Results (4)

DO $$
DECLARE
  rec RECORD;
  mc_sec_id BIGINT;
  evidence_q_id BIGINT;
  perf_q_id BIGINT;
  row_id_val BIGINT;
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
    row_id_val := rec.assessment_task_row_id;

    -- Update task_results sort_order to 4 (make room for marking checklist at 3)
    UPDATE skyline_form_sections
    SET sort_order = 4
    WHERE step_id = rec.step_id AND pdf_render_mode = 'task_results';

    -- Insert Assessment Marking Checklist section
    INSERT INTO skyline_form_sections (step_id, title, pdf_render_mode, assessment_task_row_id, sort_order)
    VALUES (rec.step_id, 'Assessment Marking Checklist', 'task_marking_checklist', row_id_val, 3)
    RETURNING id INTO mc_sec_id;

    -- Insert Candidate Name, Assessor Name, Assessment Date
    INSERT INTO skyline_form_questions (section_id, type, code, label, sort_order, role_visibility, role_editability)
    VALUES
      (mc_sec_id, 'short_text', 'assessment.marking.candidateName', 'Candidate Name', 0,
       '{"student": false, "trainer": true, "office": true}'::jsonb,
       '{"student": false, "trainer": true, "office": true}'::jsonb),
      (mc_sec_id, 'short_text', 'assessment.marking.assessorName', 'Assessor Name', 1,
       '{"student": false, "trainer": true, "office": true}'::jsonb,
       '{"student": false, "trainer": true, "office": true}'::jsonb),
      (mc_sec_id, 'date', 'assessment.marking.assessmentDate', 'Assessment date/s', 2,
       '{"student": false, "trainer": true, "office": true}'::jsonb,
       '{"student": false, "trainer": true, "office": true}'::jsonb);

    -- Insert Evidence Outcome question with Yes/No options
    INSERT INTO skyline_form_questions (section_id, type, code, label, sort_order, role_visibility, role_editability)
    VALUES (mc_sec_id, 'single_choice', 'assessment.marking.evidence_outcome', 'Evidence Outcome', 3,
      '{"student": false, "trainer": true, "office": true}'::jsonb,
      '{"student": false, "trainer": true, "office": true}'::jsonb)
    RETURNING id INTO evidence_q_id;
    INSERT INTO skyline_form_question_options (question_id, value, label, sort_order)
    VALUES (evidence_q_id, 'yes', 'Yes', 0), (evidence_q_id, 'no', 'No', 1);

    -- Insert Performance Outcome question with Yes/No options
    INSERT INTO skyline_form_questions (section_id, type, code, label, sort_order, role_visibility, role_editability)
    VALUES (mc_sec_id, 'single_choice', 'assessment.marking.performance_outcome', 'Performance Outcome', 4,
      '{"student": false, "trainer": true, "office": true}'::jsonb,
      '{"student": false, "trainer": true, "office": true}'::jsonb)
    RETURNING id INTO perf_q_id;
    INSERT INTO skyline_form_question_options (question_id, value, label, sort_order)
    VALUES (perf_q_id, 'yes', 'Yes', 0), (perf_q_id, 'no', 'No', 1);
  END LOOP;
END $$;
