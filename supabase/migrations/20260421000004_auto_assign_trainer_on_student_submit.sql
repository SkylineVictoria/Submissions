-- Auto-assign trainer queue on student submit:
-- When a student submits (draft -> submitted), move the instance to trainer role_context automatically.
-- This ensures trainers see submissions without admins clicking "Send to trainer".

create or replace function public.skyline_auto_assign_trainer_on_student_submit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only auto-assign when the student is submitting their own draft.
  if (tg_op = 'UPDATE')
     and (old.status is distinct from new.status)
     and (coalesce(old.status, 'draft') = 'draft')
     and (new.status = 'submitted')
     and (coalesce(old.role_context, 'student') = 'student')
  then
    -- Only if student belongs to a batch with a trainer.
    if exists (
      select 1
      from public.skyline_students s
      join public.skyline_batches b on b.id = s.batch_id
      where s.id = new.student_id
        and b.trainer_id is not null
    ) then
      new.role_context := 'trainer';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists skyline_auto_assign_trainer_on_student_submit on public.skyline_form_instances;
create trigger skyline_auto_assign_trainer_on_student_submit
before update on public.skyline_form_instances
for each row
execute function public.skyline_auto_assign_trainer_on_student_submit();

-- Backfill: any already-submitted instances still stuck in student role move to trainer,
-- but only when the student is in a batch with a trainer.
update public.skyline_form_instances i
set role_context = 'trainer'
from public.skyline_students s
join public.skyline_batches b on b.id = s.batch_id
where i.student_id = s.id
  and b.trainer_id is not null
  and i.status = 'submitted'
  and coalesce(i.role_context, 'student') = 'student';

comment on function public.skyline_auto_assign_trainer_on_student_submit() is
  'Auto move student submission to trainer queue when batch has trainer.';

