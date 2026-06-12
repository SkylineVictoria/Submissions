-- Payment-to-invoice allocations (FIFO + exact match) for Finance Reports payment dates.

CREATE TABLE IF NOT EXISTS public.ax_invoice_payment_allocations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL,
  payment_id TEXT NOT NULL,
  transaction_id TEXT,
  contact_id BIGINT,
  allocated_amount NUMERIC NOT NULL DEFAULT 0,
  allocation_date TIMESTAMPTZ,
  payment_method TEXT,
  match_method TEXT NOT NULL,
  match_confidence TEXT NOT NULL,
  raw_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, payment_id)
);

CREATE INDEX IF NOT EXISTS idx_ax_invoice_payment_allocations_invoice_id
  ON public.ax_invoice_payment_allocations (invoice_id);

CREATE INDEX IF NOT EXISTS idx_ax_invoice_payment_allocations_payment_id
  ON public.ax_invoice_payment_allocations (payment_id);

CREATE INDEX IF NOT EXISTS idx_ax_invoice_payment_allocations_contact_id
  ON public.ax_invoice_payment_allocations (contact_id);

CREATE INDEX IF NOT EXISTS idx_ax_invoice_payment_allocations_allocation_date
  ON public.ax_invoice_payment_allocations (allocation_date);

CREATE OR REPLACE FUNCTION public.ax_invoice_payment_allocations_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ax_invoice_payment_allocations_updated_at ON public.ax_invoice_payment_allocations;
CREATE TRIGGER trg_ax_invoice_payment_allocations_updated_at
  BEFORE UPDATE ON public.ax_invoice_payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.ax_invoice_payment_allocations_set_updated_at();

ALTER TABLE public.ax_invoice_payment_allocations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ax_invoice_payment_allocations IS
  'Payment-to-invoice allocations built by axcelerate-finance-sync backfill; drives payment dates on Finance Reports.';
