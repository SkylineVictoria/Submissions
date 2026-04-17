-- When "To" is empty, support two behaviours:
--   p_open_null_end_exact = false (default): "active on" From — start <= From <= end (or no end date yet).
--   p_open_null_end_exact = true: strict legacy — end IS NULL and start = From only.

create or replace function public.skyline_batch_assessment_options(
  p_batch_id bigint,
  p_course_id bigint,
  p_from_date date,
  p_to_date date,
  p_start_only_null_end boolean default false,
  p_open_null_end_exact boolean default false
)
returns jsonb
language sql
stable
as $$
  with course_units as (
    select f.id as form_id, f.name as form_name
    from public.skyline_course_forms cf
    join public.skyline_forms f on f.id = cf.form_id
    where cf.course_id = p_course_id
  ),
  eligible as (
    select distinct
      i.student_id,
      i.form_id,
      f.name as form_name
    from public.skyline_form_instances i
    join public.skyline_students s on s.id = i.student_id
    join public.skyline_forms f on f.id = i.form_id
    where s.batch_id = p_batch_id
      and exists (
        select 1
        from public.skyline_course_forms cf
        where cf.course_id = p_course_id
          and cf.form_id = i.form_id
      )
      and (
        (
          coalesce(p_start_only_null_end, false) = false
          and i.start_date is not null
          and i.end_date is not null
          and i.start_date >= p_from_date
          and i.end_date <= p_to_date
        )
        or (
          coalesce(p_start_only_null_end, false) = true
          and coalesce(p_open_null_end_exact, false) = true
          and i.start_date is not null
          and i.end_date is null
          and i.start_date = p_from_date
        )
        or (
          coalesce(p_start_only_null_end, false) = true
          and coalesce(p_open_null_end_exact, false) = false
          and i.start_date is not null
          and i.start_date <= p_from_date
          and (i.end_date is null or i.end_date >= p_from_date)
        )
      )
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
      u.id,
      u.name
    from (
      select cu.form_id as id, cu.form_name as name
      from course_units cu
      union
      select e.form_id as id, e.form_name as name
      from eligible e
    ) u
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
