-- Returns (student_id, form_id) pairs for batch/course within date window.
-- Used by Admin Batches → Student unit dates filters.
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
    and i.start_date ~ '^\d{4}-\d{2}-\d{2}$'
    and i.end_date ~ '^\d{4}-\d{2}-\d{2}$'
    -- Only include assessments fully inside the selected range.
    and (i.start_date::date) >= p_from_date
    and (i.end_date::date) <= p_to_date;
$$;

