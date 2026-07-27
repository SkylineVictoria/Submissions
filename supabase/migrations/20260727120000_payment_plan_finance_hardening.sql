-- Payment plan finance hardening:
-- - student-specific fee snapshot + adjustment reason
-- - payment period on template + assignment
-- - status/paid_amount invariants (server-side)
-- - calendar-month schedule copy (no day-offset drift)
-- - atomic payment update + pending reorder RPCs
-- - audit log + read-only inconsistency diagnostic view
-- Does NOT rewrite historical payment rows.

-- ---------------------------------------------------------------------------
-- 1. Schema extensions
-- ---------------------------------------------------------------------------

ALTER TABLE public.skyline_payment_plans
  ADD COLUMN IF NOT EXISTS payment_period TEXT NOT NULL DEFAULT 'monthly'
    CHECK (payment_period IN ('weekly', 'fortnightly', 'monthly', 'custom'));

ALTER TABLE public.skyline_student_payment_plans
  ADD COLUMN IF NOT EXISTS template_total_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS assigned_total_amount NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT,
  ADD COLUMN IF NOT EXISTS payment_period TEXT NOT NULL DEFAULT 'monthly'
    CHECK (payment_period IN ('weekly', 'fortnightly', 'monthly', 'custom')),
  ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

-- Backfill assignment fee snapshot from template total (historical assignments).
UPDATE public.skyline_student_payment_plans spp
SET
  template_total_amount = COALESCE(spp.template_total_amount, p.total_amount),
  assigned_total_amount = COALESCE(spp.assigned_total_amount, p.total_amount),
  payment_period = COALESCE(spp.payment_period, COALESCE(p.payment_period, 'monthly')),
  is_finalized = COALESCE(spp.is_finalized, true),
  finalized_at = COALESCE(spp.finalized_at, spp.assigned_at)
FROM public.skyline_payment_plans p
WHERE p.id = spp.payment_plan_id
  AND (
    spp.template_total_amount IS NULL
    OR spp.assigned_total_amount IS NULL
    OR spp.finalized_at IS NULL
  );

ALTER TABLE public.skyline_student_payment_plan_installments
  ADD COLUMN IF NOT EXISTS waived_amount NUMERIC(12, 2) NOT NULL DEFAULT 0
    CHECK (waived_amount >= 0),
  ADD COLUMN IF NOT EXISTS waiver_reason TEXT,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- Backfill waived_amount for existing waived rows (full waiver of amount due).
UPDATE public.skyline_student_payment_plan_installments
SET
  waived_amount = amount,
  waiver_reason = COALESCE(NULLIF(trim(waiver_reason), ''), NULLIF(trim(notes), ''), 'Legacy waiver')
WHERE status = 'waived'
  AND (waived_amount = 0 OR waiver_reason IS NULL);

CREATE TABLE IF NOT EXISTS public.skyline_payment_plan_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id BIGINT REFERENCES public.skyline_students(id) ON DELETE SET NULL,
  student_payment_plan_id BIGINT REFERENCES public.skyline_student_payment_plans(id) ON DELETE SET NULL,
  installment_id BIGINT,
  operation TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  previous_paid_amount NUMERIC(12, 2),
  new_paid_amount NUMERIC(12, 2),
  payment_date DATE,
  waiver_reason TEXT,
  fee_adjustment NUMERIC(12, 2),
  adjustment_reason TEXT,
  previous_sequence INT,
  new_sequence INT,
  details JSONB,
  changed_by BIGINT REFERENCES public.skyline_users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  operation_source TEXT NOT NULL DEFAULT 'rpc'
);

CREATE INDEX IF NOT EXISTS idx_payment_plan_audit_assignment
  ON public.skyline_payment_plan_audit (student_payment_plan_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_plan_audit_student
  ON public.skyline_payment_plan_audit (student_id, changed_at DESC);

GRANT SELECT, INSERT ON public.skyline_payment_plan_audit TO authenticated, service_role;
GRANT SELECT ON public.skyline_payment_plan_audit TO anon;

-- ---------------------------------------------------------------------------
-- 2. Read-only diagnostic for inconsistent historical statuses (no auto-fix)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.skyline_payment_installment_inconsistencies
WITH (security_invoker = true) AS
SELECT
  s.id AS student_id,
  s.name AS student_name,
  p.id AS payment_plan_id,
  p.plan_name,
  spp.id AS student_payment_plan_id,
  si.id AS installment_id,
  si.installment_number,
  si.due_date,
  si.amount AS due_amount,
  si.paid_amount,
  si.status,
  si.payment_date,
  CASE
    WHEN si.status = 'paid' AND si.paid_amount < si.amount THEN 'paid_less_than_due'
    WHEN si.status = 'paid' AND si.paid_amount = 0 THEN 'paid_with_zero'
    WHEN si.status = 'pending' AND si.paid_amount > 0 THEN 'pending_with_paid'
    ELSE 'other'
  END AS issue_code
FROM public.skyline_student_payment_plan_installments si
JOIN public.skyline_student_payment_plans spp ON spp.id = si.student_payment_plan_id
JOIN public.skyline_payment_plans p ON p.id = spp.payment_plan_id
JOIN public.skyline_students s ON s.id = spp.student_id
WHERE
  (si.status = 'paid' AND si.paid_amount < si.amount)
  OR (si.status = 'paid' AND si.paid_amount = 0)
  OR (si.status = 'pending' AND si.paid_amount > 0);

GRANT SELECT ON public.skyline_payment_installment_inconsistencies TO anon, authenticated, service_role;

COMMENT ON VIEW public.skyline_payment_installment_inconsistencies IS
  'Read-only diagnostic of inconsistent installment status/paid_amount pairs. Do not auto-rewrite.';

-- ---------------------------------------------------------------------------
-- 3. Helpers: calendar period arithmetic + status validation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.skyline_add_payment_period(p_start DATE, p_period TEXT, p_index INT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_i INT := GREATEST(p_index, 0);
BEGIN
  IF p_start IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_period = 'weekly' THEN
    RETURN (p_start + (v_i * 7));
  ELSIF p_period = 'fortnightly' THEN
    RETURN (p_start + (v_i * 14));
  ELSIF p_period = 'custom' THEN
    -- Custom: caller supplies dates; index 0 returns start as fallback.
    RETURN (p_start + (v_i || ' months')::interval)::date;
  ELSE
    -- monthly (default): calendar months, Postgres clamps month-end safely.
    RETURN (p_start + (v_i || ' months')::interval)::date;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_validate_installment_payment_state(
  p_amount NUMERIC,
  p_paid_amount NUMERIC,
  p_status TEXT,
  p_payment_date DATE,
  p_waived_amount NUMERIC,
  p_waiver_reason TEXT
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_amount NUMERIC(12, 2) := round(COALESCE(p_amount, 0), 2);
  v_paid NUMERIC(12, 2) := round(COALESCE(p_paid_amount, 0), 2);
  v_waived NUMERIC(12, 2) := round(COALESCE(p_waived_amount, 0), 2);
  v_status TEXT := lower(trim(COALESCE(p_status, 'pending')));
BEGIN
  IF v_paid < 0 THEN
    RAISE EXCEPTION 'Paid amount cannot be negative.';
  END IF;
  IF v_paid > v_amount THEN
    RAISE EXCEPTION 'Paid amount cannot exceed the instalment amount.';
  END IF;
  IF v_waived < 0 THEN
    RAISE EXCEPTION 'Waived amount cannot be negative.';
  END IF;
  IF v_waived > v_amount THEN
    RAISE EXCEPTION 'Waived amount cannot exceed the instalment amount.';
  END IF;

  IF v_status = 'paid' THEN
    IF v_paid <> v_amount OR v_amount <= 0 THEN
      RAISE EXCEPTION
        'Paid amount does not match the instalment amount. Mark this payment as Partial or record the full payment before selecting Paid.';
    END IF;
    IF p_payment_date IS NULL THEN
      RAISE EXCEPTION 'Payment date is required when status is Paid.';
    END IF;
  ELSIF v_status = 'partial' THEN
    IF v_paid <= 0 OR v_paid >= v_amount THEN
      RAISE EXCEPTION 'Partial status requires paid amount greater than 0 and less than the instalment amount.';
    END IF;
  ELSIF v_status = 'pending' THEN
    IF v_paid <> 0 THEN
      RAISE EXCEPTION 'Pending status requires paid amount of 0.';
    END IF;
  ELSIF v_status = 'waived' THEN
    IF NULLIF(trim(COALESCE(p_waiver_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Waiver requires a mandatory reason.';
    END IF;
    IF v_paid <> 0 THEN
      RAISE EXCEPTION 'Waived instalments cannot record cash received. Use Partial for cash, or clear paid amount for a full waiver.';
    END IF;
  ELSIF v_status = 'overdue' THEN
    -- Legacy informational status: treat like pending/partial cash rules.
    IF v_paid < 0 OR v_paid > v_amount THEN
      RAISE EXCEPTION 'Invalid paid amount for overdue instalment.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Invalid instalment status: %', p_status;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_student_installment_payment_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Do not rewrite historical rows on unrelated updates; only validate when
  -- payment fields / status change (or on insert).
  IF TG_OP = 'INSERT'
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
    OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
    OR NEW.waived_amount IS DISTINCT FROM OLD.waived_amount
    OR NEW.waiver_reason IS DISTINCT FROM OLD.waiver_reason
    OR NEW.amount IS DISTINCT FROM OLD.amount
  THEN
    PERFORM public.skyline_validate_installment_payment_state(
      NEW.amount,
      NEW.paid_amount,
      NEW.status,
      NEW.payment_date,
      NEW.waived_amount,
      COALESCE(NEW.waiver_reason, NEW.notes)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_installment_payment_validate
  ON public.skyline_student_payment_plan_installments;
CREATE TRIGGER trg_student_installment_payment_validate
  BEFORE INSERT OR UPDATE ON public.skyline_student_payment_plan_installments
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_student_installment_payment_validate();

-- ---------------------------------------------------------------------------
-- 4. Guard: lock commercial schedule after assignment finalization;
--    allow payment fields; allow reorder via session flag.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.skyline_student_payment_plan_installments_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan_status TEXT;
  v_finalized BOOLEAN;
  v_reorder TEXT;
BEGIN
  SELECT p.status, COALESCE(spp.is_finalized, true)
  INTO v_plan_status, v_finalized
  FROM public.skyline_student_payment_plans spp
  JOIN public.skyline_payment_plans p ON p.id = spp.payment_plan_id
  WHERE spp.id = COALESCE(NEW.student_payment_plan_id, OLD.student_payment_plan_id);

  v_reorder := current_setting('skyline.allow_installment_reorder', true);

  IF TG_OP = 'DELETE' THEN
    IF v_plan_status = 'confirmed' OR v_finalized THEN
      RAISE EXCEPTION 'Cannot delete installments on a finalized payment plan assignment';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_plan_status = 'confirmed' OR v_finalized THEN
      -- Assignment RPC inserts under a temporary bypass flag.
      IF current_setting('skyline.allow_assignment_insert', true) IS DISTINCT FROM 'true' THEN
        RAISE EXCEPTION 'Cannot add installments to a finalized payment plan assignment';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF v_reorder = 'true' THEN
    -- Reorder RPC may swap amount/notes only; due date + number stay put.
    IF NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.installment_number IS DISTINCT FROM OLD.installment_number
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
      OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
      OR NEW.waived_amount IS DISTINCT FROM OLD.waived_amount THEN
      RAISE EXCEPTION 'Reorder may only move pending instalment amounts between schedule slots';
    END IF;
    RETURN NEW;
  END IF;

  IF (v_plan_status = 'confirmed' OR v_finalized)
    AND (
      NEW.amount IS DISTINCT FROM OLD.amount
      OR NEW.due_date IS DISTINCT FROM OLD.due_date
      OR NEW.installment_number IS DISTINCT FROM OLD.installment_number
    ) THEN
    RAISE EXCEPTION 'Cannot change installment amount or due date on a finalized payment plan';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Calendar-aware copy (amounts from template; dates from assignment start)
-- ---------------------------------------------------------------------------

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
  v_period TEXT;
  r RECORD;
  v_idx INT := 0;
BEGIN
  SELECT * INTO v_spp FROM public.skyline_student_payment_plans WHERE id = p_student_payment_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student payment plan assignment not found';
  END IF;

  SELECT * INTO v_plan FROM public.skyline_payment_plans WHERE id = v_spp.payment_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment plan not found';
  END IF;

  v_period := COALESCE(v_spp.payment_period, v_plan.payment_period, 'monthly');

  PERFORM set_config('skyline.allow_assignment_insert', 'true', true);

  DELETE FROM public.skyline_student_payment_plan_installments
  WHERE student_payment_plan_id = p_student_payment_plan_id;

  FOR r IN
    SELECT installment_number, due_date, amount
    FROM public.skyline_payment_plan_installments
    WHERE payment_plan_id = v_plan.id
    ORDER BY installment_number
  LOOP
    INSERT INTO public.skyline_student_payment_plan_installments (
      student_payment_plan_id, installment_number, due_date, amount, status, paid_amount, payment_date
    ) VALUES (
      p_student_payment_plan_id,
      r.installment_number,
      public.skyline_add_payment_period(v_spp.start_date, v_period, v_idx),
      r.amount,
      'pending',
      0,
      NULL
    );
    v_idx := v_idx + 1;
  END LOOP;

  PERFORM set_config('skyline.allow_assignment_insert', 'false', true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Assign with installments: fee override, period, validation, no auto-paid
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.skyline_assign_payment_plan_student_with_installments(BIGINT, BIGINT, DATE, BIGINT, JSONB);

CREATE OR REPLACE FUNCTION public.skyline_assign_payment_plan_student_with_installments(
  p_plan_id BIGINT,
  p_student_id BIGINT,
  p_start_date DATE DEFAULT NULL,
  p_assigned_by BIGINT DEFAULT NULL,
  p_installments JSONB DEFAULT NULL,
  p_assigned_total_amount NUMERIC DEFAULT NULL,
  p_adjustment_reason TEXT DEFAULT NULL,
  p_payment_period TEXT DEFAULT NULL
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
  v_schedule_total NUMERIC(12, 2) := 0;
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

  PERFORM set_config('skyline.allow_assignment_insert', 'true', true);

  INSERT INTO public.skyline_student_payment_plans (
    payment_plan_id, student_id, start_date, assigned_by,
    template_total_amount, assigned_total_amount, adjustment_amount, adjustment_reason,
    payment_period, is_finalized, finalized_at
  ) VALUES (
    p_plan_id, p_student_id, v_start, p_assigned_by,
    v_plan.total_amount, v_assigned_total, v_adjustment,
    CASE WHEN v_adjustment = 0 THEN NULL ELSE NULLIF(trim(p_adjustment_reason), '') END,
    v_period, true, now()
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
    is_finalized = true,
    finalized_at = now(),
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
        -- Never auto-mark Paid / Partial during assignment.
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
    END LOOP;

    IF round(v_schedule_total, 2) <> v_assigned_total THEN
      RAISE EXCEPTION 'Instalment total must equal the assigned course fee.';
    END IF;
  ELSE
    SELECT COUNT(*)::int INTO v_tpl_count
    FROM public.skyline_payment_plan_installments
    WHERE payment_plan_id = p_plan_id;

    IF v_tpl_count > 0 THEN
      PERFORM public.skyline_copy_payment_plan_installments_to_student(v_assignment_id);

      SELECT COALESCE(SUM(amount), 0) INTO v_schedule_total
      FROM public.skyline_student_payment_plan_installments
      WHERE student_payment_plan_id = v_assignment_id;

      IF round(v_schedule_total, 2) <> v_assigned_total THEN
        RAISE EXCEPTION 'Instalment total must equal the assigned course fee. Provide a custom schedule when overriding the fee.';
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
      'start_date', v_start
    )
  );

  PERFORM set_config('skyline.allow_assignment_insert', 'false', true);
  RETURN v_assignment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_assign_payment_plan_student_with_installments(BIGINT, BIGINT, DATE, BIGINT, JSONB, NUMERIC, TEXT, TEXT)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Atomic payment update RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.skyline_update_student_installment_payment(
  p_installment_id BIGINT,
  p_status TEXT,
  p_paid_amount NUMERIC,
  p_payment_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_waived_amount NUMERIC DEFAULT NULL,
  p_waiver_reason TEXT DEFAULT NULL,
  p_payment_reference TEXT DEFAULT NULL,
  p_changed_by BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.skyline_student_payment_plan_installments%ROWTYPE;
  v_student_id BIGINT;
  v_status TEXT;
  v_paid NUMERIC(12, 2);
  v_waived NUMERIC(12, 2);
  v_waiver TEXT;
BEGIN
  SELECT * INTO v_row
  FROM public.skyline_student_payment_plan_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installment not found';
  END IF;

  SELECT spp.student_id INTO v_student_id
  FROM public.skyline_student_payment_plans spp
  WHERE spp.id = v_row.student_payment_plan_id;

  v_status := lower(trim(COALESCE(p_status, v_row.status)));
  v_paid := round(COALESCE(p_paid_amount, v_row.paid_amount), 2);
  v_waiver := NULLIF(trim(COALESCE(p_waiver_reason, v_row.waiver_reason, '')), '');
  v_waived := round(COALESCE(p_waived_amount, v_row.waived_amount), 2);

  IF v_status = 'waived' THEN
    IF v_waived <= 0 THEN
      v_waived := round(v_row.amount, 2);
    END IF;
    v_paid := 0;
  ELSIF v_status IN ('pending', 'overdue') AND v_paid = 0 THEN
    v_waived := 0;
    v_waiver := NULL;
  ELSIF v_status IN ('paid', 'partial') THEN
    v_waived := 0;
    v_waiver := NULL;
  END IF;

  PERFORM public.skyline_validate_installment_payment_state(
    v_row.amount, v_paid, v_status, p_payment_date, v_waived, COALESCE(v_waiver, p_notes)
  );

  UPDATE public.skyline_student_payment_plan_installments
  SET
    status = v_status,
    paid_amount = v_paid,
    payment_date = CASE
      WHEN v_status IN ('pending') THEN NULL
      WHEN v_status = 'waived' THEN COALESCE(p_payment_date, CURRENT_DATE)
      ELSE p_payment_date
    END,
    notes = NULLIF(trim(COALESCE(p_notes, '')), ''),
    waived_amount = v_waived,
    waiver_reason = v_waiver,
    payment_reference = NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
    updated_at = now()
  WHERE id = p_installment_id;

  INSERT INTO public.skyline_payment_plan_audit (
    student_id, student_payment_plan_id, installment_id, operation,
    previous_status, new_status, previous_paid_amount, new_paid_amount,
    payment_date, waiver_reason, changed_by
  ) VALUES (
    v_student_id, v_row.student_payment_plan_id, p_installment_id, 'record_payment',
    v_row.status, v_status, v_row.paid_amount, v_paid,
    p_payment_date, v_waiver, p_changed_by
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_update_student_installment_payment(BIGINT, TEXT, NUMERIC, DATE, TEXT, NUMERIC, TEXT, TEXT, BIGINT)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Reorder pending instalment amounts across schedule slots
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.skyline_reorder_pending_student_installments(
  p_assignment_id BIGINT,
  p_ordered_installment_ids BIGINT[],
  p_changed_by BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_student_id BIGINT;
  v_slot RECORD;
  v_payloads JSONB := '[]'::jsonb;
  v_id BIGINT;
  v_i INT := 0;
  v_payload JSONB;
  v_prev_seq INT;
  v_new_seq INT;
BEGIN
  SELECT student_id INTO v_student_id
  FROM public.skyline_student_payment_plans
  WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found';
  END IF;

  IF p_ordered_installment_ids IS NULL OR array_length(p_ordered_installment_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Ordered installment ids are required';
  END IF;

  -- Validate all ids are pending rows on this assignment.
  FOR v_i IN 1 .. array_length(p_ordered_installment_ids, 1) LOOP
    v_id := p_ordered_installment_ids[v_i];
    SELECT installment_number INTO v_prev_seq
    FROM public.skyline_student_payment_plan_installments
    WHERE id = v_id AND student_payment_plan_id = p_assignment_id AND status = 'pending'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only Pending instalments can be reordered. Settled rows are locked.';
    END IF;
  END LOOP;

  -- Capture payloads in the requested order.
  FOREACH v_id IN ARRAY p_ordered_installment_ids LOOP
    SELECT jsonb_build_object(
      'amount', amount,
      'notes', notes,
      'from_number', installment_number,
      'id', id
    )
    INTO v_payload
    FROM public.skyline_student_payment_plan_installments
    WHERE id = v_id;

    v_payloads := v_payloads || jsonb_build_array(v_payload);
  END LOOP;

  PERFORM set_config('skyline.allow_installment_reorder', 'true', true);

  v_i := 0;
  FOR v_slot IN
    SELECT id, installment_number, due_date
    FROM public.skyline_student_payment_plan_installments
    WHERE student_payment_plan_id = p_assignment_id
      AND id = ANY (p_ordered_installment_ids)
    ORDER BY installment_number
  LOOP
    v_payload := v_payloads -> v_i;
    UPDATE public.skyline_student_payment_plan_installments
    SET
      amount = (v_payload ->> 'amount')::numeric,
      notes = NULLIF(v_payload ->> 'notes', '')
    WHERE id = v_slot.id;

    v_prev_seq := (v_payload ->> 'from_number')::int;
    v_new_seq := v_slot.installment_number;

    INSERT INTO public.skyline_payment_plan_audit (
      student_id, student_payment_plan_id, installment_id, operation,
      previous_sequence, new_sequence, changed_by, details
    ) VALUES (
      v_student_id, p_assignment_id, v_slot.id, 'reorder_installment',
      v_prev_seq, v_new_seq, p_changed_by,
      jsonb_build_object(
        'due_date', v_slot.due_date,
        'amount', (v_payload ->> 'amount')::numeric,
        'from_installment_id', (v_payload ->> 'id')::bigint
      )
    );

    v_i := v_i + 1;
  END LOOP;

  PERFORM set_config('skyline.allow_installment_reorder', 'false', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_reorder_pending_student_installments(BIGINT, BIGINT[], BIGINT)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Refresh summary views with assignment fee snapshot fields
-- ---------------------------------------------------------------------------

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
  p.installment_count,
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

DROP VIEW IF EXISTS public.skyline_payment_plan_summary CASCADE;

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
  p.payment_period,
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

GRANT SELECT ON public.skyline_payment_plan_summary TO anon, authenticated, service_role;
