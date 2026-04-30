-- Web push tokens (browser delivery via Firebase Cloud Messaging)
CREATE TABLE IF NOT EXISTS skyline_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  fcm_token TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  browser TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT skyline_push_tokens_user_token_unique UNIQUE (user_id, fcm_token)
);

-- In-app notifications (source of truth for bell and notifications page)
CREATE TABLE IF NOT EXISTS skyline_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  url TEXT,
  type TEXT NOT NULL DEFAULT 'general',
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_skyline_notifications_user_id ON skyline_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_skyline_notifications_user_unread ON skyline_notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_skyline_notifications_created_at_desc ON skyline_notifications (created_at DESC);

