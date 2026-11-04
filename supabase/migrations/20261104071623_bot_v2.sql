-- WordLearning bot v2: interface language, auto-translation, pronunciation, race-free reminder
-- claiming, a small state table for the Edge Function, and the every-minute background job.
-- Requires 20261104065221_enable_pg_net_pg_cron.sql.

-- ---------- users: interface language and auto-translation target ----------
alter table public.users add column if not exists lang text not null default 'en' check (lang in ('en', 'ru', 'uz'));
alter table public.users add column if not exists translate_to text check (translate_to ~ '^[a-z]{2}$');

-- ---------- cards: transcription and pronunciation audio (Free Dictionary API) ----------
alter table public.cards add column if not exists phonetic text not null default '' check (length(phonetic) <= 100);
alter table public.cards add column if not exists audio_url text not null default '' check (length(audio_url) <= 500);
alter table public.cards add column if not exists enriched boolean not null default false;
create index if not exists cards_enrich_idx on public.cards (created_at) where not enriched;

-- ---------- key/value state for the Edge Function ----------
-- 'cron'        { secret }  shared secret the scheduled job sends to the Edge Function
-- 'tick'        { url }     Edge Function URL the scheduled job calls (set per project, see README)
-- 'webhook'     Telegram webhook bookkeeping
-- 'tick_status' result of the last background run (handy for troubleshooting)
create table if not exists public.app_state (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;

insert into public.app_state (key, value)
values ('cron', jsonb_build_object('secret', encode(extensions.gen_random_bytes(32), 'hex')))
on conflict (key) do nothing;

-- Only the bot (service role / secret key) uses these tables; the public API keys get nothing.
revoke all on table public.users, public.cards, public.review_log, public.app_state from anon, authenticated;

-- ---------- functions used by the bot ----------

-- Creates the user on first contact with default language settings; afterwards only refreshes name/activity.
create or replace function public.touch_user(
  p_id bigint,
  p_username text,
  p_first_name text,
  p_language_code text,
  p_lang text,
  p_translate_to text,
  p_now timestamptz
)
returns public.users
language sql
set search_path = ''
as $$
  insert into public.users as u (id, username, first_name, language_code, lang, translate_to, last_active_at)
  values (
    p_id, p_username, p_first_name, p_language_code,
    case when p_lang in ('en', 'ru', 'uz') then p_lang else 'en' end,
    case when p_translate_to ~ '^[a-z]{2}$' then p_translate_to end,
    p_now
  )
  on conflict (id) do update
    set username       = excluded.username,
        first_name     = excluded.first_name,
        language_code  = excluded.language_code,
        last_active_at = excluded.last_active_at
  returning u.*;
$$;

-- Adds many words at once, skipping words the user already has. Returns the inserted cards.
drop function if exists public.add_cards(bigint, jsonb, timestamptz);
create function public.add_cards(p_user bigint, p_items jsonb, p_now timestamptz)
returns setof public.cards
language sql
set search_path = ''
as $$
  insert into public.cards (user_id, word, translation, example, phonetic, audio_url, enriched, due, created_at)
  select p_user,
         left(trim(t.item ->> 'word'), 200),
         left(trim(t.item ->> 'translation'), 300),
         left(coalesce(trim(t.item ->> 'example'), ''), 500),
         left(coalesce(t.item ->> 'phonetic', ''), 100),
         left(coalesce(t.item ->> 'audio_url', ''), 500),
         coalesce((t.item ->> 'enriched')::boolean, false),
         p_now,
         p_now + t.ord * interval '1 millisecond'   -- keeps the input order for new words
  from jsonb_array_elements(p_items) with ordinality as t(item, ord)
  where coalesce(trim(t.item ->> 'word'), '') <> ''
    and coalesce(trim(t.item ->> 'translation'), '') <> ''
  on conflict (user_id, lower(word)) do nothing
  returning *;
$$;

create or replace function public.is_quiet_hour(p_hour integer, p_start integer, p_end integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_start <> p_end
     and case when p_start < p_end then p_hour >= p_start and p_hour < p_end
              else p_hour >= p_start or p_hour < p_end end;
$$;

-- Picks users who should get a "words are due" reminder now and marks them as notified in the
-- same statement, so two overlapping runs can never remind the same user twice.
-- p_test = true selects only synthetic test users (negative ids) used by the self-test.
drop function if exists public.due_users(timestamptz, integer, integer);
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
      and (u.last_notified_at is null or u.last_notified_at < p_now - make_interval(mins => p_gap_min))
      and (u.last_active_at   is null or u.last_active_at   < p_now - make_interval(mins => p_idle_min))
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
    where u.last_notified_at is null or u.last_notified_at < p_now - make_interval(mins => p_gap_min)
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

revoke all on function public.touch_user(bigint, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.add_cards(bigint, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.is_quiet_hour(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.claim_reminders(timestamptz, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.touch_user(bigint, text, text, text, text, text, timestamptz) to service_role;
grant execute on function public.add_cards(bigint, jsonb, timestamptz) to service_role;
grant execute on function public.is_quiet_hour(integer, integer, integer) to service_role;
grant execute on function public.claim_reminders(timestamptz, integer, integer, integer, boolean) to service_role;

-- ---------- every-minute background job ----------
-- Calls the Edge Function (?action=tick) with the shared secret. Does nothing until the
-- 'tick' row with the function URL exists.
create or replace function public.bot_tick_request()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value ->> 'url' into v_url from public.app_state where key = 'tick';
  select value ->> 'secret' into v_secret from public.app_state where key = 'cron';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.bot_tick_request() from public, anon, authenticated;

select cron.schedule('wordlearning-bot-tick', '* * * * *', 'select public.bot_tick_request();');
