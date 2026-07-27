-- Payment transactions + receipt metadata for Student Payment Plans.
--
-- Root cause of schema-cache error:
--   Earlier receipt work referenced
--   public.skyline_student_payment_plan_installment_transactions
--   but that migration was never applied. No student-plan payment-event table
--   existed; payments lived only as aggregates on instalments.
--
-- Actual architecture (this migration):
--   Student Payment Plan
--     -> Instalment (running totals)
--       -> Payment Transaction(s)  [immutable cash events]
--         -> Receipt attachment(s) [SharePoint metadata only]
--
-- ax_invoice_payments remains aXcelerate finance-report cache and is NOT used
-- for Student Payment Plan receipt linking.

-- ---------------------------------------------------------------------------
-- 1) Payment transaction events (immutable history)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.skyline_student_payment_transactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES public.skyline_students(id) ON DELETE CASCADE,
  student_payment_plan_id BIGINT NOT NULL
    REFERENCES public.skyline_student_payment_plans(id) ON DELETE CASCADE,
  installment_id BIGINT NOT NULL
    REFERENCES public.skyline_student_payment_plan_installments(id) ON DELETE CASCADE,

  -- Cash amount of THIS payment event (not the instalment running total).
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_date DATE,
  payment_reference TEXT,
  notes TEXT,

  -- Instalment status at the time this event was recorded.
  status TEXT NOT NULL
    CHECK (status IN ('paid', 'partial', 'waived')),

  waived_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (waived_amount >= 0),
  waiver_reason TEXT,

  created_by BIGINT REFERENCES public.skyline_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skyline_payment_tx_installment_id
  ON public.skyline_student_payment_transactions (installment_id);
CREATE INDEX IF NOT EXISTS idx_skyline_payment_tx_assignment_id
  ON public.skyline_student_payment_transactions (student_payment_plan_id);
CREATE INDEX IF NOT EXISTS idx_skyline_payment_tx_student_id
  ON public.skyline_student_payment_transactions (student_id);
CREATE INDEX IF NOT EXISTS idx_skyline_payment_tx_created_at
  ON public.skyline_student_payment_transactions (created_at DESC);

COMMENT ON TABLE public.skyline_student_payment_transactions IS
  'Immutable payment events for student payment-plan instalments. One instalment may have many partial payments; receipts attach here.';

-- ---------------------------------------------------------------------------
-- 2) Receipt metadata (one active receipt per payment event)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.skyline_payment_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_transaction_id BIGINT NOT NULL
    REFERENCES public.skyline_student_payment_transactions(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES public.skyline_students(id) ON DELETE CASCADE,

  sharepoint_item_id TEXT NOT NULL,
  sharepoint_drive_id TEXT NOT NULL,
  sharepoint_site_id TEXT NOT NULL,

  file_name TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size >= 0),
  web_url TEXT NOT NULL,
  sharepoint_path TEXT NOT NULL,

  uploaded_by BIGINT REFERENCES public.skyline_users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_payment_tx
  ON public.skyline_payment_receipts (payment_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_student
  ON public.skyline_payment_receipts (student_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_uploaded_at
  ON public.skyline_payment_receipts (uploaded_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_receipts_active_per_tx
  ON public.skyline_payment_receipts (payment_transaction_id)
  WHERE is_active = true;

COMMENT ON TABLE public.skyline_payment_receipts IS
  'SharePoint receipt metadata linked to skyline_student_payment_transactions. Binary files are not stored in Postgres.';

-- ---------------------------------------------------------------------------
-- 3) RPC: insert/replace receipt metadata (service-role / Edge Function)
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
  p_replace_existing BOOLEAN DEFAULT false
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
BEGIN
  SELECT t.student_id, t.status
  INTO v_payment_student_id, v_status
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

  IF p_replace_existing THEN
    UPDATE public.skyline_payment_receipts
    SET is_active = false
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
    p_payment_transaction_id,
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
    p_uploaded_by,
    true
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
  BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT, BOOLEAN
) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Payment-recording RPC: update instalment aggregate + insert event when
--    cash increases (delta) or when first waived.
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
  v_delta NUMERIC(12, 2);
  v_tx_amount NUMERIC(12, 2);
  v_payment_date DATE;
  v_notes TEXT;
  v_ref TEXT;
BEGIN
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

  v_payment_date := CASE
    WHEN v_status IN ('pending') THEN NULL
    WHEN v_status = 'waived' THEN COALESCE(p_payment_date, CURRENT_DATE)
    ELSE p_payment_date
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

  -- Reconcile immutable payment events with instalment paid total (supports partial payments).
  IF v_status IN ('paid', 'partial') AND v_paid > 0 THEN
    SELECT COALESCE(SUM(t.amount), 0)
    INTO v_delta
    FROM public.skyline_student_payment_transactions t
    WHERE t.installment_id = p_installment_id;

    v_tx_amount := round(v_paid - v_delta, 2);

    IF v_tx_amount > 0 THEN
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
        created_by
      ) VALUES (
        v_student_id,
        v_assignment_id,
        p_installment_id,
        v_tx_amount,
        v_payment_date,
        v_ref,
        v_notes,
        v_status,
        0,
        NULL,
        p_changed_by
      );
    END IF;
  ELSIF v_status = 'waived' AND COALESCE(v_row.status, '') IS DISTINCT FROM 'waived' THEN
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
      created_by
    ) VALUES (
      v_student_id,
      v_assignment_id,
      p_installment_id,
      0,
      v_payment_date,
      v_ref,
      v_notes,
      v_status,
      v_waived,
      v_waiver,
      p_changed_by
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
-- 5) One-time backfill for unambiguous historical payments
-- ---------------------------------------------------------------------------
-- Diagnostic (expected before apply): instalments with cash or waiver and no tx yet.
-- Safe rule: one transaction per instalment using current paid_amount / waived state.
-- Does NOT invent multiple historical partials when only the aggregate is known.

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
  created_by
)
SELECT
  spp.student_id,
  spp.id,
  i.id,
  CASE
    WHEN i.status = 'waived' THEN 0
    ELSE round(i.paid_amount, 2)
  END AS amount,
  COALESCE(i.payment_date, CURRENT_DATE),
  i.payment_reference,
  i.notes,
  CASE
    WHEN i.status = 'waived' THEN 'waived'
    WHEN i.status = 'paid' THEN 'paid'
    ELSE 'partial'
  END AS status,
  CASE WHEN i.status = 'waived' THEN round(i.waived_amount, 2) ELSE 0 END,
  CASE WHEN i.status = 'waived' THEN i.waiver_reason ELSE NULL END,
  NULL
FROM public.skyline_student_payment_plan_installments i
JOIN public.skyline_student_payment_plans spp ON spp.id = i.student_payment_plan_id
WHERE (
    (i.status IN ('paid', 'partial') AND i.paid_amount > 0)
    OR i.status = 'waived'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.skyline_student_payment_transactions t
    WHERE t.installment_id = i.id
  );

-- ---------------------------------------------------------------------------
-- 6) Permissions / RLS
-- ---------------------------------------------------------------------------
-- Match Student Payment Plan table access model: staff UI uses anon key +
-- application role checks. Writes to receipts are Edge Function (service_role).

ALTER TABLE public.skyline_student_payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skyline_payment_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS skyline_payment_tx_select ON public.skyline_student_payment_transactions;
CREATE POLICY skyline_payment_tx_select
  ON public.skyline_student_payment_transactions
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS skyline_payment_receipts_select ON public.skyline_payment_receipts;
CREATE POLICY skyline_payment_receipts_select
  ON public.skyline_payment_receipts
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- No client INSERT/UPDATE/DELETE policies on receipts → only service_role (bypasses RLS).
GRANT SELECT ON public.skyline_student_payment_transactions TO anon, authenticated, service_role;
GRANT SELECT ON public.skyline_payment_receipts TO anon, authenticated, service_role;
GRANT INSERT, UPDATE, DELETE ON public.skyline_payment_receipts TO service_role;
GRANT INSERT ON public.skyline_student_payment_transactions TO service_role;

NOTIFY pgrst, 'reload schema';
