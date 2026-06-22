-- Reject batch assignment when student is not actively enrolled in the batch course.
CREATE OR REPLACE FUNCTION public.skyline_enforce_student_batch_course()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_course_id bigint;
BEGIN
  IF NEW.batch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.batch_id IS NOT DISTINCT FROM NEW.batch_id THEN
    RETURN NEW;
  END IF;

  SELECT course_id INTO v_batch_course_id
  FROM public.skyline_batches
  WHERE id = NEW.batch_id;

  IF v_batch_course_id IS NULL THEN
    RAISE EXCEPTION 'Batch has no course assigned';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.skyline_student_courses sc
    WHERE sc.student_id = NEW.id
      AND sc.course_id = v_batch_course_id
      AND sc.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Student cannot be added to this batch because the student is not enrolled in the batch course.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skyline_students_batch_course_check ON public.skyline_students;
CREATE TRIGGER skyline_students_batch_course_check
  BEFORE INSERT OR UPDATE OF batch_id ON public.skyline_students
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_enforce_student_batch_course();
