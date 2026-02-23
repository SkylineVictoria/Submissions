-- Trainer Full Name: editable by trainer and office only (student cannot edit)
UPDATE skyline_form_questions
SET role_editability = '{"student": false, "trainer": true, "office": true}'::jsonb
WHERE code = 'trainer.fullName';
