-- Reminder back-off: if a user did not open the bot after the last reminder, wait 4× longer
-- (12 h with the default 3 h gap) before reminding again, instead of nagging every few hours.

create or replace function public.reminder_gap_passed(
  p_last_notified timestamptz,
  p_last_active timestamptz,
  p_now timestamptz,
  p_gap_min integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_last_notified is null
      or (p_last_notified < p_now - make_interval(mins => p_gap_min)
          and (p_last_active > p_last_notified                                   -- used the bot since the last reminder
               or p_last_notified < p_now - make_interval(mins => p_gap_min * 4))); -- ignored it: wait 4× longer
$$;

create or replace function public.claim_reminders(
  p_now timestamptz,
  p_gap_min integer,
  p_idle_min integer,
  p_limit integer,
  p_test boolean default false
)
returns table (user_id bigint, due_count bigint, lang text, prev_notified_at timestamptz)
language sql
set search_path = ''
as $$
  with cand as (
    select u.id, count(c.id) as due_count
    from public.users u
    join public.cards c on c.user_id = u.id and c.reps > 0 and c.due <= p_now
    where u.remind
      and case when p_test then u.id < 0 else u.id > 0 end
      and public.reminder_gap_passed(u.last_notified_at, u.last_active_at, p_now, p_gap_min)
      and (u.last_active_at is null or u.last_active_at < p_now - make_interval(mins => p_idle_min))
      and not public.is_quiet_hour(
        extract(hour from (p_now at time zone 'UTC') + make_interval(mins => u.tz_offset_min))::integer,
        u.quiet_start, u.quiet_end)
    group by u.id
    order by min(c.due)
    limit p_limit
  ),
  locked as (
    select u.id, u.last_notified_at as prev
    from public.users u
    join cand on cand.id = u.id
    where public.reminder_gap_passed(u.last_notified_at, u.last_active_at, p_now, p_gap_min)
    for update of u skip locked
  ),
  upd as (
    update public.users u
       set last_notified_at = p_now
      from locked
     where u.id = locked.id
    returning u.id, u.lang, locked.prev
  )
  select upd.id, cand.due_count, upd.lang, upd.prev
  from upd
  join cand on cand.id = upd.id;
$$;

revoke all on function public.reminder_gap_passed(timestamptz, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.reminder_gap_passed(timestamptz, timestamptz, timestamptz, integer) to service_role;
