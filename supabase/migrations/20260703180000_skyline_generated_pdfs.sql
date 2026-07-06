-- Background PDF generation jobs: Render worker uploads to SharePoint; frontend reads stored URLs.
-- Generation is driven by pdf_status (not download_count).

-- Remove non-prefixed table if an earlier draft of this migration was applied locally.
DROP TABLE IF EXISTS public.generated_pdfs;

CREATE TABLE IF NOT EXISTS public.skyline_generated_pdfs (
  id BIGSERIAL PRIMARY KEY,
  instance_id BIGINT NOT NULL REFERENCES public.skyline_form_instances(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'office',
  pdf_status TEXT NOT NULL DEFAULT 'pending',
  sharepoint_web_url TEXT,
  sharepoint_public_url TEXT,
  sharepoint_drive_item_id TEXT,
  sharepoint_site_id TEXT,
  sharepoint_drive_id TEXT,
  storage_path TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  generated_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  last_downloaded_at TIMESTAMPTZ,
  download_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skyline_generated_pdfs_instance_role_unique UNIQUE (instance_id, role),
  CONSTRAINT skyline_generated_pdfs_pdf_status_check CHECK (
    pdf_status IN ('pending', 'generating', 'uploaded', 'failed', 'stale')
  )
);

CREATE INDEX IF NOT EXISTS idx_skyline_generated_pdfs_pdf_status ON public.skyline_generated_pdfs (pdf_status);
CREATE INDEX IF NOT EXISTS idx_skyline_generated_pdfs_instance_id ON public.skyline_generated_pdfs (instance_id);
CREATE INDEX IF NOT EXISTS idx_skyline_generated_pdfs_generated_at ON public.skyline_generated_pdfs (generated_at);
CREATE INDEX IF NOT EXISTS idx_skyline_generated_pdfs_locked_at ON public.skyline_generated_pdfs (locked_at);

-- Reuse project-wide updated_at trigger helper when present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'skyline_set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION public.skyline_set_updated_at()
    RETURNS TRIGGER AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS skyline_generated_pdfs_updated_at ON public.skyline_generated_pdfs;
CREATE TRIGGER skyline_generated_pdfs_updated_at
  BEFORE UPDATE ON public.skyline_generated_pdfs
  FOR EACH ROW
  EXECUTE FUNCTION public.skyline_set_updated_at();

COMMENT ON TABLE public.skyline_generated_pdfs IS
  'Queued/completed assessment PDF exports. Render worker processes pending rows; UI reads SharePoint URLs.';
