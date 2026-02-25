-- Remove duplicate "Reasonable Adjustment" sections from Introductory Details.
-- createCompulsoryFormStructure adds one (sort_order 4); createDefaultSectionsToStep was also
-- adding another from DEFAULT_STEPS_5_TO_20. Keep the first (lowest sort_order), delete duplicates.

CREATE TEMP TABLE duplicate_ra_section_ids AS
SELECT sec.id
FROM skyline_form_sections sec
JOIN skyline_form_steps st ON st.id = sec.step_id
WHERE sec.title = 'Reasonable Adjustment' AND st.title = 'Introductory Details'
AND sec.id NOT IN (
  SELECT DISTINCT ON (step_id) id
  FROM skyline_form_sections
  WHERE title = 'Reasonable Adjustment'
  AND step_id IN (SELECT id FROM skyline_form_steps WHERE title = 'Introductory Details')
  ORDER BY step_id, sort_order ASC
);

-- Delete in dependency order: answers, trainer_assessments, options, rows, questions, then sections
DELETE FROM skyline_form_answers
WHERE question_id IN (SELECT id FROM skyline_form_questions WHERE section_id IN (SELECT id FROM duplicate_ra_section_ids));

DELETE FROM skyline_form_trainer_assessments
WHERE question_id IN (SELECT id FROM skyline_form_questions WHERE section_id IN (SELECT id FROM duplicate_ra_section_ids));

DELETE FROM skyline_form_question_options
WHERE question_id IN (SELECT id FROM skyline_form_questions WHERE section_id IN (SELECT id FROM duplicate_ra_section_ids));

DELETE FROM skyline_form_question_rows
WHERE question_id IN (SELECT id FROM skyline_form_questions WHERE section_id IN (SELECT id FROM duplicate_ra_section_ids));

DELETE FROM skyline_form_questions
WHERE section_id IN (SELECT id FROM duplicate_ra_section_ids);

DELETE FROM skyline_form_sections
WHERE id IN (SELECT id FROM duplicate_ra_section_ids);

DROP TABLE duplicate_ra_section_ids;
