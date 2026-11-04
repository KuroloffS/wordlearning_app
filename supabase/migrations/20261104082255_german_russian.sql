-- WordLearning bot v3: German ↔ Russian only.
-- Additive only: nothing is dropped or rewritten, so the previous bot version keeps working until
-- the new one is deployed. The interface language moves to the new column ui_lang ('ru' or 'de');
-- the old columns lang and translate_to are no longer used by the bot.

alter table public.users add column if not exists ui_lang text not null default 'ru' check (ui_lang in ('ru', 'de'));
-- What the user learns: German words with Russian translations ('de') or the other way round ('ru').
alter table public.users add column if not exists learn text not null default 'de' check (learn in ('de', 'ru'));
-- Single words are translated automatically (German Wiktionary, MyMemory as fallback).
alter table public.users add column if not exists auto_translate boolean not null default true;

-- Telegram's id of an uploaded pronunciation, so each recording is downloaded only once.
alter table public.cards add column if not exists audio_file_id text not null default '' check (length(audio_file_id) <= 200);

-- Creates the user on first contact with default settings; afterwards only refreshes name/activity.
create or replace function public.touch_user_v3(
  p_id bigint,
  p_username text,
  p_first_name text,
  p_language_code text,
  p_ui_lang text,
  p_learn text,
  p_tz_offset_min integer,
  p_now timestamptz
)
returns public.users
language sql
set search_path = ''
as $$
  insert into public.users as u (id, username, first_name, language_code, ui_lang, learn, tz_offset_min, last_active_at)
  values (
    p_id, p_username, p_first_name, p_language_code,
    case when p_ui_lang in ('ru', 'de') then p_ui_lang else 'ru' end,
    case when p_learn in ('de', 'ru') then p_learn else 'de' end,
    case when p_tz_offset_min between -720 and 840 then p_tz_offset_min else 300 end,
    p_now
  )
  on conflict (id) do update
    set username       = excluded.username,
        first_name     = excluded.first_name,
        language_code  = excluded.language_code,
        last_active_at = excluded.last_active_at
  returning u.*;
$$;

revoke all on function public.touch_user_v3(bigint, text, text, text, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.touch_user_v3(bigint, text, text, text, text, text, integer, timestamptz) to service_role;

-- Reminders are written in the interface language (ui_lang); otherwise unchanged.
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
    returning u.id, u.ui_lang, locked.prev
  )
  select upd.id, cand.due_count, upd.ui_lang, upd.prev
  from upd
  join cand on cand.id = upd.id;
$$;
