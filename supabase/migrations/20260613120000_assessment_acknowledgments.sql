-- Track when a student explicitly acknowledged an assessment outcome (audit trail).

CREATE TABLE IF NOT EXISTS public.skyline_assessment_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id BIGINT NOT NULL REFERENCES public.skyline_students(id) ON DELETE CASCADE,
  instance_id BIGINT NOT NULL,
  form_name TEXT NOT NULL,
  outcome_label TEXT NOT NULL,
  outcome_kind TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skyline_assessment_ack_student_instance UNIQUE (student_id, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_ack_student_id
  ON public.skyline_assessment_acknowledgments (student_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.skyline_assessment_acknowledgments TO anon, authenticated, service_role;
