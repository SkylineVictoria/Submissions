-- Multiple trainers per batch: primary stays on skyline_batches.trainer_id; extras in junction table.

CREATE TABLE IF NOT EXISTS public.skyline_batch_trainers (
  batch_id BIGINT NOT NULL REFERENCES public.skyline_batches(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.skyline_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (batch_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_skyline_batch_trainers_user_id
  ON public.skyline_batch_trainers(user_id);

COMMENT ON TABLE public.skyline_batch_trainers IS
  'Additional trainers assigned to a batch. Primary trainer remains skyline_batches.trainer_id (also stored here for uniform lookups).';

-- Backfill primary trainer into junction (idempotent).
INSERT INTO public.skyline_batch_trainers (batch_id, user_id)
SELECT b.id, b.trainer_id
FROM public.skyline_batches b
WHERE b.trainer_id IS NOT NULL
ON CONFLICT (batch_id, user_id) DO NOTHING;
