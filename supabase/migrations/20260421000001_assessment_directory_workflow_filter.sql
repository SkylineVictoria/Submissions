-- Assessment directory: optional workflow filter (aligned with admin dashboard semantics).

create or replace function public.skyline_list_submitted_instances_paged(
  p_page integer default 1,
  p_page_size integer default 20,
  p_search text default null,
  p_course_id bigint default null,
  p_form_id bigint default null,
  p_student_id bigint default null,
  p_active_on date default null,
  p_workflow_status text default null,
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
        and (s.status is null or s.status = 'active')
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
        and (
          $5::date is null
          or (
            i.start_date is not null
            and i.start_date <= $5::date
            and (i.end_date is null or i.end_date >= $5::date)
          )
        )
        and (
          $6::text is null
          or trim(both from $6::text) = ''
          or lower(trim(both from $6::text)) = 'all'
          or (
            lower(trim(both from $6::text)) = 'awaiting_student'
            and i.status = 'draft'
          )
          or (
            lower(trim(both from $6::text)) = 'awaiting_trainer'
            and i.role_context = 'trainer'
            and i.status <> 'locked'
          )
          or (
            lower(trim(both from $6::text)) = 'awaiting_office'
            and i.role_context = 'office'
            and i.status <> 'locked'
          )
          or (
            lower(trim(both from $6::text)) = 'completed'
            and i.status = 'locked'
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

  v_sql := v_sql || ' limit $7 offset $8 ';

  return query execute v_sql
    using
      p_form_id,
      p_student_id,
      p_course_id,
      nullif(trim(coalesce(p_search,'')), ''),
      p_active_on,
      p_workflow_status,
      v_limit,
      v_from;
end;
$$;
