-- Appendix A: Trainer and Office admin ONLY - hide from students, editable by trainer and office
-- Appendix B (Learner Evaluation): For all - editable by student, trainer, office

-- 1. Appendix A - Update questions in reasonable_adjustment sections
UPDATE skyline_form_questions q
SET
  role_visibility = '{"student": false, "trainer": true, "office": true}'::jsonb,
  role_editability = '{"student": false, "trainer": true, "office": true}'::jsonb
FROM skyline_form_sections sec
WHERE q.section_id = sec.id
  AND sec.pdf_render_mode = 'reasonable_adjustment';

-- 2. Appendix B - Update Learner Evaluation likert and comment questions to be editable by all
UPDATE skyline_form_questions q
SET role_editability = '{"student": true, "trainer": true, "office": true}'::jsonb
FROM skyline_form_sections sec
JOIN skyline_form_steps st ON st.id = sec.step_id
WHERE q.section_id = sec.id
  AND st.title = 'Learner Evaluation'
  AND sec.pdf_render_mode = 'likert_table'
  AND q.code IN ('evaluation.logistics', 'evaluation.trainer', 'evaluation.learning',
                 'evaluation.logisticsComments', 'evaluation.trainerComments', 'evaluation.learningComments');
