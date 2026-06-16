-- Payment plan templates (reusable, like courses — not bound to a single student or course).

CREATE TABLE IF NOT EXISTS public.skyline_payment_plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_name TEXT NOT NULL,
  total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount > 0),
  currency TEXT NOT NULL DEFAULT 'AUD',
  installment_count INT NOT NULL CHECK (installment_count >= 1),
  start_date DATE NOT NULL,
  calculation_mode TEXT NOT NULL CHECK (calculation_mode IN ('equal', 'uneven', 'custom')),
  regular_monthly_amount NUMERIC(12, 2),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  confirmed_at TIMESTAMPTZ,
  confirmed_by BIGINT REFERENCES public.skyline_users(id),
  created_by BIGINT REFERENCES public.skyline_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Template installment schedule (master copy on the plan; copied per student on assign / confirm).
CREATE TABLE IF NOT EXISTS public.skyline_payment_plan_installments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_plan_id BIGINT NOT NULL REFERENCES public.skyline_payment_plans(id) ON DELETE CASCADE,
  installment_number INT NOT NULL CHECK (installment_number >= 1),
  due_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_plan_id, installment_number)
);

-- Many-to-many: one payment plan template → many students (like skyline_student_courses).
CREATE TABLE IF NOT EXISTS public.skyline_student_payment_plans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_plan_id BIGINT NOT NULL REFERENCES public.skyline_payment_plans(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES public.skyline_students(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by BIGINT REFERENCES public.skyline_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_plan_id, student_id)
);

-- Per-student installment rows (payment tracking); schedule locked when plan template is confirmed.
CREATE TABLE IF NOT EXISTS public.skyline_student_payment_plan_installments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_payment_plan_id BIGINT NOT NULL REFERENCES public.skyline_student_payment_plans(id) ON DELETE CASCADE,
  installment_number INT NOT NULL CHECK (installment_number >= 1),
  due_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'partial', 'overdue', 'waived')),
  paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  payment_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_payment_plan_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_payment_plans_status ON public.skyline_payment_plans (status);
CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_plan_id
  ON public.skyline_payment_plan_installments (payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_student_payment_plans_plan_id
  ON public.skyline_student_payment_plans (payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_student_payment_plans_student_id
  ON public.skyline_student_payment_plans (student_id);
CREATE INDEX IF NOT EXISTS idx_student_payment_plan_installments_assignment_id
  ON public.skyline_student_payment_plan_installments (student_payment_plan_id);

CREATE OR REPLACE FUNCTION public.skyline_payment_plans_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_plans_updated_at ON public.skyline_payment_plans;
CREATE TRIGGER trg_payment_plans_updated_at
  BEFORE UPDATE ON public.skyline_payment_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_payment_plans_set_updated_at();

DROP TRIGGER IF EXISTS trg_payment_plan_installments_updated_at ON public.skyline_payment_plan_installments;
CREATE TRIGGER trg_payment_plan_installments_updated_at
  BEFORE UPDATE ON public.skyline_payment_plan_installments
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_payment_plans_set_updated_at();

DROP TRIGGER IF EXISTS trg_student_payment_plans_updated_at ON public.skyline_student_payment_plans;
CREATE TRIGGER trg_student_payment_plans_updated_at
  BEFORE UPDATE ON public.skyline_student_payment_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_payment_plans_set_updated_at();

DROP TRIGGER IF EXISTS trg_student_payment_plan_installments_updated_at ON public.skyline_student_payment_plan_installments;
CREATE TRIGGER trg_student_payment_plan_installments_updated_at
  BEFORE UPDATE ON public.skyline_student_payment_plan_installments
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_payment_plans_set_updated_at();

-- Lock template installments when plan template is confirmed.
CREATE OR REPLACE FUNCTION public.skyline_payment_plan_installments_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT p.status INTO v_status
  FROM public.skyline_payment_plans p
  WHERE p.id = COALESCE(NEW.payment_plan_id, OLD.payment_plan_id);

  IF v_status = 'confirmed' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete template installments on a confirmed payment plan';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Cannot add template installments to a confirmed payment plan';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.installment_number IS DISTINCT FROM OLD.installment_number THEN
      RAISE EXCEPTION 'Cannot change template installment schedule on a confirmed payment plan';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_plan_installments_guard ON public.skyline_payment_plan_installments;
CREATE TRIGGER trg_payment_plan_installments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.skyline_payment_plan_installments
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_payment_plan_installments_guard();

-- Lock student installment amounts/dates when parent plan template is confirmed.
CREATE OR REPLACE FUNCTION public.skyline_student_payment_plan_installments_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan_status TEXT;
BEGIN
  SELECT p.status INTO v_plan_status
  FROM public.skyline_student_payment_plans spp
  JOIN public.skyline_payment_plans p ON p.id = spp.payment_plan_id
  WHERE spp.id = COALESCE(NEW.student_payment_plan_id, OLD.student_payment_plan_id);

  IF v_plan_status = 'confirmed' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete installments on a confirmed payment plan assignment';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Cannot add installments to a confirmed payment plan assignment';
    END IF;
    IF NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.installment_number IS DISTINCT FROM OLD.installment_number THEN
      RAISE EXCEPTION 'Cannot change installment amount or due date on a confirmed payment plan';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_student_payment_plan_installments_guard ON public.skyline_student_payment_plan_installments;
CREATE TRIGGER trg_student_payment_plan_installments_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.skyline_student_payment_plan_installments
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_student_payment_plan_installments_guard();

CREATE OR REPLACE FUNCTION public.skyline_payment_plans_guard_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'confirmed' THEN
    IF NEW.total_amount IS DISTINCT FROM OLD.total_amount
      OR NEW.installment_count IS DISTINCT FROM OLD.installment_count
      OR NEW.calculation_mode IS DISTINCT FROM OLD.calculation_mode
      OR NEW.start_date IS DISTINCT FROM OLD.start_date
      OR NEW.regular_monthly_amount IS DISTINCT FROM OLD.regular_monthly_amount THEN
      RAISE EXCEPTION 'Cannot change plan totals or schedule on a confirmed payment plan';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Cannot revert a confirmed payment plan to draft';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_plans_guard_confirmed ON public.skyline_payment_plans;
CREATE TRIGGER trg_payment_plans_guard_confirmed
  BEFORE UPDATE ON public.skyline_payment_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_payment_plans_guard_confirmed();

-- Copy template installments to a student assignment (offsets due dates from assignment start_date).
CREATE OR REPLACE FUNCTION public.skyline_copy_payment_plan_installments_to_student(
  p_student_payment_plan_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_spp public.skyline_student_payment_plans%ROWTYPE;
  v_plan public.skyline_payment_plans%ROWTYPE;
  v_offset_days INT;
  r RECORD;
BEGIN
  SELECT * INTO v_spp FROM public.skyline_student_payment_plans WHERE id = p_student_payment_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student payment plan assignment not found';
  END IF;

  SELECT * INTO v_plan FROM public.skyline_payment_plans WHERE id = v_spp.payment_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment plan not found';
  END IF;

  v_offset_days := v_spp.start_date - v_plan.start_date;

  DELETE FROM public.skyline_student_payment_plan_installments
  WHERE student_payment_plan_id = p_student_payment_plan_id;

  FOR r IN
    SELECT installment_number, due_date, amount
    FROM public.skyline_payment_plan_installments
    WHERE payment_plan_id = v_plan.id
    ORDER BY installment_number
  LOOP
    INSERT INTO public.skyline_student_payment_plan_installments (
      student_payment_plan_id, installment_number, due_date, amount
    ) VALUES (
      p_student_payment_plan_id,
      r.installment_number,
      r.due_date + v_offset_days,
      r.amount
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE VIEW public.skyline_payment_plan_summary
WITH (security_invoker = true) AS
SELECT
  p.id,
  p.plan_name,
  p.total_amount,
  p.currency,
  p.installment_count,
  p.start_date,
  p.calculation_mode,
  p.regular_monthly_amount,
  p.notes,
  p.status,
  p.confirmed_at,
  p.confirmed_by,
  p.created_by,
  p.created_at,
  p.updated_at,
  COALESCE(assignments.assigned_student_count, 0) AS assigned_student_count,
  COALESCE(tpl.installment_row_count, 0) AS installment_row_count,
  COALESCE(tpl.installment_total, 0) AS installment_total,
  COALESCE(paid.total_paid, 0) AS total_paid,
  COALESCE(paid.paid_count, 0) AS paid_count,
  COALESCE(paid.pending_count, 0) AS pending_count
FROM public.skyline_payment_plans p
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int AS assigned_student_count
  FROM public.skyline_student_payment_plans spp
  WHERE spp.payment_plan_id = p.id AND spp.status = 'active'
) assignments ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS installment_row_count,
    COALESCE(SUM(i.amount), 0) AS installment_total
  FROM public.skyline_payment_plan_installments i
  WHERE i.payment_plan_id = p.id
) tpl ON true
LEFT JOIN LATERAL (
  SELECT
    COALESCE(SUM(si.paid_amount), 0) AS total_paid,
    COUNT(*) FILTER (WHERE si.status = 'paid')::int AS paid_count,
    COUNT(*) FILTER (WHERE si.status IN ('pending', 'partial', 'overdue'))::int AS pending_count
  FROM public.skyline_student_payment_plans spp
  JOIN public.skyline_student_payment_plan_installments si ON si.student_payment_plan_id = spp.id
  WHERE spp.payment_plan_id = p.id AND spp.status = 'active'
) paid ON true;

CREATE OR REPLACE VIEW public.skyline_student_payment_plan_summary
WITH (security_invoker = true) AS
SELECT
  spp.id AS assignment_id,
  spp.payment_plan_id,
  spp.student_id,
  spp.start_date AS assignment_start_date,
  spp.status AS assignment_status,
  spp.assigned_at,
  spp.assigned_by,
  p.plan_name,
  p.total_amount,
  p.currency,
  p.installment_count,
  p.calculation_mode,
  p.status AS plan_status,
  s.name AS display_student_name,
  s.email AS display_student_email,
  COALESCE(inst.installment_row_count, 0) AS installment_row_count,
  COALESCE(inst.installment_total, 0) AS installment_total,
  COALESCE(inst.total_paid, 0) AS total_paid,
  COALESCE(inst.paid_count, 0) AS paid_count,
  COALESCE(inst.pending_count, 0) AS pending_count
FROM public.skyline_student_payment_plans spp
JOIN public.skyline_payment_plans p ON p.id = spp.payment_plan_id
JOIN public.skyline_students s ON s.id = spp.student_id
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::int AS installment_row_count,
    COALESCE(SUM(i.amount), 0) AS installment_total,
    COALESCE(SUM(i.paid_amount), 0) AS total_paid,
    COUNT(*) FILTER (WHERE i.status = 'paid')::int AS paid_count,
    COUNT(*) FILTER (WHERE i.status IN ('pending', 'partial', 'overdue'))::int AS pending_count
  FROM public.skyline_student_payment_plan_installments i
  WHERE i.student_payment_plan_id = spp.id
) inst ON true;

CREATE OR REPLACE FUNCTION public.skyline_generate_payment_plan_installments(
  p_plan_id BIGINT,
  p_regular_monthly_amount NUMERIC DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.skyline_payment_plans%ROWTYPE;
  v_count INT;
  v_total NUMERIC(12, 2);
  v_base NUMERIC(12, 2);
  v_regular NUMERIC(12, 2);
  v_sum_prior NUMERIC(12, 2);
  v_last NUMERIC(12, 2);
  v_i INT;
  v_spp RECORD;
BEGIN
  SELECT * INTO v_plan FROM public.skyline_payment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment plan not found';
  END IF;
  IF v_plan.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft payment plans can generate template installments';
  END IF;
  IF v_plan.calculation_mode NOT IN ('equal', 'uneven') THEN
    RAISE EXCEPTION 'Generate installments is only for equal or uneven calculation modes';
  END IF;

  v_count := v_plan.installment_count;
  v_total := round(v_plan.total_amount, 2);

  DELETE FROM public.skyline_payment_plan_installments WHERE payment_plan_id = p_plan_id;

  IF v_plan.calculation_mode = 'equal' THEN
    v_base := round(v_total / v_count, 2);
    v_sum_prior := 0;
    FOR v_i IN 1..v_count LOOP
      IF v_i < v_count THEN
        INSERT INTO public.skyline_payment_plan_installments (
          payment_plan_id, installment_number, due_date, amount
        ) VALUES (
          p_plan_id, v_i,
          (v_plan.start_date + ((v_i - 1) || ' months')::interval)::date,
          v_base
        );
        v_sum_prior := v_sum_prior + v_base;
      ELSE
        v_last := round(v_total - v_sum_prior, 2);
        IF v_last <= 0 THEN
          RAISE EXCEPTION 'Final installment must be positive (equal division)';
        END IF;
        INSERT INTO public.skyline_payment_plan_installments (
          payment_plan_id, installment_number, due_date, amount
        ) VALUES (
          p_plan_id, v_i,
          (v_plan.start_date + ((v_i - 1) || ' months')::interval)::date,
          v_last
        );
      END IF;
    END LOOP;
  ELSE
    v_regular := round(COALESCE(p_regular_monthly_amount, v_plan.regular_monthly_amount), 2);
    IF v_regular IS NULL OR v_regular <= 0 THEN
      RAISE EXCEPTION 'Regular monthly amount is required for uneven mode';
    END IF;
    IF v_count < 2 THEN
      RAISE EXCEPTION 'Uneven mode requires at least 2 installments';
    END IF;
    v_sum_prior := 0;
    FOR v_i IN 1..v_count LOOP
      IF v_i < v_count THEN
        INSERT INTO public.skyline_payment_plan_installments (
          payment_plan_id, installment_number, due_date, amount
        ) VALUES (
          p_plan_id, v_i,
          (v_plan.start_date + ((v_i - 1) || ' months')::interval)::date,
          v_regular
        );
        v_sum_prior := v_sum_prior + v_regular;
      ELSE
        v_last := round(v_total - v_sum_prior, 2);
        IF v_last <= 0 THEN
          RAISE EXCEPTION 'Final installment must be positive (uneven division)';
        END IF;
        INSERT INTO public.skyline_payment_plan_installments (
          payment_plan_id, installment_number, due_date, amount
        ) VALUES (
          p_plan_id, v_i,
          (v_plan.start_date + ((v_i - 1) || ' months')::interval)::date,
          v_last
        );
      END IF;
    END LOOP;
  END IF;

  -- Refresh student copies for assignments already on this plan (draft template regen).
  FOR v_spp IN SELECT id FROM public.skyline_student_payment_plans WHERE payment_plan_id = p_plan_id AND status = 'active'
  LOOP
    PERFORM public.skyline_copy_payment_plan_installments_to_student(v_spp.id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_assign_payment_plan_student(
  p_plan_id BIGINT,
  p_student_id BIGINT,
  p_start_date DATE DEFAULT NULL,
  p_assigned_by BIGINT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.skyline_payment_plans%ROWTYPE;
  v_assignment_id BIGINT;
  v_start DATE;
  v_tpl_count INT;
BEGIN
  SELECT * INTO v_plan FROM public.skyline_payment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment plan not found';
  END IF;

  v_start := COALESCE(p_start_date, v_plan.start_date);

  INSERT INTO public.skyline_student_payment_plans (
    payment_plan_id, student_id, start_date, assigned_by
  ) VALUES (
    p_plan_id, p_student_id, v_start, p_assigned_by
  )
  ON CONFLICT (payment_plan_id, student_id) DO UPDATE
  SET
    start_date = EXCLUDED.start_date,
    status = 'active',
    assigned_by = COALESCE(EXCLUDED.assigned_by, public.skyline_student_payment_plans.assigned_by),
    updated_at = now()
  RETURNING id INTO v_assignment_id;

  SELECT COUNT(*)::int INTO v_tpl_count
  FROM public.skyline_payment_plan_installments
  WHERE payment_plan_id = p_plan_id;

  IF v_tpl_count > 0 THEN
    PERFORM public.skyline_copy_payment_plan_installments_to_student(v_assignment_id);
  END IF;

  RETURN v_assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_unassign_payment_plan_student(
  p_plan_id BIGINT,
  p_student_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_status TEXT;
  v_paid NUMERIC(12, 2);
BEGIN
  SELECT p.status INTO v_plan_status
  FROM public.skyline_payment_plans p
  WHERE p.id = p_plan_id;

  IF v_plan_status = 'confirmed' THEN
    SELECT COALESCE(SUM(si.paid_amount), 0) INTO v_paid
    FROM public.skyline_student_payment_plans spp
    JOIN public.skyline_student_payment_plan_installments si ON si.student_payment_plan_id = spp.id
    WHERE spp.payment_plan_id = p_plan_id AND spp.student_id = p_student_id;

    IF v_paid > 0 THEN
      RAISE EXCEPTION 'Cannot remove student from a confirmed plan after payments have been recorded';
    END IF;
  END IF;

  DELETE FROM public.skyline_student_payment_plans
  WHERE payment_plan_id = p_plan_id AND student_id = p_student_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_confirm_payment_plan(
  p_plan_id BIGINT,
  p_confirmed_by BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.skyline_payment_plans%ROWTYPE;
  v_sum NUMERIC(12, 2);
  v_row_count INT;
  v_spp RECORD;
BEGIN
  SELECT * INTO v_plan FROM public.skyline_payment_plans WHERE id = p_plan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment plan not found';
  END IF;
  IF v_plan.status = 'confirmed' THEN
    RAISE EXCEPTION 'Payment plan is already confirmed';
  END IF;

  SELECT COALESCE(SUM(amount), 0), COUNT(*)::int
  INTO v_sum, v_row_count
  FROM public.skyline_payment_plan_installments
  WHERE payment_plan_id = p_plan_id;

  IF v_row_count <> v_plan.installment_count THEN
    RAISE EXCEPTION 'Installment count does not match plan (% vs %)', v_row_count, v_plan.installment_count;
  END IF;
  IF round(v_sum, 2) <> round(v_plan.total_amount, 2) THEN
    RAISE EXCEPTION 'Installment total (%) does not match plan total (%)', v_sum, v_plan.total_amount;
  END IF;

  UPDATE public.skyline_payment_plans
  SET status = 'confirmed', confirmed_at = now(), confirmed_by = p_confirmed_by
  WHERE id = p_plan_id;

  FOR v_spp IN SELECT id FROM public.skyline_student_payment_plans WHERE payment_plan_id = p_plan_id AND status = 'active'
  LOOP
    PERFORM public.skyline_copy_payment_plan_installments_to_student(v_spp.id);
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.skyline_payment_plans TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skyline_payment_plan_installments TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skyline_student_payment_plans TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skyline_student_payment_plan_installments TO anon, authenticated, service_role;
GRANT SELECT ON public.skyline_payment_plan_summary TO anon, authenticated, service_role;
GRANT SELECT ON public.skyline_student_payment_plan_summary TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skyline_generate_payment_plan_installments(BIGINT, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skyline_confirm_payment_plan(BIGINT, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skyline_assign_payment_plan_student(BIGINT, BIGINT, DATE, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skyline_unassign_payment_plan_student(BIGINT, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skyline_copy_payment_plan_installments_to_student(BIGINT) TO anon, authenticated, service_role;

COMMENT ON TABLE public.skyline_payment_plans IS 'Reusable payment plan templates (not course-bound); assign to many students.';
COMMENT ON TABLE public.skyline_student_payment_plans IS 'Students assigned to a payment plan template (many-to-many).';
COMMENT ON VIEW public.skyline_payment_plan_summary IS 'Payment plan templates with assignment and aggregate payment stats.';
COMMENT ON VIEW public.skyline_student_payment_plan_summary IS 'Per-student payment plan assignment with installment stats.';
