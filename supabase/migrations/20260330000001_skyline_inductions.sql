-- Skyline induction windows: admins set start/end in Australian time; students use access_token link.

CREATE TABLE IF NOT EXISTS skyline_inductions (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Induction',
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  access_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by BIGINT REFERENCES skyline_users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by BIGINT REFERENCES skyline_users(id),
  CONSTRAINT skyline_inductions_end_after_start CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_skyline_inductions_access_token ON skyline_inductions(access_token);
CREATE INDEX IF NOT EXISTS idx_skyline_inductions_start_at ON skyline_inductions(start_at DESC);

DROP TRIGGER IF EXISTS skyline_inductions_updated_at ON skyline_inductions;
CREATE TRIGGER skyline_inductions_updated_at
  BEFORE UPDATE ON skyline_inductions
  FOR EACH ROW EXECUTE FUNCTION skyline_set_updated_at();

COMMENT ON TABLE skyline_inductions IS 'Enrollment induction windows; public URL uses access_token.';
