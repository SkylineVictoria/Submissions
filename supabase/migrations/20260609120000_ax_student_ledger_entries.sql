-- Student/contact ledger cache from aXcelerate Ledger View.

CREATE TABLE IF NOT EXISTS public.ax_student_ledger_entries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ledger_entry_id TEXT NOT NULL UNIQUE,
  contact_id BIGINT,
  student_name TEXT,
  email TEXT,

  ledger_date DATE,
  entry_datetime TIMESTAMPTZ,

  entry_type TEXT,
  reference TEXT,
  description TEXT,
  related_invoice_number TEXT,
  related_invoice_id BIGINT,

  debit NUMERIC NOT NULL DEFAULT 0,
  credit NUMERIC NOT NULL DEFAULT 0,
  balance NUMERIC NOT NULL DEFAULT 0,

  payment_method TEXT,
  raw_json JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ax_student_ledger_entries_contact_id
  ON public.ax_student_ledger_entries (contact_id);

CREATE INDEX IF NOT EXISTS idx_ax_student_ledger_entries_ledger_date
  ON public.ax_student_ledger_entries (ledger_date);

CREATE INDEX IF NOT EXISTS idx_ax_student_ledger_entries_entry_datetime
  ON public.ax_student_ledger_entries (entry_datetime);

CREATE INDEX IF NOT EXISTS idx_ax_student_ledger_entries_related_invoice_number
  ON public.ax_student_ledger_entries (related_invoice_number);

CREATE INDEX IF NOT EXISTS idx_ax_student_ledger_entries_entry_type
  ON public.ax_student_ledger_entries (entry_type);

CREATE OR REPLACE FUNCTION public.ax_student_ledger_entries_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ax_student_ledger_entries_updated_at ON public.ax_student_ledger_entries;
CREATE TRIGGER trg_ax_student_ledger_entries_updated_at
  BEFORE UPDATE ON public.ax_student_ledger_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.ax_student_ledger_entries_set_updated_at();

ALTER TABLE public.ax_student_ledger_entries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ax_student_ledger_entries IS 'aXcelerate contact ledger view cache; populated by axcelerate-finance-sync.';
