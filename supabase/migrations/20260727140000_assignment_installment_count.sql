-- Student-specific instalment count on assignment (independent of template).

ALTER TABLE public.skyline_student_payment_plans
  ADD COLUMN IF NOT EXISTS installment_count INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skyline_student_payment_plans_installment_count_check'
  ) THEN
    ALTER TABLE public.skyline_student_payment_plans
      ADD CONSTRAINT skyline_student_payment_plans_installment_count_check
      CHECK (installment_count IS NULL OR (installment_count >= 1 AND installment_count <= 60));
  END IF;
END $$;

-- Backfill from existing schedule row counts, then template count.
UPDATE public.skyline_student_payment_plans spp
SET installment_count = COALESCE(
  (
    SELECT COUNT(*)::int
    FROM public.skyline_student_payment_plan_installments si
    WHERE si.student_payment_plan_id = spp.id
  ),
  (
    SELECT p.installment_count
    FROM public.skyline_payment_plans p
    WHERE p.id = spp.payment_plan_id
  ),
  1
)
WHERE spp.installment_count IS NULL;

ALTER TABLE public.skyline_student_payment_plans
  ALTER COLUMN installment_count SET DEFAULT 1;

UPDATE public.skyline_student_payment_plans
SET installment_count = 1
WHERE installment_count IS NULL;

ALTER TABLE public.skyline_student_payment_plans
  ALTER COLUMN installment_count SET NOT NULL;

-- Replace assign RPC with installment_count parameter + validation.
DROP FUNCTION IF EXISTS public.skyline_assign_payment_plan_student_with_installments(BIGINT, BIGINT, DATE, BIGINT, JSONB, NUMERIC, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.skyline_assign_payment_plan_student_with_installments(
  p_plan_id BIGINT,
  p_student_id BIGINT,
  p_start_date DATE DEFAULT NULL,
  p_assigned_by BIGINT DEFAULT NULL,
  p_installments JSONB DEFAULT NULL,
  p_assigned_total_amount NUMERIC DEFAULT NULL,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_payment_period TEXT DEFAULT NULL,
  p_installment_count INT DEFAULT NULL
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
  v_assigned_total NUMERIC(12, 2);
  v_adjustment NUMERIC(12, 2);
  v_period TEXT;
  v_count INT;
  v_schedule_total NUMERIC(12, 2) := 0;
  v_row_count INT := 0;
  r RECORD;
  v_status TEXT;
  v_paid NUMERIC(12, 2);
  v_waived NUMERIC(12, 2);
  v_waiver_reason TEXT;
BEGIN
  SELECT * INTO v_plan FROM public.skyline_payment_plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment plan not found';
  END IF;

  v_start := COALESCE(p_start_date, v_plan.start_date);
  v_assigned_total := round(COALESCE(p_assigned_total_amount, v_plan.total_amount), 2);
  IF v_assigned_total <= 0 THEN
    RAISE EXCEPTION 'Assigned course fee must be greater than zero.';
  END IF;

  v_adjustment := round(v_assigned_total - v_plan.total_amount, 2);
  IF v_adjustment <> 0 AND NULLIF(trim(COALESCE(p_adjustment_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Adjustment reason is required when assigned fee differs from the template fee.';
  END IF;

  v_period := lower(trim(COALESCE(NULLIF(p_payment_period, ''), v_plan.payment_period, 'monthly')));
  IF v_period NOT IN ('weekly', 'fortnightly', 'monthly', 'custom') THEN
    RAISE EXCEPTION 'Invalid payment period: %', v_period;
  END IF;

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'array' AND jsonb_array_length(p_installments) > 0 THEN
    v_count := COALESCE(p_installment_count, jsonb_array_length(p_installments));
  ELSE
    v_count := COALESCE(p_installment_count, v_plan.installment_count, 1);
  END IF;

  IF v_count IS NULL OR v_count < 1 OR v_count > 60 THEN
    RAISE EXCEPTION 'Instalment count must be between 1 and 60.';
  END IF;

  PERFORM set_config('skyline.allow_assignment_insert', 'true', true);

  INSERT INTO public.skyline_student_payment_plans (
    payment_plan_id, student_id, start_date, assigned_by,
    template_total_amount, assigned_total_amount, adjustment_amount, adjustment_reason,
    payment_period, installment_count, is_finalized, finalized_at
  ) VALUES (
    p_plan_id, p_student_id, v_start, p_assigned_by,
    v_plan.total_amount, v_assigned_total, v_adjustment,
    CASE WHEN v_adjustment = 0 THEN NULL ELSE NULLIF(trim(p_adjustment_reason), '') END,
    v_period, v_count, true, now()
  )
  ON CONFLICT (payment_plan_id, student_id) DO UPDATE
  SET
    start_date = EXCLUDED.start_date,
    status = 'active',
    assigned_by = COALESCE(EXCLUDED.assigned_by, public.skyline_student_payment_plans.assigned_by),
    template_total_amount = EXCLUDED.template_total_amount,
    assigned_total_amount = EXCLUDED.assigned_total_amount,
    adjustment_amount = EXCLUDED.adjustment_amount,
    adjustment_reason = EXCLUDED.adjustment_reason,
    payment_period = EXCLUDED.payment_period,
    installment_count = EXCLUDED.installment_count,
    is_finalized = true,
    finalized_at = now(),
    updated_at = now()
  RETURNING id INTO v_assignment_id;

  DELETE FROM public.skyline_student_payment_plan_installments
  WHERE student_payment_plan_id = v_assignment_id;

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'array' AND jsonb_array_length(p_installments) > 0 THEN
    IF jsonb_array_length(p_installments) <> v_count THEN
      RAISE EXCEPTION 'Schedule must contain exactly % instalment(s).', v_count;
    END IF;

    FOR r IN
      SELECT *
      FROM jsonb_to_recordset(p_installments) AS x(
        installment_number INT,
        due_date DATE,
        amount NUMERIC(12, 2),
        status TEXT,
        paid_amount NUMERIC(12, 2),
        payment_date DATE,
        notes TEXT,
        waived_amount NUMERIC(12, 2),
        waiver_reason TEXT,
        payment_reference TEXT
      )
      ORDER BY installment_number
    LOOP
      IF r.installment_number IS NULL OR r.installment_number < 1 THEN
        RAISE EXCEPTION 'Invalid installment number';
      END IF;
      IF r.due_date IS NULL THEN
        RAISE EXCEPTION 'Due date is required for installment %', r.installment_number;
      END IF;
      IF r.amount IS NULL OR r.amount < 0 THEN
        RAISE EXCEPTION 'Amount must be zero or greater for installment %', r.installment_number;
      END IF;

      v_status := lower(trim(COALESCE(NULLIF(r.status, ''), 'pending')));
      v_paid := round(COALESCE(r.paid_amount, 0), 2);
      v_waived := round(COALESCE(r.waived_amount, 0), 2);
      v_waiver_reason := NULLIF(trim(COALESCE(r.waiver_reason, r.notes, '')), '');

      IF v_status = 'waived' THEN
        IF v_waiver_reason IS NULL THEN
          RAISE EXCEPTION 'Waiver requires a mandatory reason for installment %', r.installment_number;
        END IF;
        v_paid := 0;
        IF v_waived <= 0 THEN
          v_waived := round(r.amount, 2);
        END IF;
      ELSE
        v_status := 'pending';
        v_paid := 0;
        v_waived := 0;
        v_waiver_reason := NULL;
      END IF;

      PERFORM public.skyline_validate_installment_payment_state(
        r.amount, v_paid, v_status, NULL, v_waived, v_waiver_reason
      );

      INSERT INTO public.skyline_student_payment_plan_installments (
        student_payment_plan_id,
        installment_number,
        due_date,
        amount,
        status,
        paid_amount,
        payment_date,
        notes,
        waived_amount,
        waiver_reason,
        payment_reference
      ) VALUES (
        v_assignment_id,
        r.installment_number,
        r.due_date,
        round(r.amount, 2),
        v_status,
        v_paid,
        NULL,
        NULLIF(trim(r.notes), ''),
        v_waived,
        v_waiver_reason,
        NULLIF(trim(COALESCE(r.payment_reference, '')), '')
      );

      v_schedule_total := v_schedule_total + round(r.amount, 2);
      v_row_count := v_row_count + 1;
    END LOOP;

    IF v_row_count <> v_count THEN
      RAISE EXCEPTION 'Schedule must contain exactly % instalment(s).', v_count;
    END IF;

    IF round(v_schedule_total, 2) <> v_assigned_total THEN
      RAISE EXCEPTION 'Instalment total must equal the assigned course fee.';
    END IF;
  ELSE
    SELECT COUNT(*)::int INTO v_tpl_count
    FROM public.skyline_payment_plan_installments
    WHERE payment_plan_id = p_plan_id;

    IF v_tpl_count > 0 THEN
      PERFORM public.skyline_copy_payment_plan_installments_to_student(v_assignment_id);

      SELECT COALESCE(SUM(amount), 0), COUNT(*)::int
      INTO v_schedule_total, v_row_count
      FROM public.skyline_student_payment_plan_installments
      WHERE student_payment_plan_id = v_assignment_id;

      IF v_row_count <> v_count OR round(v_schedule_total, 2) <> v_assigned_total THEN
        RAISE EXCEPTION 'Instalment total must equal the assigned course fee. Provide a custom schedule when overriding the fee or instalment count.';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.skyline_payment_plan_audit (
    student_id, student_payment_plan_id, operation,
    fee_adjustment, adjustment_reason, changed_by, details
  ) VALUES (
    p_student_id, v_assignment_id, 'assign_plan',
    v_adjustment, NULLIF(trim(COALESCE(p_adjustment_reason, '')), ''), p_assigned_by,
    jsonb_build_object(
      'template_total', v_plan.total_amount,
      'assigned_total', v_assigned_total,
      'payment_period', v_period,
      'installment_count', v_count,
      'start_date', v_start
    )
  );

  PERFORM set_config('skyline.allow_assignment_insert', 'false', true);
  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_assign_payment_plan_student_with_installments(BIGINT, BIGINT, DATE, BIGINT, JSONB, NUMERIC, TEXT, TEXT, INT)
  TO anon, authenticated, service_role;

-- Refresh student summary view to expose assignment instalment count.
DROP VIEW IF EXISTS public.skyline_student_payment_plan_summary CASCADE;

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
  spp.template_total_amount,
  spp.assigned_total_amount,
  spp.adjustment_amount,
  spp.adjustment_reason,
  spp.payment_period,
  spp.is_finalized,
  spp.finalized_at,
  p.plan_name,
  COALESCE(spp.assigned_total_amount, p.total_amount) AS total_amount,
  p.total_amount AS template_plan_total,
  p.currency,
  COALESCE(spp.installment_count, p.installment_count) AS installment_count,
  p.installment_count AS template_installment_count,
  p.calculation_mode,
  p.payment_period AS template_payment_period,
  p.status AS plan_status,
  s.name AS display_student_name,
  s.email AS display_student_email,
  COALESCE(inst.installment_row_count, 0) AS installment_row_count,
  COALESCE(inst.installment_total, 0) AS installment_total,
  COALESCE(inst.total_paid, 0) AS total_paid,
  COALESCE(inst.total_waived, 0) AS total_waived,
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
    COALESCE(SUM(i.waived_amount), 0) AS total_waived,
    COUNT(*) FILTER (WHERE i.status = 'paid')::int AS paid_count,
    COUNT(*) FILTER (WHERE i.status IN ('pending', 'partial', 'overdue'))::int AS pending_count
  FROM public.skyline_student_payment_plan_installments i
  WHERE i.student_payment_plan_id = spp.id
) inst ON true;

GRANT SELECT ON public.skyline_student_payment_plan_summary TO anon, authenticated, service_role;
