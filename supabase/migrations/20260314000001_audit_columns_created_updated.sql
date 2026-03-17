-- Audit columns: created_at, created_by, updated_at, updated_by
-- created_by / updated_by reference skyline_users(id); all nullable for existing rows.

-- Helper: set updated_at to now() on row update
CREATE OR REPLACE FUNCTION skyline_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- skyline_forms (has created_at)
ALTER TABLE skyline_forms ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_forms ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_forms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_forms_updated_at ON skyline_forms;
CREATE TRIGGER skyline_forms_updated_at BEFORE UPDATE ON skyline_forms FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_form_steps
ALTER TABLE skyline_form_steps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE skyline_form_steps ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_steps ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_steps ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_form_steps_updated_at ON skyline_form_steps;
CREATE TRIGGER skyline_form_steps_updated_at BEFORE UPDATE ON skyline_form_steps FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_form_sections
ALTER TABLE skyline_form_sections ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE skyline_form_sections ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_sections ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_sections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_form_sections_updated_at ON skyline_form_sections;
CREATE TRIGGER skyline_form_sections_updated_at BEFORE UPDATE ON skyline_form_sections FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_form_questions
ALTER TABLE skyline_form_questions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE skyline_form_questions ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_questions ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_questions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_form_questions_updated_at ON skyline_form_questions;
CREATE TRIGGER skyline_form_questions_updated_at BEFORE UPDATE ON skyline_form_questions FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_form_question_options
ALTER TABLE skyline_form_question_options ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE skyline_form_question_options ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_question_options ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_question_options ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_form_question_options_updated_at ON skyline_form_question_options;
CREATE TRIGGER skyline_form_question_options_updated_at BEFORE UPDATE ON skyline_form_question_options FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_form_question_rows
ALTER TABLE skyline_form_question_rows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE skyline_form_question_rows ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_question_rows ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_question_rows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_form_question_rows_updated_at ON skyline_form_question_rows;
CREATE TRIGGER skyline_form_question_rows_updated_at BEFORE UPDATE ON skyline_form_question_rows FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_form_instances (has created_at)
ALTER TABLE skyline_form_instances ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_instances ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_instances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_form_instances_updated_at ON skyline_form_instances;
CREATE TRIGGER skyline_form_instances_updated_at BEFORE UPDATE ON skyline_form_instances FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_form_answers (has updated_at)
ALTER TABLE skyline_form_answers ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE skyline_form_answers ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_form_answers ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
DROP TRIGGER IF EXISTS skyline_form_answers_updated_at ON skyline_form_answers;
CREATE TRIGGER skyline_form_answers_updated_at BEFORE UPDATE ON skyline_form_answers FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_students (has created_at)
ALTER TABLE skyline_students ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_students ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_students_updated_at ON skyline_students;
CREATE TRIGGER skyline_students_updated_at BEFORE UPDATE ON skyline_students FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_batches (has created_at)
ALTER TABLE skyline_batches ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_batches ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_batches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_batches_updated_at ON skyline_batches;
CREATE TRIGGER skyline_batches_updated_at BEFORE UPDATE ON skyline_batches FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_users (has created_at, updated_at from trainers table)
ALTER TABLE skyline_users ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
DROP TRIGGER IF EXISTS skyline_users_updated_at ON skyline_users;
CREATE TRIGGER skyline_users_updated_at BEFORE UPDATE ON skyline_users FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

-- skyline_courses (has created_at)
ALTER TABLE skyline_courses ADD COLUMN IF NOT EXISTS created_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_courses ADD COLUMN IF NOT EXISTS updated_by BIGINT REFERENCES skyline_users(id);
ALTER TABLE skyline_courses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
DROP TRIGGER IF EXISTS skyline_courses_updated_at ON skyline_courses;
CREATE TRIGGER skyline_courses_updated_at BEFORE UPDATE ON skyline_courses FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();
