-- Upgrade payment plans from per-student rows to reusable templates + many-to-many assignments.
-- Fixes: drop dependent views before ALTER; rebuild template installments table (no DROP COLUMN on views).

DO $$
DECLARE
  v_needs_upgrade BOOLEAN;
  v_installments_kind "char";
BEGIN
  -- Legacy schema: student_id on the payment_plans base table.
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'skyline_payment_plans'
      AND c.relkind = 'r'
      AND a.attname = 'student_id'
      AND NOT a.attisdropped
  ) INTO v_needs_upgrade;

  IF NOT v_needs_upgrade THEN
    RETURN;
  END IF;

  -- Views reference student_id / installment payment columns — must drop before table changes.
  DROP VIEW IF EXISTS public.skyline_payment_plan_summary CASCADE;
  DROP VIEW IF EXISTS public.skyline_student_payment_plan_summary CASCADE;

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

  INSERT INTO public.skyline_student_payment_plans (payment_plan_id, student_id, start_date, assigned_by)
  SELECT p.id, p.student_id, p.start_date, p.created_by
  FROM public.skyline_payment_plans p
  WHERE p.student_id IS NOT NULL
  ON CONFLICT (payment_plan_id, student_id) DO NOTHING;

  -- Migrate legacy per-plan installments (with payment fields) into per-student rows.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'skyline_payment_plan_installments'
      AND c.relkind IN ('r', 'v')
  ) THEN
    SELECT c.relkind INTO v_installments_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'skyline_payment_plan_installments';

    IF v_installments_kind = 'v' THEN
      DROP VIEW public.skyline_payment_plan_installments CASCADE;
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'skyline_payment_plan_installments'
      AND c.relkind = 'r'
      AND a.attname = 'status'
      AND NOT a.attisdropped
  ) THEN
    INSERT INTO public.skyline_student_payment_plan_installments (
    student_payment_plan_id, installment_number, due_date, amount, status, paid_amount, payment_date, notes
  )
    SELECT spp.id, i.installment_number, i.due_date, i.amount,
      COALESCE(i.status, 'pending'), COALESCE(i.paid_amount, 0), i.payment_date, i.notes
    FROM public.skyline_payment_plan_installments i
    JOIN public.skyline_student_payment_plans spp ON spp.payment_plan_id = i.payment_plan_id
    ON CONFLICT (student_payment_plan_id, installment_number) DO NOTHING;

    DROP TRIGGER IF EXISTS trg_payment_plan_installments_guard ON public.skyline_payment_plan_installments;
    DROP TRIGGER IF EXISTS trg_payment_plan_installments_updated_at ON public.skyline_payment_plan_installments;

    CREATE TABLE public._skyline_payment_plan_installments_tpl (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      payment_plan_id BIGINT NOT NULL REFERENCES public.skyline_payment_plans(id) ON DELETE CASCADE,
      installment_number INT NOT NULL CHECK (installment_number >= 1),
      due_date DATE NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (payment_plan_id, installment_number)
    );

    INSERT INTO public._skyline_payment_plan_installments_tpl (
      payment_plan_id, installment_number, due_date, amount, created_at, updated_at
    )
    SELECT payment_plan_id, installment_number, due_date, amount, created_at, updated_at
    FROM public.skyline_payment_plan_installments;

    DROP TABLE public.skyline_payment_plan_installments CASCADE;

    ALTER TABLE public._skyline_payment_plan_installments_tpl
      RENAME TO skyline_payment_plan_installments;

    CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_plan_id
      ON public.skyline_payment_plan_installments (payment_plan_id);

    DROP TRIGGER IF EXISTS trg_payment_plan_installments_updated_at ON public.skyline_payment_plan_installments;
    CREATE TRIGGER trg_payment_plan_installments_updated_at
      BEFORE UPDATE ON public.skyline_payment_plan_installments
      FOR EACH ROW
      EXECUTE FUNCTION public.skyline_payment_plans_set_updated_at();

    DROP TRIGGER IF EXISTS trg_payment_plan_installments_guard ON public.skyline_payment_plan_installments;
    CREATE TRIGGER trg_payment_plan_installments_guard
      BEFORE INSERT OR UPDATE OR DELETE ON public.skyline_payment_plan_installments
      FOR EACH ROW
      EXECUTE FUNCTION public.skyline_payment_plan_installments_guard();

    GRANT SELECT, INSERT, UPDATE, DELETE ON public.skyline_payment_plan_installments TO anon, authenticated, service_role;
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'skyline_payment_plan_installments' AND c.relkind = 'r'
  ) THEN
    CREATE TABLE public.skyline_payment_plan_installments (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      payment_plan_id BIGINT NOT NULL REFERENCES public.skyline_payment_plans(id) ON DELETE CASCADE,
      installment_number INT NOT NULL CHECK (installment_number >= 1),
      due_date DATE NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (payment_plan_id, installment_number)
    );
    CREATE INDEX IF NOT EXISTS idx_payment_plan_installments_plan_id
      ON public.skyline_payment_plan_installments (payment_plan_id);
  END IF;

  ALTER TABLE public.skyline_payment_plans
    DROP COLUMN IF EXISTS student_id,
    DROP COLUMN IF EXISTS student_name,
    DROP COLUMN IF EXISTS student_email;

  DROP INDEX IF EXISTS public.idx_payment_plans_student_id;
END $$;

-- Recreate views (dropped above during upgrade).
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

GRANT SELECT ON public.skyline_payment_plan_summary TO anon, authenticated, service_role;
GRANT SELECT ON public.skyline_student_payment_plan_summary TO anon, authenticated, service_role;
