-- Assessment Submission Method: editable by student and trainer (not office)
UPDATE skyline_form_questions
SET role_editability = '{"student": true, "trainer": true, "office": false}'::jsonb
WHERE code IN ('assessment.submission', 'assessment.otherDesc');
