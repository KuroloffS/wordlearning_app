-- WordLearning bot v3: German ↔ Russian only.
-- Interface language: Russian (default) or German. Learned language: German (default) or Russian.

alter table public.users drop constraint if exists users_lang_check;
update public.users set lang = case when language_code ilike 'de%' then 'de' else 'ru' end where lang not in ('ru', 'de');
alter table public.users alter column lang set default 'ru';
alter table public.users add constraint users_lang_check check (lang in ('ru', 'de'));

-- What the user learns: German words with Russian translations ('de') or the other way round ('ru').
alter table public.users add column if not exists learn text not null default 'de' check (learn in ('de', 'ru'));
update public.users set learn = 'ru' where lang = 'de';
-- Single words are translated automatically (German Wiktionary, MyMemory as fallback).
alter table public.users add column if not exists auto_translate boolean not null default true;

-- Telegram's id of an uploaded pronunciation, so each recording is downloaded only once.
alter table public.cards add column if not exists audio_file_id text not null default '' check (length(audio_file_id) <= 200);

drop function if exists public.touch_user(bigint, text, text, text, text, text, timestamptz);
alter table public.users drop column if exists translate_to;

-- Creates the user on first contact with default settings; afterwards only refreshes name/activity.
create function public.touch_user(
  p_id bigint,
  p_username text,
  p_first_name text,
  p_language_code text,
  p_lang text,
  p_learn text,
  p_tz_offset_min integer,
  p_now timestamptz
)
returns public.users
language sql
set search_path = ''
as $$
  insert into public.users as u (id, username, first_name, language_code, lang, learn, tz_offset_min, last_active_at)
  values (
    p_id, p_username, p_first_name, p_language_code,
    case when p_lang in ('ru', 'de') then p_lang else 'ru' end,
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

revoke all on function public.touch_user(bigint, text, text, text, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.touch_user(bigint, text, text, text, text, text, integer, timestamptz) to service_role;
