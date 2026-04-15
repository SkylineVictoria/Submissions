-- Allow image answers (uploaded file URL stored in skyline_form_answers.value_json)
-- IMPORTANT: This only expands allowed values for skyline_form_questions.type.

ALTER TABLE skyline_form_questions
  DROP CONSTRAINT IF EXISTS skyline_form_questions_type_check;

ALTER TABLE skyline_form_questions
  ADD CONSTRAINT skyline_form_questions_type_check
  CHECK (
    type IN (
      'instruction_block',
      'short_text',
      'long_text',
      'yes_no',
      'single_choice',
      'multi_choice',
      'likert_5',
      'grid_table',
      'date',
      'signature',
      'page_break',
      'image'
    )
  );

