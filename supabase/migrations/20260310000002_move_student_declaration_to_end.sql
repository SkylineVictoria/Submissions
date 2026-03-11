-- Move Student declaration to the end of student instructions (after Special needs) in all existing forms.
-- Student declaration becomes item 19; items 7-18 shift up.

DO $$
DECLARE
  intro_rec RECORD;
  decl_rec RECORD;
  max_ord int;
BEGIN
  FOR intro_rec IN
    SELECT id FROM skyline_form_steps WHERE title = 'Introductory Details'
  LOOP
    SELECT id, sort_order INTO decl_rec
    FROM skyline_form_sections
    WHERE step_id = intro_rec.id AND title = 'Student declaration'
    LIMIT 1;

    IF decl_rec.id IS NOT NULL THEN
      SELECT COALESCE(MAX(sort_order), -1) INTO max_ord
      FROM skyline_form_sections
      WHERE step_id = intro_rec.id AND id != decl_rec.id;

      UPDATE skyline_form_sections
      SET sort_order = max_ord + 1
      WHERE id = decl_rec.id;

      UPDATE skyline_form_sections
      SET sort_order = sort_order - 1
      WHERE step_id = intro_rec.id
        AND sort_order > decl_rec.sort_order
        AND id != decl_rec.id;
    END IF;
  END LOOP;
END $$;
