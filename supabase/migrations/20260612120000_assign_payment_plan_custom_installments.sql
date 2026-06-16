-- Assign a student with a custom per-student installment schedule (dates, amounts, waivers, first payment).

CREATE OR REPLACE FUNCTION public.skyline_assign_payment_plan_student_with_installments(
  p_plan_id BIGINT,
  p_student_id BIGINT,
  p_start_date DATE DEFAULT NULL,
  p_assigned_by BIGINT DEFAULT NULL,
  p_installments JSONB DEFAULT NULL
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
  r RECORD;
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

  DELETE FROM public.skyline_student_payment_plan_installments
  WHERE student_payment_plan_id = v_assignment_id;

  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'array' AND jsonb_array_length(p_installments) > 0 THEN
    FOR r IN
      SELECT *
      FROM jsonb_to_recordset(p_installments) AS x(
        installment_number INT,
        due_date DATE,
        amount NUMERIC(12, 2),
        status TEXT,
        paid_amount NUMERIC(12, 2),
        payment_date DATE,
        notes TEXT
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

      INSERT INTO public.skyline_student_payment_plan_installments (
        student_payment_plan_id,
        installment_number,
        due_date,
        amount,
        status,
        paid_amount,
        payment_date,
        notes
      ) VALUES (
        v_assignment_id,
        r.installment_number,
        r.due_date,
        round(r.amount, 2),
        COALESCE(NULLIF(trim(r.status), ''), 'pending'),
        round(COALESCE(r.paid_amount, 0), 2),
        r.payment_date,
        NULLIF(trim(r.notes), '')
      );
    END LOOP;
  ELSE
    SELECT COUNT(*)::int INTO v_tpl_count
    FROM public.skyline_payment_plan_installments
    WHERE payment_plan_id = p_plan_id;

    IF v_tpl_count > 0 THEN
      PERFORM public.skyline_copy_payment_plan_installments_to_student(v_assignment_id);
    END IF;
  END IF;

  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_assign_payment_plan_student_with_installments(BIGINT, BIGINT, DATE, BIGINT, JSONB)
  TO anon, authenticated, service_role;
