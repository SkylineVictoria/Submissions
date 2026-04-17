-- Server-side pagination for batch unit dates: one page of student rows + full eligible id list (compact).
-- Params: p_page (1-based), p_page_size (default 25, max 200), p_form_id (optional unit filter).

create or replace function public.skyline_batch_assessment_options(
  p_batch_id bigint,
  p_course_id bigint,
  p_from_date date,
  p_to_date date,
  p_start_only_null_end boolean default false,
  p_open_null_end_exact boolean default false,
  p_page integer default 1,
  p_page_size integer default 25,
  p_form_id bigint default null
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
          and i.start_date = p_from_date
          and i.end_date <= p_to_date
          and i.end_date >= p_from_date
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
  students_all as (
    select distinct
      e.student_id as id,
      coalesce(nullif(trim(concat_ws(' ', nullif(s.first_name,''), nullif(s.last_name,''))), ''), s.email) ||
        coalesce(' (' || nullif(s.student_id,'') || ')', '') as label
    from eligible e
    join public.skyline_students s on s.id = e.student_id
    where p_form_id is null or e.form_id = p_form_id
  ),
  students_ordered as (
    select id, label
    from students_all
    order by label asc nulls last, id asc
  ),
  page_params as (
    select
      greatest(1, coalesce(nullif(p_page, 0), 1)) as page_num,
      least(200, greatest(1, coalesce(nullif(p_page_size, 0), 25))) as page_sz
  ),
  students_total as (
    select count(*)::bigint as n from students_ordered
  ),
  students_page as (
    select so.id, so.label
    from students_ordered so
    offset ((select page_num from page_params) - 1) * (select page_sz from page_params)
    limit (select page_sz from page_params)
  ),
  eligible_student_ids as (
    select distinct e.student_id as sid
    from eligible e
    where p_form_id is null or e.form_id = p_form_id
  ),
  units as (
    select distinct
      e.form_id as id,
      e.form_name as name
    from eligible e
  ),
  -- All matching students (not only current page): unit id arrays for mass-save / selection logic.
  student_units as (
    select
      e.student_id,
      jsonb_agg(distinct e.form_id order by e.form_id) as unit_ids
    from eligible e
    where e.student_id in (select sid from eligible_student_ids)
    group by e.student_id
  )
  select jsonb_build_object(
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label) order by label) from students_page), '[]'::jsonb),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from units), '[]'::jsonb),
    'student_units', coalesce((select jsonb_object_agg(student_id::text, unit_ids) from student_units), '{}'::jsonb),
    'students_total', coalesce((select n from students_total), 0),
    'students_page', (select page_num from page_params),
    'students_page_size', (select page_sz from page_params),
    'eligible_student_ids', coalesce(
      (select jsonb_agg(sid order by sid) from eligible_student_ids),
      '[]'::jsonb
    )
  );
$$;
