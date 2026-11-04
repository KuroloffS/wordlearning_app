-- WordLearning Telegram bot schema.
-- The bot talks to the database with the service_role key from its server.
-- RLS is enabled with no policies, so the public anon key cannot read or write anything.

create table if not exists public.users (
  id               bigint primary key,               -- Telegram user id
  username         text,
  first_name       text,
  language_code    text,
  mode             text     not null default 'flip'    check (mode in ('flip', 'choice', 'type')),
  direction        text     not null default 'forward' check (direction in ('forward', 'reverse', 'mixed')),
  new_per_day      integer  not null default 20        check (new_per_day between 0 and 500),
  remind           boolean  not null default true,
  tz_offset_min    integer  not null default 300       check (tz_offset_min between -720 and 840),
  quiet_start      smallint not null default 23        check (quiet_start between 0 and 23),
  quiet_end        smallint not null default 8         check (quiet_end between 0 and 23),
  pending          jsonb,                              -- e.g. the card waiting for a typed answer
  last_active_at   timestamptz,
  last_notified_at timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists public.cards (
  id            uuid primary key default gen_random_uuid(),
  user_id       bigint  not null references public.users (id) on delete cascade,
  word          text    not null check (length(word) between 1 and 200),
  translation   text    not null check (length(translation) between 1 and 300),
  example       text    not null default '' check (length(example) <= 500),
  stage         integer not null default 0,
  reps          integer not null default 0,
  lapses        integer not null default 0,
  due           timestamptz not null default now(),
  last_reviewed timestamptz,
  created_at    timestamptz not null default now()
);

create unique index if not exists cards_user_word_uniq on public.cards (user_id, lower(word));
create index if not exists cards_user_due_idx on public.cards (user_id, due) where reps > 0;
create index if not exists cards_user_new_idx on public.cards (user_id, created_at) where reps = 0;
create index if not exists cards_due_idx on public.cards (due) where reps > 0;

create table if not exists public.review_log (
  id          bigint generated always as identity primary key,
  user_id     bigint   not null references public.users (id) on delete cascade,
  card_id     uuid     references public.cards (id) on delete set null,
  grade       smallint not null check (grade between 0 and 3),
  was_new     boolean  not null default false,
  reviewed_at timestamptz not null default now()
);

create index if not exists review_log_user_time_idx on public.review_log (user_id, reviewed_at);
create index if not exists review_log_card_idx on public.review_log (card_id);

alter table public.users enable row level security;
alter table public.cards enable row level security;
alter table public.review_log enable row level security;

-- Adds many words at once, skipping words the user already has. Returns the number added.
create or replace function public.add_cards(p_user bigint, p_items jsonb, p_now timestamptz)
returns integer
language sql
set search_path = ''
as $$
  with ins as (
    insert into public.cards (user_id, word, translation, example, due, created_at)
    select p_user,
           left(trim(t.item ->> 'word'), 200),
           left(trim(t.item ->> 'translation'), 300),
           left(coalesce(trim(t.item ->> 'example'), ''), 500),
           p_now,
           p_now + t.ord * interval '1 millisecond'   -- keeps the input order for new words
    from jsonb_array_elements(p_items) with ordinality as t(item, ord)
    where coalesce(trim(t.item ->> 'word'), '') <> ''
      and coalesce(trim(t.item ->> 'translation'), '') <> ''
    on conflict (user_id, lower(word)) do nothing
    returning 1
  )
  select count(*)::integer from ins;
$$;

-- All numbers for the /stats screen in one round trip.
create or replace function public.user_stats(p_user bigint, p_now timestamptz, p_tz_offset_min integer, p_max_stage integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with
  off as (select make_interval(mins => p_tz_offset_min) as i),
  today as (select ((p_now at time zone 'UTC') + (select i from off))::date as d),
  c as (select stage, reps, due from public.cards where user_id = p_user),
  l as (
    select grade, was_new, ((reviewed_at at time zone 'UTC') + (select i from off))::date as day
    from public.review_log
    where user_id = p_user
  )
  select jsonb_build_object(
    'total',         (select count(*) from c),
    'new',           (select count(*) from c where reps = 0),
    'learning',      (select count(*) from c where reps > 0 and stage < 4),
    'known',         (select count(*) from c where reps > 0 and stage >= 4 and stage < p_max_stage),
    'mastered',      (select count(*) from c where reps > 0 and stage >= p_max_stage),
    'due',           (select count(*) from c where reps > 0 and due <= p_now),
    'reviews_today', (select count(*) from l where day = (select d from today)),
    'correct_today', (select count(*) from l where day = (select d from today) and grade >= 1),
    'new_today',     (select count(*) from l where day = (select d from today) and was_new),
    'reviews_total', (select count(*) from l),
    'correct_total', (select count(*) from l where grade >= 1),
    'days',          (select coalesce(jsonb_agg(x.day order by x.day desc), '[]'::jsonb)
                      from (select distinct to_char(day, 'YYYY-MM-DD') as day from l
                            where day > (select d from today) - 400) x),
    'forecast',      (select jsonb_agg(f.cnt order by f.n)
                      from (
                        select g.n, (
                          select count(*) from c
                          where reps > 0 and (
                            (g.n = 0 and (due <= p_now or ((due at time zone 'UTC') + (select i from off))::date = (select d from today)))
                            or (g.n > 0 and due > p_now and ((due at time zone 'UTC') + (select i from off))::date = (select d from today) + g.n)
                          )
                        ) as cnt
                        from generate_series(0, 6) as g(n)
                      ) f)
  );
$$;

-- Users who should get a "words are due" reminder now.
create or replace function public.due_users(p_now timestamptz, p_gap_min integer, p_idle_min integer)
returns table (user_id bigint, due_count bigint, tz_offset_min integer, quiet_start smallint, quiet_end smallint)
language sql
stable
set search_path = ''
as $$
  select u.id, count(c.id), u.tz_offset_min, u.quiet_start, u.quiet_end
  from public.users u
  join public.cards c on c.user_id = u.id and c.reps > 0 and c.due <= p_now
  where u.remind
    and (u.last_notified_at is null or u.last_notified_at < p_now - make_interval(mins => p_gap_min))
    and (u.last_active_at   is null or u.last_active_at   < p_now - make_interval(mins => p_idle_min))
  group by u.id;
$$;

revoke all on function public.add_cards(bigint, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.user_stats(bigint, timestamptz, integer, integer) from public, anon, authenticated;
revoke all on function public.due_users(timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.add_cards(bigint, jsonb, timestamptz) to service_role;
grant execute on function public.user_stats(bigint, timestamptz, integer, integer) to service_role;
grant execute on function public.due_users(timestamptz, integer, integer) to service_role;
