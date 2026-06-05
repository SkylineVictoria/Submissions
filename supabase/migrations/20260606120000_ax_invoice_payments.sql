-- Payment records synced from aXcelerate for Finance Reports payment-date support.

CREATE TABLE IF NOT EXISTS public.ax_invoice_payments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id TEXT NOT NULL UNIQUE,
  invoice_id BIGINT,
  invoice_number TEXT,
  contact_id BIGINT,
  student_name TEXT,
  payment_date TIMESTAMPTZ,
  payment_amount NUMERIC NOT NULL DEFAULT 0,
  payment_method TEXT,
  reference TEXT,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ax_invoice_payments_invoice_id ON public.ax_invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_ax_invoice_payments_invoice_number ON public.ax_invoice_payments (invoice_number);
CREATE INDEX IF NOT EXISTS idx_ax_invoice_payments_contact_id ON public.ax_invoice_payments (contact_id);
CREATE INDEX IF NOT EXISTS idx_ax_invoice_payments_payment_date ON public.ax_invoice_payments (payment_date);

CREATE OR REPLACE FUNCTION public.ax_invoice_payments_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ax_invoice_payments_updated_at ON public.ax_invoice_payments;
CREATE TRIGGER trg_ax_invoice_payments_updated_at
  BEFORE UPDATE ON public.ax_invoice_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.ax_invoice_payments_set_updated_at();

ALTER TABLE public.ax_invoice_payments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ax_invoice_payments IS 'aXcelerate payment/transaction cache matched to invoices; populated by axcelerate-finance-sync.';

-- Payment summary fields on cached invoices.
ALTER TABLE public.ax_invoices
  ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_payment_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_method TEXT;

CREATE INDEX IF NOT EXISTS idx_ax_invoices_last_payment_date ON public.ax_invoices (last_payment_date);
