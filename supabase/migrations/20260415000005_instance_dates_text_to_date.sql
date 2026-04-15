-- Convert instance start/end dates from TEXT -> DATE.
-- Any non-ISO values are coerced to NULL to avoid migration failure.
-- This enables correct ordering/filtering in SQL (no lexical issues).

alter table public.skyline_form_instances
  alter column start_date type date
  using (
    case
      when start_date is null then null
      when btrim(start_date) = '' then null
      when start_date ~ '^\d{4}-\d{2}-\d{2}$' then start_date::date
      else null
    end
  );

alter table public.skyline_form_instances
  alter column end_date type date
  using (
    case
      when end_date is null then null
      when btrim(end_date) = '' then null
      when end_date ~ '^\d{4}-\d{2}-\d{2}$' then end_date::date
      else null
    end
  );

-- Rebuild indexes for date columns.
drop index if exists public.idx_skyline_form_instances_start_date;
drop index if exists public.idx_skyline_form_instances_end_date;
create index if not exists idx_skyline_form_instances_start_date on public.skyline_form_instances(start_date);
create index if not exists idx_skyline_form_instances_end_date on public.skyline_form_instances(end_date);

