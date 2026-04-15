-- Returns a single JSON payload for batch/course/date-range:
-- - students: [{ id, label }]
-- - units:    [{ id, name }]
-- - student_units: { "<studentId>": [unitId, ...], ... }
--
-- Dates in skyline_form_instances are stored as text (yyyy-MM-dd).
create or replace function public.skyline_batch_assessment_options(
  p_batch_id bigint,
  p_course_id bigint,
  p_from_date date,
  p_to_date date
)
returns jsonb
language sql
stable
as $$
  with eligible as (
    select distinct
      i.student_id,
      i.form_id,
      f.name as form_name
    from public.skyline_form_instances i
    join public.skyline_students s on s.id = i.student_id
    join public.skyline_course_forms cf on cf.form_id = i.form_id and cf.course_id = p_course_id
    join public.skyline_forms f on f.id = i.form_id
    where s.batch_id = p_batch_id
      and i.start_date is not null
      and i.end_date is not null
      and i.start_date ~ '^\d{4}-\d{2}-\d{2}$'
      and i.end_date ~ '^\d{4}-\d{2}-\d{2}$'
      and (i.start_date::date) >= p_from_date
      and (i.end_date::date) <= p_to_date
  ),
  students as (
    select distinct
      e.student_id as id,
      coalesce(nullif(trim(concat_ws(' ', nullif(s.first_name,''), nullif(s.last_name,''))), ''), s.email) ||
        coalesce(' (' || nullif(s.student_id,'') || ')', '') as label
    from eligible e
    join public.skyline_students s on s.id = e.student_id
  ),
  units as (
    select distinct
      e.form_id as id,
      e.form_name as name
    from eligible e
  ),
  student_units as (
    select
      e.student_id,
      jsonb_agg(distinct e.form_id order by e.form_id) as unit_ids
    from eligible e
    group by e.student_id
  )
  select jsonb_build_object(
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label) order by label) from students), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from units), '[]'::jsonb),
    'student_units', coalesce((select jsonb_object_agg(student_id::text, unit_ids) from student_units), '{}'::jsonb)
  );
$$;

