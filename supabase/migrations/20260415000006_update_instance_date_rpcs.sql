-- Update RPCs to use DATE-typed skyline_form_instances.start_date/end_date.

-- Eligibility pairs (student_id, form_id, form_name) within date window.
create or replace function public.skyline_batch_assessment_eligibility(
  p_batch_id bigint,
  p_course_id bigint,
  p_from_date date,
  p_to_date date
)
returns table (
  student_id bigint,
  form_id bigint,
  form_name text
)
language sql
stable
as $$
  with batch_students as (
    select id as student_id
    from public.skyline_students
    where batch_id = p_batch_id
  ),
  course_forms as (
    select form_id
    from public.skyline_course_forms
    where course_id = p_course_id
  )
  select distinct
    i.student_id,
    i.form_id,
    f.name as form_name
  from public.skyline_form_instances i
  join batch_students bs on bs.student_id = i.student_id
  join course_forms cf on cf.form_id = i.form_id
  join public.skyline_forms f on f.id = i.form_id
  where i.start_date is not null
    and i.end_date is not null
    and i.start_date >= p_from_date
    and i.end_date <= p_to_date;
$$;

-- JSON payload options for dropdowns.
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
      and i.start_date >= p_from_date
      and i.end_date <= p_to_date
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

-- Server-side sorted + paginated assessments list.
create or replace function public.skyline_list_submitted_instances_paged(
  p_page integer default 1,
  p_page_size integer default 20,
  p_search text default null,
  p_course_id bigint default null,
  p_form_id bigint default null,
  p_student_id bigint default null,
  p_sort_key text default 'created',
  p_sort_dir text default 'desc'
)
returns table (
  id bigint,
  form_id bigint,
  form_name text,
  form_version text,
  student_id bigint,
  student_name text,
  student_email text,
  status text,
  role_context text,
  created_at timestamptz,
  submitted_at timestamptz,
  submission_count integer,
  start_date date,
  end_date date,
  total_count bigint
)
language plpgsql
stable
as $$
declare
  v_from integer := greatest(0, (coalesce(p_page, 1) - 1) * coalesce(p_page_size, 20));
  v_limit integer := greatest(1, coalesce(p_page_size, 20));
  v_dir text := case when lower(coalesce(p_sort_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_key text := lower(coalesce(p_sort_key, 'created'));
  v_sql text;
begin
  v_sql := $q$
    with base as (
      select
        i.id,
        i.form_id,
        f.name as form_name,
        f.version as form_version,
        i.student_id,
        coalesce(
          nullif(trim(concat_ws(' ', nullif(s.first_name,''), nullif(s.last_name,''))), ''),
          nullif(s.name,''),
          s.email,
          'Unknown student'
        ) as student_name,
        coalesce(s.email, '') as student_email,
        i.status,
        i.role_context,
        i.created_at,
        i.submitted_at,
        coalesce(i.submission_count, 0)::int as submission_count,
        i.start_date,
        i.end_date
      from public.skyline_form_instances i
      join public.skyline_forms f on f.id = i.form_id
      join public.skyline_students s on s.id = i.student_id
      where i.student_id is not null
        and ($1::bigint is null or i.form_id = $1::bigint)
        and ($2::bigint is null or i.student_id = $2::bigint)
        and (
          $3::bigint is null
          or exists (
            select 1
            from public.skyline_course_forms cf
            where cf.course_id = $3::bigint
              and cf.form_id = i.form_id
          )
        )
        and (
          coalesce($4::text, '') = ''
          or (
            i.status ilike ('%' || $4::text || '%')
            or i.role_context ilike ('%' || $4::text || '%')
            or f.name ilike ('%' || $4::text || '%')
            or coalesce(f.version,'') ilike ('%' || $4::text || '%')
            or coalesce(s.student_id,'') ilike ('%' || $4::text || '%')
            or coalesce(s.name,'') ilike ('%' || $4::text || '%')
            or coalesce(s.first_name,'') ilike ('%' || $4::text || '%')
            or coalesce(s.last_name,'') ilike ('%' || $4::text || '%')
            or coalesce(s.email,'') ilike ('%' || $4::text || '%')
          )
        )
    )
    select
      b.*,
      count(*) over() as total_count
    from base b
  $q$;

  if v_key = 'student' then
    v_sql := v_sql || format(' order by b.student_name %s, b.student_email %s, b.id %s ', v_dir, v_dir, v_dir);
  elsif v_key = 'form' then
    v_sql := v_sql || format(' order by b.form_name %s, b.form_version %s, b.id %s ', v_dir, v_dir, v_dir);
  elsif v_key = 'start' then
    v_sql := v_sql || format(' order by b.start_date %s nulls last, b.id %s ', v_dir, v_dir);
  elsif v_key = 'end' then
    v_sql := v_sql || format(' order by b.end_date %s nulls last, b.id %s ', v_dir, v_dir);
  elsif v_key = 'workflow' then
    v_sql := v_sql || format(' order by b.role_context %s, b.status %s, b.id %s ', v_dir, v_dir, v_dir);
  else
    v_sql := v_sql || format(' order by b.created_at %s, b.id %s ', v_dir, v_dir);
  end if;

  v_sql := v_sql || ' limit $5 offset $6 ';

  return query execute v_sql
    using
      p_form_id,
      p_student_id,
      p_course_id,
      nullif(trim(coalesce(p_search,'')), ''),
      v_limit,
      v_from;
end;
$$;

