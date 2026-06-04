-- Cached aXcelerate invoices for Finance Reports (synced via axcelerate-finance-sync Edge Function).

CREATE TABLE IF NOT EXISTS public.ax_invoices (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL UNIQUE,
  invoice_number TEXT,
  contact_id BIGINT,
  student_name TEXT,
  email TEXT,
  invoice_date DATE,
  due_date DATE,
  invoice_amount NUMERIC NOT NULL DEFAULT 0,
  paid_amount NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  is_void BOOLEAN NOT NULL DEFAULT false,
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  are_items_locked BOOLEAN NOT NULL DEFAULT false,
  course_name TEXT,
  agent_name TEXT,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ax_invoices_invoice_date ON public.ax_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS idx_ax_invoices_due_date ON public.ax_invoices (due_date);
CREATE INDEX IF NOT EXISTS idx_ax_invoices_contact_id ON public.ax_invoices (contact_id);
CREATE INDEX IF NOT EXISTS idx_ax_invoices_is_paid ON public.ax_invoices (is_paid);
CREATE INDEX IF NOT EXISTS idx_ax_invoices_balance ON public.ax_invoices (balance);

CREATE OR REPLACE FUNCTION public.ax_invoices_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ax_invoices_updated_at ON public.ax_invoices;
CREATE TRIGGER trg_ax_invoices_updated_at
  BEFORE UPDATE ON public.ax_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.ax_invoices_set_updated_at();

ALTER TABLE public.ax_invoices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ax_invoices IS 'aXcelerate invoice cache for Finance Reports; populated by axcelerate-finance-sync.';
