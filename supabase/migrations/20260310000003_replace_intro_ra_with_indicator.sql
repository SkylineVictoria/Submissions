-- When Appendix A exists, replace the Introductory Reasonable Adjustment section (checkbox, table, signature)
-- with instruction-only text pointing to Appendix A. Trainer enters reasonable adjustment once in Appendix A.

-- For each form that has Appendix A, find the intro RA section (Reasonable Adjustment in Introductory Details),
-- change its mode to reasonable_adjustment_indicator, delete its form questions, and add one instruction_block.

DO $$
DECLARE
  intro_sec RECORD;
  ra_sec_id int;
  form_has_appendix boolean;
BEGIN
  FOR intro_sec IN
    SELECT sec.id AS section_id, sec.step_id, st.form_id
    FROM skyline_form_sections sec
    JOIN skyline_form_steps st ON st.id = sec.step_id
    WHERE sec.title = 'Reasonable Adjustment'
      AND sec.pdf_render_mode = 'reasonable_adjustment'
      AND st.title = 'Introductory Details'
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM skyline_form_steps s
      WHERE s.form_id = intro_sec.form_id
        AND s.title ILIKE '%Appendix A%'
    ) INTO form_has_appendix;

    IF form_has_appendix THEN
      ra_sec_id := intro_sec.section_id;

      DELETE FROM skyline_form_answers
      WHERE question_id IN (SELECT id FROM skyline_form_questions WHERE section_id = ra_sec_id);

      DELETE FROM skyline_form_trainer_assessments
      WHERE question_id IN (SELECT id FROM skyline_form_questions WHERE section_id = ra_sec_id);

      DELETE FROM skyline_form_questions WHERE section_id = ra_sec_id;

      UPDATE skyline_form_sections
      SET pdf_render_mode = 'reasonable_adjustment_indicator',
          description = 'Reasonable Adjustment: See Appendix A – Reasonable Adjustments for details and to record any adjustments applied.'
      WHERE id = ra_sec_id;

      INSERT INTO skyline_form_questions (section_id, type, code, label, help_text, required, sort_order, role_visibility, role_editability, pdf_meta)
      VALUES (
        ra_sec_id,
        'instruction_block',
        NULL,
        'Reasonable Adjustment',
        'Reasonable Adjustment: See Appendix A – Reasonable Adjustments for details and to record any adjustments applied.',
        false,
        0,
        '{"student": true, "trainer": true, "office": true}'::jsonb,
        '{"student": false, "trainer": false, "office": false}'::jsonb,
        '{}'::jsonb
      );
    END IF;
  END LOOP;
END $$;
