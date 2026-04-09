-- Student <-> course relation (many-to-many).
-- A student can be enrolled in multiple courses; a course can have many students.

CREATE TABLE IF NOT EXISTS skyline_student_courses (
  student_id BIGINT NOT NULL REFERENCES skyline_students(id) ON DELETE CASCADE,
  course_id BIGINT NOT NULL REFERENCES skyline_courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by BIGINT REFERENCES skyline_users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by BIGINT REFERENCES skyline_users(id),
  PRIMARY KEY (student_id, course_id),
  CONSTRAINT skyline_student_courses_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE INDEX IF NOT EXISTS idx_skyline_student_courses_course_id ON skyline_student_courses(course_id);
CREATE INDEX IF NOT EXISTS idx_skyline_student_courses_student_id ON skyline_student_courses(student_id);
CREATE INDEX IF NOT EXISTS idx_skyline_student_courses_course_status ON skyline_student_courses(course_id, status);

DROP TRIGGER IF EXISTS skyline_student_courses_updated_at ON skyline_student_courses;
CREATE TRIGGER skyline_student_courses_updated_at
  BEFORE UPDATE ON skyline_student_courses
  FOR EACH ROW
  EXECUTE FUNCTION skyline_set_updated_at();

