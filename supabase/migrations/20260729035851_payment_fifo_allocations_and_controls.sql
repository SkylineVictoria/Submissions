-- FIFO payment allocations + immutable posted payments + mandatory receipt posting.
-- Extends skyline_student_payment_transactions (does NOT duplicate ax_invoice_* tables).

-- ---------------------------------------------------------------------------
-- 1) Transaction audit / posting columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.skyline_student_payment_transactions
  ALTER COLUMN installment_id DROP NOT NULL;

ALTER TABLE public.skyline_student_payment_transactions
  ADD COLUMN IF NOT EXISTS posting_status TEXT NOT NULL DEFAULT 'posted'
    CHECK (posting_status IN ('draft', 'posted', 'corrected', 'reversed')),
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_by BIGINT REFERENCES public.skyline_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_of_transaction_id BIGINT
    REFERENCES public.skyline_student_payment_transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_by BIGINT REFERENCES public.skyline_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Existing rows are treated as posted (grandfathered; may lack receipts).
UPDATE public.skyline_student_payment_transactions
SET
  posting_status = COALESCE(posting_status, 'posted'),
  posted_at = COALESCE(posted_at, created_at),
  is_active = COALESCE(is_active, true)
WHERE posting_status IS DISTINCT FROM 'posted'
   OR posted_at IS NULL
   OR is_active IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_skyline_payment_tx_idempotency
  ON public.skyline_student_payment_transactions (student_payment_plan_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skyline_payment_tx_correction_of
  ON public.skyline_student_payment_transactions (correction_of_transaction_id);

CREATE INDEX IF NOT EXISTS idx_skyline_payment_tx_active_posted
  ON public.skyline_student_payment_transactions (student_payment_plan_id, is_active, posting_status)
  WHERE is_active = true AND posting_status = 'posted';

-- ---------------------------------------------------------------------------
-- 2) Allocations (payment → instalment)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.skyline_student_payment_allocations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_transaction_id BIGINT NOT NULL
    REFERENCES public.skyline_student_payment_transactions(id) ON DELETE CASCADE,
  installment_id BIGINT NOT NULL
    REFERENCES public.skyline_student_payment_plan_installments(id) ON DELETE CASCADE,
  allocated_amount NUMERIC(12, 2) NOT NULL CHECK (allocated_amount > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_transaction_id, installment_id)
);

CREATE INDEX IF NOT EXISTS idx_skyline_payment_alloc_tx
  ON public.skyline_student_payment_allocations (payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_skyline_payment_alloc_installment
  ON public.skyline_student_payment_allocations (installment_id);
CREATE INDEX IF NOT EXISTS idx_skyline_payment_alloc_active
  ON public.skyline_student_payment_allocations (installment_id, is_active)
  WHERE is_active = true;

COMMENT ON TABLE public.skyline_student_payment_allocations IS
  'FIFO cash allocations from a payment transaction onto one or more instalments. Receipts attach to the transaction, not the allocation.';

ALTER TABLE public.skyline_student_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skyline_payment_alloc_select ON public.skyline_student_payment_allocations;
CREATE POLICY skyline_payment_alloc_select
  ON public.skyline_student_payment_allocations
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.skyline_student_payment_allocations TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.skyline_student_payment_allocations TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Receipt audit columns (replacement history)
-- ---------------------------------------------------------------------------
ALTER TABLE public.skyline_payment_receipts
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES public.skyline_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replace_reason TEXT;

-- ---------------------------------------------------------------------------
-- 4) Helpers: staff role + recalculate instalment from allocations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_assert_payment_staff_role(
  p_user_id BIGINT,
  p_require_superadmin BOOLEAN DEFAULT false
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id <= 0 THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT lower(trim(u.role)) INTO v_role
  FROM public.skyline_users u
  WHERE u.id = p_user_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_require_superadmin THEN
    IF v_role <> 'superadmin' THEN
      RAISE EXCEPTION 'Only Super Admin can correct a posted payment.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_role NOT IN ('admin', 'superadmin') THEN
      RAISE EXCEPTION 'Forbidden.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.skyline_recalculate_installment_from_allocations(
  p_installment_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.skyline_student_payment_plan_installments%ROWTYPE;
  v_cash NUMERIC(12, 2);
  v_waived NUMERIC(12, 2);
  v_outstanding NUMERIC(12, 2);
  v_status TEXT;
  v_latest_payment_date DATE;
  v_latest_ref TEXT;
BEGIN
  SELECT * INTO v_row
  FROM public.skyline_student_payment_plan_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installment not found';
  END IF;

  SELECT COALESCE(SUM(a.allocated_amount), 0)
  INTO v_cash
  FROM public.skyline_student_payment_allocations a
  JOIN public.skyline_student_payment_transactions t ON t.id = a.payment_transaction_id
  WHERE a.installment_id = p_installment_id
    AND a.is_active = true
    AND t.is_active = true
    AND t.posting_status = 'posted'
    AND t.status IN ('paid', 'partial');

  v_cash := round(v_cash, 2);
  v_waived := round(COALESCE(v_row.waived_amount, 0), 2);

  -- Full waiver (no cash) keeps waived status.
  IF v_row.status = 'waived' AND v_cash = 0 AND v_waived > 0 THEN
    UPDATE public.skyline_student_payment_plan_installments
    SET
      paid_amount = 0,
      status = 'waived',
      updated_at = now()
    WHERE id = p_installment_id;
    RETURN;
  END IF;

  -- If previously waived but cash arrived, clear waiver settlement in favour of cash tracking.
  IF v_cash > 0 THEN
    v_waived := 0;
  END IF;

  v_outstanding := round(GREATEST(0, round(v_row.amount, 2) - v_cash - v_waived), 2);

  IF v_outstanding = 0 AND v_cash > 0 THEN
    v_status := 'paid';
  ELSIF v_cash > 0 AND v_outstanding > 0 THEN
    v_status := 'partial';
  ELSIF v_outstanding = 0 AND v_waived > 0 THEN
    v_status := 'waived';
  ELSE
    v_status := 'pending';
  END IF;

  SELECT t.payment_date, t.payment_reference
  INTO v_latest_payment_date, v_latest_ref
  FROM public.skyline_student_payment_allocations a
  JOIN public.skyline_student_payment_transactions t ON t.id = a.payment_transaction_id
  WHERE a.installment_id = p_installment_id
    AND a.is_active = true
    AND t.is_active = true
    AND t.posting_status = 'posted'
    AND t.status IN ('paid', 'partial')
  ORDER BY COALESCE(t.payment_date, t.created_at::date) DESC, t.id DESC
  LIMIT 1;

  UPDATE public.skyline_student_payment_plan_installments
  SET
    paid_amount = v_cash,
    waived_amount = v_waived,
    waiver_reason = CASE WHEN v_waived > 0 THEN v_row.waiver_reason ELSE NULL END,
    status = v_status,
    payment_date = CASE WHEN v_cash > 0 THEN v_latest_payment_date ELSE NULL END,
    payment_reference = CASE WHEN v_cash > 0 THEN COALESCE(v_latest_ref, v_row.payment_reference) ELSE v_row.payment_reference END,
    updated_at = now()
  WHERE id = p_installment_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5) FIFO allocation preview (pure computation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_preview_fifo_payment_allocation(
  p_assignment_id BIGINT,
  p_amount NUMERIC
)
RETURNS TABLE (
  installment_id BIGINT,
  installment_number INTEGER,
  due_date DATE,
  scheduled_amount NUMERIC,
  already_paid NUMERIC,
  outstanding_before NUMERIC,
  allocated_amount NUMERIC,
  outstanding_after NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC(12, 2);
  v_row RECORD;
  v_alloc NUMERIC(12, 2);
  v_out_before NUMERIC(12, 2);
BEGIN
  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  v_remaining := round(p_amount, 2);

  FOR v_row IN
    SELECT
      i.id,
      i.installment_number,
      i.due_date,
      round(i.amount, 2) AS scheduled_amount,
      round(i.paid_amount, 2) AS already_paid,
      round(i.waived_amount, 2) AS waived_amount,
      i.status
    FROM public.skyline_student_payment_plan_installments i
    WHERE i.student_payment_plan_id = p_assignment_id
      AND i.status <> 'waived'
    ORDER BY i.installment_number ASC, i.due_date ASC, i.id ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_out_before := round(GREATEST(0, v_row.scheduled_amount - v_row.already_paid - v_row.waived_amount), 2);
    IF v_out_before <= 0 THEN
      CONTINUE;
    END IF;

    v_alloc := LEAST(v_remaining, v_out_before);
    installment_id := v_row.id;
    installment_number := v_row.installment_number;
    due_date := v_row.due_date;
    scheduled_amount := v_row.scheduled_amount;
    already_paid := v_row.already_paid;
    outstanding_before := v_out_before;
    allocated_amount := v_alloc;
    outstanding_after := round(v_out_before - v_alloc, 2);
    v_remaining := round(v_remaining - v_alloc, 2);
    RETURN NEXT;
  END LOOP;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION
      'Payment exceeds the student''s outstanding balance. Maximum payment allowed is %.',
      round(p_amount - v_remaining, 2)
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_preview_fifo_payment_allocation(BIGINT, NUMERIC)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) Atomic record payment (requires receipt metadata already uploaded to SP)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_record_student_plan_payment(
  p_assignment_id BIGINT,
  p_student_id BIGINT,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_payment_reference TEXT,
  p_notes TEXT,
  p_changed_by BIGINT,
  p_idempotency_key TEXT,
  -- receipt (mandatory)
  p_sharepoint_item_id TEXT,
  p_sharepoint_drive_id TEXT,
  p_sharepoint_site_id TEXT,
  p_file_name TEXT,
  p_original_file_name TEXT,
  p_mime_type TEXT,
  p_file_size BIGINT,
  p_web_url TEXT,
  p_sharepoint_path TEXT
)
RETURNS TABLE (
  payment_transaction_id BIGINT,
  allocated_total NUMERIC,
  allocation_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_assignment public.skyline_student_payment_plans%ROWTYPE;
  v_amount NUMERIC(12, 2);
  v_existing_id BIGINT;
  v_tx_id BIGINT;
  v_alloc RECORD;
  v_alloc_count INTEGER := 0;
  v_alloc_total NUMERIC(12, 2) := 0;
  v_first_installment_id BIGINT;
  v_status TEXT;
BEGIN
  v_role := public.skyline_assert_payment_staff_role(p_changed_by, false);

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required.';
  END IF;

  IF NULLIF(trim(COALESCE(p_sharepoint_item_id, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_sharepoint_drive_id, '')), '') IS NULL
     OR NULLIF(trim(COALESCE(p_web_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Please upload the payment receipt before recording this payment.';
  END IF;

  v_amount := round(COALESCE(p_amount, 0), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  SELECT * INTO v_assignment
  FROM public.skyline_student_payment_plans
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment plan assignment not found.';
  END IF;
  IF v_assignment.student_id <> p_student_id THEN
    RAISE EXCEPTION 'Student does not match payment plan assignment.';
  END IF;

  -- Idempotent replay
  IF NULLIF(trim(COALESCE(p_idempotency_key, '')), '') IS NOT NULL THEN
    SELECT t.id INTO v_existing_id
    FROM public.skyline_student_payment_transactions t
    WHERE t.student_payment_plan_id = p_assignment_id
      AND t.idempotency_key = trim(p_idempotency_key)
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      payment_transaction_id := v_existing_id;
      SELECT COALESCE(SUM(a.allocated_amount), 0), COUNT(*)::INTEGER
      INTO allocated_total, allocation_count
      FROM public.skyline_student_payment_allocations a
      WHERE a.payment_transaction_id = v_existing_id AND a.is_active = true;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Lock outstanding instalments oldest-first
  PERFORM 1
  FROM public.skyline_student_payment_plan_installments i
  WHERE i.student_payment_plan_id = p_assignment_id
  ORDER BY i.installment_number ASC, i.id ASC
  FOR UPDATE;

  -- Validate FIFO fit (raises if overpayment)
  PERFORM 1 FROM public.skyline_preview_fifo_payment_allocation(p_assignment_id, v_amount);

  INSERT INTO public.skyline_student_payment_transactions (
    student_id,
    student_payment_plan_id,
    installment_id,
    amount,
    payment_date,
    payment_reference,
    notes,
    status,
    waived_amount,
    waiver_reason,
    created_by,
    posting_status,
    posted_at,
    posted_by,
    is_active,
    idempotency_key
  ) VALUES (
    p_student_id,
    p_assignment_id,
    NULL,
    v_amount,
    p_payment_date,
    NULLIF(trim(COALESCE(p_payment_reference, '')), ''),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'partial', -- refined after allocations
    0,
    NULL,
    p_changed_by,
    'posted',
    now(),
    p_changed_by,
    true,
    NULLIF(trim(COALESCE(p_idempotency_key, '')), '')
  )
  RETURNING id INTO v_tx_id;

  FOR v_alloc IN
    SELECT * FROM public.skyline_preview_fifo_payment_allocation(p_assignment_id, v_amount)
  LOOP
    INSERT INTO public.skyline_student_payment_allocations (
      payment_transaction_id,
      installment_id,
      allocated_amount,
      is_active
    ) VALUES (
      v_tx_id,
      v_alloc.installment_id,
      v_alloc.allocated_amount,
      true
    );
    v_alloc_count := v_alloc_count + 1;
    v_alloc_total := round(v_alloc_total + v_alloc.allocated_amount, 2);
    IF v_first_installment_id IS NULL THEN
      v_first_installment_id := v_alloc.installment_id;
    END IF;
    PERFORM public.skyline_recalculate_installment_from_allocations(v_alloc.installment_id);
  END LOOP;

  IF v_alloc_count = 0 OR v_alloc_total <> v_amount THEN
    RAISE EXCEPTION 'Allocation failed: expected % allocated, got %.', v_amount, v_alloc_total;
  END IF;

  -- Transaction status = fully applied if every affected instalment ends paid/partial correctly
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.skyline_student_payment_allocations a
      JOIN public.skyline_student_payment_plan_installments i ON i.id = a.installment_id
      WHERE a.payment_transaction_id = v_tx_id
        AND a.is_active
        AND i.status = 'partial'
    ) THEN 'partial'
    ELSE 'paid'
  END INTO v_status;

  UPDATE public.skyline_student_payment_transactions
  SET
    installment_id = v_first_installment_id,
    status = v_status,
    updated_at = now()
  WHERE id = v_tx_id;

  INSERT INTO public.skyline_payment_receipts (
    payment_transaction_id,
    student_id,
    sharepoint_item_id,
    sharepoint_drive_id,
    sharepoint_site_id,
    file_name,
    original_file_name,
    mime_type,
    file_size,
    web_url,
    sharepoint_path,
    uploaded_by,
    is_active
  ) VALUES (
    v_tx_id,
    p_student_id,
    p_sharepoint_item_id,
    p_sharepoint_drive_id,
    p_sharepoint_site_id,
    p_file_name,
    p_original_file_name,
    p_mime_type,
    p_file_size,
    p_web_url,
    p_sharepoint_path,
    p_changed_by,
    true
  );

  INSERT INTO public.skyline_payment_plan_audit (
    student_id, student_payment_plan_id, installment_id, operation,
    previous_status, new_status, previous_paid_amount, new_paid_amount,
    payment_date, waiver_reason, changed_by, operation_source
  ) VALUES (
    p_student_id, p_assignment_id, v_first_installment_id, 'record_payment',
    NULL, v_status, NULL, v_amount,
    p_payment_date, NULL, p_changed_by, 'fifo_record_payment'
  );

  payment_transaction_id := v_tx_id;
  allocated_total := v_alloc_total;
  allocation_count := v_alloc_count;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_record_student_plan_payment(
  BIGINT, BIGINT, NUMERIC, DATE, TEXT, TEXT, BIGINT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 7) Super Admin correction (immutable history)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_correct_student_plan_payment(
  p_original_transaction_id BIGINT,
  p_corrected_amount NUMERIC,
  p_payment_date DATE,
  p_payment_reference TEXT,
  p_notes TEXT,
  p_correction_reason TEXT,
  p_changed_by BIGINT,
  p_idempotency_key TEXT,
  -- optional new receipt (required if evidence changes; always preferred)
  p_sharepoint_item_id TEXT,
  p_sharepoint_drive_id TEXT,
  p_sharepoint_site_id TEXT,
  p_file_name TEXT,
  p_original_file_name TEXT,
  p_mime_type TEXT,
  p_file_size BIGINT,
  p_web_url TEXT,
  p_sharepoint_path TEXT
)
RETURNS TABLE (
  payment_transaction_id BIGINT,
  original_transaction_id BIGINT,
  allocated_total NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orig public.skyline_student_payment_transactions%ROWTYPE;
  v_amount NUMERIC(12, 2);
  v_new_id BIGINT;
  v_alloc RECORD;
  v_alloc_total NUMERIC(12, 2) := 0;
  v_first_installment_id BIGINT;
  v_affected BIGINT[];
  v_inst_id BIGINT;
  v_status TEXT;
  v_has_receipt BOOLEAN;
BEGIN
  PERFORM public.skyline_assert_payment_staff_role(p_changed_by, true);

  IF NULLIF(trim(COALESCE(p_correction_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Correction reason is required.';
  END IF;

  SELECT * INTO v_orig
  FROM public.skyline_student_payment_transactions
  WHERE id = p_original_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment transaction not found.';
  END IF;
  IF v_orig.posting_status <> 'posted' OR v_orig.is_active <> true THEN
    RAISE EXCEPTION 'Only active posted payments can be corrected.';
  END IF;
  IF v_orig.status = 'waived' THEN
    RAISE EXCEPTION 'Waiver transactions cannot be corrected via cash correction.';
  END IF;

  v_amount := round(COALESCE(p_corrected_amount, v_orig.amount), 2);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Corrected payment amount must be greater than zero.';
  END IF;

  -- Deactivate original allocations + mark original corrected
  UPDATE public.skyline_student_payment_allocations
  SET is_active = false
  WHERE payment_transaction_id = v_orig.id AND is_active = true;

  UPDATE public.skyline_student_payment_transactions
  SET
    posting_status = 'corrected',
    is_active = false,
    corrected_at = now(),
    corrected_by = p_changed_by,
    correction_reason = trim(p_correction_reason),
    updated_at = now()
  WHERE id = v_orig.id;

  -- Recalc instalments after removing original allocations (before applying new)
  SELECT ARRAY_AGG(DISTINCT a.installment_id)
  INTO v_affected
  FROM public.skyline_student_payment_allocations a
  WHERE a.payment_transaction_id = v_orig.id;

  IF v_affected IS NOT NULL THEN
    FOREACH v_inst_id IN ARRAY v_affected LOOP
      PERFORM public.skyline_recalculate_installment_from_allocations(v_inst_id);
    END LOOP;
  END IF;

  -- Lock and allocate corrected amount FIFO on current outstanding
  PERFORM 1
  FROM public.skyline_student_payment_plan_installments i
  WHERE i.student_payment_plan_id = v_orig.student_payment_plan_id
  ORDER BY i.installment_number ASC, i.id ASC
  FOR UPDATE;

  PERFORM 1 FROM public.skyline_preview_fifo_payment_allocation(v_orig.student_payment_plan_id, v_amount);

  INSERT INTO public.skyline_student_payment_transactions (
    student_id,
    student_payment_plan_id,
    installment_id,
    amount,
    payment_date,
    payment_reference,
    notes,
    status,
    created_by,
    posting_status,
    posted_at,
    posted_by,
    is_active,
    correction_of_transaction_id,
    correction_reason,
    corrected_by,
    corrected_at,
    idempotency_key
  ) VALUES (
    v_orig.student_id,
    v_orig.student_payment_plan_id,
    NULL,
    v_amount,
    COALESCE(p_payment_date, v_orig.payment_date),
    COALESCE(NULLIF(trim(COALESCE(p_payment_reference, '')), ''), v_orig.payment_reference),
    COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), v_orig.notes),
    'partial',
    p_changed_by,
    'posted',
    now(),
    p_changed_by,
    true,
    v_orig.id,
    trim(p_correction_reason),
    p_changed_by,
    now(),
    NULLIF(trim(COALESCE(p_idempotency_key, '')), '')
  )
  RETURNING id INTO v_new_id;

  FOR v_alloc IN
    SELECT * FROM public.skyline_preview_fifo_payment_allocation(v_orig.student_payment_plan_id, v_amount)
  LOOP
    INSERT INTO public.skyline_student_payment_allocations (
      payment_transaction_id, installment_id, allocated_amount, is_active
    ) VALUES (v_new_id, v_alloc.installment_id, v_alloc.allocated_amount, true);
    v_alloc_total := round(v_alloc_total + v_alloc.allocated_amount, 2);
    IF v_first_installment_id IS NULL THEN
      v_first_installment_id := v_alloc.installment_id;
    END IF;
    PERFORM public.skyline_recalculate_installment_from_allocations(v_alloc.installment_id);
  END LOOP;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.skyline_student_payment_allocations a
      JOIN public.skyline_student_payment_plan_installments i ON i.id = a.installment_id
      WHERE a.payment_transaction_id = v_new_id AND a.is_active AND i.status = 'partial'
    ) THEN 'partial' ELSE 'paid'
  END INTO v_status;

  UPDATE public.skyline_student_payment_transactions
  SET installment_id = v_first_installment_id, status = v_status, updated_at = now()
  WHERE id = v_new_id;

  v_has_receipt := NULLIF(trim(COALESCE(p_sharepoint_item_id, '')), '') IS NOT NULL;

  IF v_has_receipt THEN
    UPDATE public.skyline_payment_receipts
    SET is_active = false, superseded_at = now(), superseded_by = p_changed_by,
        replace_reason = trim(p_correction_reason)
    WHERE payment_transaction_id = v_orig.id AND is_active = true;

    INSERT INTO public.skyline_payment_receipts (
      payment_transaction_id, student_id,
      sharepoint_item_id, sharepoint_drive_id, sharepoint_site_id,
      file_name, original_file_name, mime_type, file_size, web_url, sharepoint_path,
      uploaded_by, is_active
    ) VALUES (
      v_new_id, v_orig.student_id,
      p_sharepoint_item_id, p_sharepoint_drive_id, p_sharepoint_site_id,
      p_file_name, p_original_file_name, p_mime_type, p_file_size, p_web_url, p_sharepoint_path,
      p_changed_by, true
    );
  ELSE
    -- Carry forward active receipt metadata onto correction (same evidence file).
    INSERT INTO public.skyline_payment_receipts (
      payment_transaction_id, student_id,
      sharepoint_item_id, sharepoint_drive_id, sharepoint_site_id,
      file_name, original_file_name, mime_type, file_size, web_url, sharepoint_path,
      uploaded_by, is_active
    )
    SELECT
      v_new_id, r.student_id,
      r.sharepoint_item_id, r.sharepoint_drive_id, r.sharepoint_site_id,
      r.file_name, r.original_file_name, r.mime_type, r.file_size, r.web_url, r.sharepoint_path,
      p_changed_by, true
    FROM public.skyline_payment_receipts r
    WHERE r.payment_transaction_id = v_orig.id AND r.is_active = true
    ORDER BY r.id DESC
    LIMIT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.skyline_payment_receipts r
    WHERE r.payment_transaction_id = v_new_id AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Please upload the payment receipt before recording this payment.';
  END IF;

  INSERT INTO public.skyline_payment_plan_audit (
    student_id, student_payment_plan_id, installment_id, operation,
    previous_status, new_status, previous_paid_amount, new_paid_amount,
    payment_date, waiver_reason, changed_by, operation_source
  ) VALUES (
    v_orig.student_id, v_orig.student_payment_plan_id, v_first_installment_id, 'record_payment',
    'corrected', v_status, v_orig.amount, v_amount,
    COALESCE(p_payment_date, v_orig.payment_date), trim(p_correction_reason), p_changed_by, 'fifo_correct_payment'
  );

  payment_transaction_id := v_new_id;
  original_transaction_id := v_orig.id;
  allocated_total := v_alloc_total;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_correct_student_plan_payment(
  BIGINT, NUMERIC, DATE, TEXT, TEXT, TEXT, BIGINT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 8) Restrict receipt replace to Super Admin for posted payments
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_replace_payment_receipt_metadata(
  p_payment_transaction_id BIGINT,
  p_student_id BIGINT,
  p_sharepoint_item_id TEXT,
  p_sharepoint_drive_id TEXT,
  p_sharepoint_site_id TEXT,
  p_file_name TEXT,
  p_original_file_name TEXT,
  p_mime_type TEXT,
  p_file_size BIGINT,
  p_web_url TEXT,
  p_sharepoint_path TEXT,
  p_uploaded_by BIGINT,
  p_replace_existing BOOLEAN DEFAULT false,
  p_replace_reason TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  payment_transaction_id BIGINT,
  student_id BIGINT,
  sharepoint_item_id TEXT,
  sharepoint_drive_id TEXT,
  sharepoint_site_id TEXT,
  file_name TEXT,
  original_file_name TEXT,
  mime_type TEXT,
  file_size BIGINT,
  web_url TEXT,
  sharepoint_path TEXT,
  uploaded_by BIGINT,
  uploaded_at TIMESTAMPTZ,
  is_active BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_payment_student_id BIGINT;
  v_existing_id BIGINT;
  v_posting TEXT;
  v_is_active BOOLEAN;
BEGIN
  SELECT t.student_id, t.status, t.posting_status, t.is_active
  INTO v_payment_student_id, v_status, v_posting, v_is_active
  FROM public.skyline_student_payment_transactions t
  WHERE t.id = p_payment_transaction_id;

  IF v_payment_student_id IS NULL THEN
    RAISE EXCEPTION 'Payment transaction not found';
  END IF;
  IF v_payment_student_id <> p_student_id THEN
    RAISE EXCEPTION 'Student does not match payment transaction';
  END IF;
  IF v_status NOT IN ('paid', 'partial') THEN
    RAISE EXCEPTION 'Receipt can only be attached to paid or partial payment transactions';
  END IF;
  IF v_posting = 'posted' AND v_is_active = true AND p_replace_existing THEN
    PERFORM public.skyline_assert_payment_staff_role(p_uploaded_by, true);
    IF NULLIF(trim(COALESCE(p_replace_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Replacement reason is required.';
    END IF;
  ELSIF p_replace_existing THEN
    PERFORM public.skyline_assert_payment_staff_role(p_uploaded_by, true);
  ELSE
    PERFORM public.skyline_assert_payment_staff_role(p_uploaded_by, false);
  END IF;

  IF p_replace_existing THEN
    UPDATE public.skyline_payment_receipts
    SET
      is_active = false,
      superseded_at = now(),
      superseded_by = p_uploaded_by,
      replace_reason = NULLIF(trim(COALESCE(p_replace_reason, '')), '')
    WHERE payment_transaction_id = p_payment_transaction_id
      AND is_active = true;
  ELSE
    SELECT r.id INTO v_existing_id
    FROM public.skyline_payment_receipts r
    WHERE r.payment_transaction_id = p_payment_transaction_id
      AND r.is_active = true
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Active receipt already exists';
    END IF;
  END IF;

  RETURN QUERY
  INSERT INTO public.skyline_payment_receipts (
    payment_transaction_id, student_id,
    sharepoint_item_id, sharepoint_drive_id, sharepoint_site_id,
    file_name, original_file_name, mime_type, file_size, web_url, sharepoint_path,
    uploaded_by, is_active
  ) VALUES (
    p_payment_transaction_id, p_student_id,
    p_sharepoint_item_id, p_sharepoint_drive_id, p_sharepoint_site_id,
    p_file_name, p_original_file_name, p_mime_type, p_file_size, p_web_url, p_sharepoint_path,
    p_uploaded_by, true
  )
  RETURNING
    skyline_payment_receipts.id,
    skyline_payment_receipts.payment_transaction_id,
    skyline_payment_receipts.student_id,
    skyline_payment_receipts.sharepoint_item_id,
    skyline_payment_receipts.sharepoint_drive_id,
    skyline_payment_receipts.sharepoint_site_id,
    skyline_payment_receipts.file_name,
    skyline_payment_receipts.original_file_name,
    skyline_payment_receipts.mime_type,
    skyline_payment_receipts.file_size,
    skyline_payment_receipts.web_url,
    skyline_payment_receipts.sharepoint_path,
    skyline_payment_receipts.uploaded_by,
    skyline_payment_receipts.uploaded_at,
    skyline_payment_receipts.is_active;
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_replace_payment_receipt_metadata(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT, BOOLEAN, TEXT
) TO service_role;

-- ---------------------------------------------------------------------------
-- 9) Harden legacy cash update RPC — cash increases blocked; waivers allowed
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
  v_assignment_id BIGINT;
  v_status TEXT;
  v_paid NUMERIC(12, 2);
  v_waived NUMERIC(12, 2);
  v_waiver TEXT;
  v_payment_date DATE;
  v_notes TEXT;
  v_ref TEXT;
BEGIN
  IF p_changed_by IS NOT NULL THEN
    PERFORM public.skyline_assert_payment_staff_role(p_changed_by, false);
  END IF;

  SELECT * INTO v_row
  FROM public.skyline_student_payment_plan_installments
  WHERE id = p_installment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installment not found';
  END IF;

  SELECT spp.student_id, spp.id
  INTO v_student_id, v_assignment_id
  FROM public.skyline_student_payment_plans spp
  WHERE spp.id = v_row.student_payment_plan_id;

  v_status := lower(trim(COALESCE(p_status, v_row.status)));
  v_paid := round(COALESCE(p_paid_amount, v_row.paid_amount), 2);
  v_waiver := NULLIF(trim(COALESCE(p_waiver_reason, v_row.waiver_reason, '')), '');
  v_waived := round(COALESCE(p_waived_amount, v_row.waived_amount), 2);
  v_notes := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_ref := NULLIF(trim(COALESCE(p_payment_reference, '')), '');

  -- Cash payment recording must use skyline_record_student_plan_payment (receipt + FIFO).
  IF v_status IN ('paid', 'partial') AND v_paid > round(COALESCE(v_row.paid_amount, 0), 2) THEN
    RAISE EXCEPTION
      'Use Record Payment to post cash. Direct paid-amount increases are disabled.';
  END IF;
  IF v_status IN ('paid', 'partial') AND v_paid < round(COALESCE(v_row.paid_amount, 0), 2) THEN
    RAISE EXCEPTION
      'Only Super Admin can correct a posted payment.';
  END IF;

  IF v_status = 'waived' THEN
    IF v_waived <= 0 THEN
      v_waived := round(v_row.amount, 2);
    END IF;
    v_paid := round(COALESCE(v_row.paid_amount, 0), 2); -- keep existing cash; waiver covers remainder conceptually via status
    -- Existing product rule: waived forces cash paid_amount = 0 on full waiver.
    -- If cash already allocated, reject full waive without correction.
    IF v_paid > 0 THEN
      RAISE EXCEPTION
        'Cannot waive an instalment with cash received. Correct payment allocations first.';
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

  v_payment_date := CASE
    WHEN v_status IN ('pending') THEN NULL
    WHEN v_status = 'waived' THEN COALESCE(p_payment_date, CURRENT_DATE)
    ELSE COALESCE(p_payment_date, v_row.payment_date)
  END;

  UPDATE public.skyline_student_payment_plan_installments
  SET
    status = v_status,
    paid_amount = v_paid,
    payment_date = v_payment_date,
    notes = v_notes,
    waived_amount = v_waived,
    waiver_reason = v_waiver,
    payment_reference = v_ref,
    updated_at = now()
  WHERE id = p_installment_id;

  IF v_status = 'waived' AND COALESCE(v_row.status, '') IS DISTINCT FROM 'waived' THEN
    INSERT INTO public.skyline_student_payment_transactions (
      student_id, student_payment_plan_id, installment_id,
      amount, payment_date, payment_reference, notes, status,
      waived_amount, waiver_reason, created_by,
      posting_status, posted_at, posted_by, is_active
    ) VALUES (
      v_student_id, v_assignment_id, p_installment_id,
      0, v_payment_date, v_ref, v_notes, 'waived',
      v_waived, v_waiver, p_changed_by,
      'posted', now(), p_changed_by, true
    );
  END IF;

  INSERT INTO public.skyline_payment_plan_audit (
    student_id, student_payment_plan_id, installment_id, operation,
    previous_status, new_status, previous_paid_amount, new_paid_amount,
    payment_date, waiver_reason, changed_by
  ) VALUES (
    v_student_id, v_assignment_id, p_installment_id, 'record_payment',
    v_row.status, v_status, v_row.paid_amount, v_paid,
    p_payment_date, v_waiver, p_changed_by
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.skyline_update_student_installment_payment(
  BIGINT, TEXT, NUMERIC, DATE, TEXT, NUMERIC, TEXT, TEXT, BIGINT
) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10) Immutability trigger for posted cash transactions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.skyline_guard_posted_payment_transaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.posting_status = 'posted' AND OLD.is_active = true AND OLD.status IN ('paid', 'partial') THEN
      RAISE EXCEPTION 'Posted payment transactions cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.posting_status = 'posted' AND OLD.is_active = true AND OLD.status IN ('paid', 'partial') THEN
    -- Allow only controlled correction fields (flipping to corrected / inactive)
    IF NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
       OR NEW.notes IS DISTINCT FROM OLD.notes
       OR NEW.student_id IS DISTINCT FROM OLD.student_id
       OR NEW.student_payment_plan_id IS DISTINCT FROM OLD.student_payment_plan_id
       OR NEW.status IS DISTINCT FROM OLD.status
    THEN
      -- Allow status/installment_id tweak only during same-tx finalize inside record RPC
      -- Detect correction path: posting_status changing away from posted
      IF NEW.posting_status = 'posted' AND NEW.is_active = true THEN
        -- Permit installment_id / status updates from record RPC finalize
        IF NEW.amount IS DISTINCT FROM OLD.amount
           OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
           OR NEW.payment_reference IS DISTINCT FROM OLD.payment_reference
           OR NEW.notes IS DISTINCT FROM OLD.notes
           OR NEW.student_id IS DISTINCT FROM OLD.student_id
           OR NEW.student_payment_plan_id IS DISTINCT FROM OLD.student_payment_plan_id
        THEN
          RAISE EXCEPTION 'Posted payment transactions are immutable. Use Correct Payment.';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_posted_payment_transaction
  ON public.skyline_student_payment_transactions;
CREATE TRIGGER trg_guard_posted_payment_transaction
  BEFORE UPDATE OR DELETE ON public.skyline_student_payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_guard_posted_payment_transaction();

-- ---------------------------------------------------------------------------
-- 11) Backfill allocations from existing transactions (unambiguous)
-- ---------------------------------------------------------------------------
INSERT INTO public.skyline_student_payment_allocations (
  payment_transaction_id, installment_id, allocated_amount, is_active
)
SELECT
  t.id,
  t.installment_id,
  round(t.amount, 2),
  true
FROM public.skyline_student_payment_transactions t
WHERE t.installment_id IS NOT NULL
  AND t.amount > 0
  AND t.status IN ('paid', 'partial')
  AND COALESCE(t.is_active, true) = true
  AND COALESCE(t.posting_status, 'posted') = 'posted'
  AND NOT EXISTS (
    SELECT 1 FROM public.skyline_student_payment_allocations a
    WHERE a.payment_transaction_id = t.id AND a.installment_id = t.installment_id
  );

-- ---------------------------------------------------------------------------
-- 12) Diagnostic view: instalment paid_amount vs SUM(allocations)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.skyline_payment_allocation_mismatches AS
SELECT
  i.id AS installment_id,
  i.student_payment_plan_id AS assignment_id,
  spp.student_id,
  i.installment_number,
  i.amount AS scheduled_amount,
  round(i.paid_amount, 2) AS installment_paid_amount,
  round(COALESCE(SUM(a.allocated_amount) FILTER (
    WHERE a.is_active AND t.is_active AND t.posting_status = 'posted'
  ), 0), 2) AS allocation_sum,
  round(
    round(i.paid_amount, 2) - round(COALESCE(SUM(a.allocated_amount) FILTER (
      WHERE a.is_active AND t.is_active AND t.posting_status = 'posted'
    ), 0), 2),
    2
  ) AS difference
FROM public.skyline_student_payment_plan_installments i
JOIN public.skyline_student_payment_plans spp ON spp.id = i.student_payment_plan_id
LEFT JOIN public.skyline_student_payment_allocations a ON a.installment_id = i.id
LEFT JOIN public.skyline_student_payment_transactions t ON t.id = a.payment_transaction_id
GROUP BY i.id, i.student_payment_plan_id, spp.student_id, i.installment_number, i.amount, i.paid_amount
HAVING round(i.paid_amount, 2) IS DISTINCT FROM round(COALESCE(SUM(a.allocated_amount) FILTER (
  WHERE a.is_active AND t.is_active AND t.posting_status = 'posted'
), 0), 2);

GRANT SELECT ON public.skyline_payment_allocation_mismatches TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
