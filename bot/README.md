# WordLearning Telegram bot

A Telegram bot for learning words with spaced repetition. It works in Uzbek, Russian and English, translates new words automatically, adds pronunciation, and **sends you a message when words are due for review**.

It runs entirely on Supabase:
- an Edge Function receives Telegram messages through a webhook;
- a scheduled database job calls it every minute to send reminders;
- the data lives in Postgres.

There is no server to rent or maintain.

## ✅ Status

| Part | State |
|---|---|
| Database (project **WordLearning Bot**, org Kuroloff, region Frankfurt) | ✅ created, all migrations applied |
| Edge Function `telegram-bot` | ✅ deployed, tested end to end with simulated Telegram users |
| Every-minute background job (`wordlearning-bot-tick`) | ✅ running |
| **`BOT_TOKEN`** | ⏳ **the only thing left** (see below) |

## 🔑 Connect the bot token (one time)

1. In Telegram, open [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name and a username, and copy the **token** (it looks like `123456789:AA…`).
2. Open the [Supabase dashboard](https://supabase.com/dashboard) and go to project **WordLearning Bot** → **Edge Functions** → **Secrets**.
3. Add a secret named `BOT_TOKEN` with your token as the value, and save.

That's all. Within one minute the background job:
- connects the webhook;
- sets the command menu and the bot description in all three languages.

Open your bot in Telegram and press **Start**.

To change the bot later, put the new token in the same secret. The function notices the change and reconfigures itself.

## What the bot does

- **Three languages.** The interface is Uzbek, Russian or English, picked from the user's Telegram language. You can change it in ⚙️ Settings.
- **Adding words**
  - Send `word - translation - example`, one per line, up to 500 lines at a time, for example two columns copied from Excel.
  - **Or send just the word.** The bot translates it with MyMemory into the user's language, for example `apple` → `olma`.
  - If you send a word in your own language, such as `kitob`, the bot creates the English card instead: `book — kitob`.
  - Words you already have are skipped.
- **Pronunciation.** English words get their transcription (`/ˈæp.əl/`) and a 🔊 button that plays the pronunciation. Both come from the Free Dictionary API.
- **Reviewing.** There are three modes:
  - **flashcards:** show the answer, then grade Again / Hard / Good / Easy, with the next interval shown on each button;
  - **multiple choice;**
  - **typing:** small typos and missing accents are accepted.
- **Intervals.** 10 min → 1 day → 3 days → 7 days → 14 days → 1 month → 2 months → 4 months → 8 months.
  - **Again** restarts the word.
  - **Hard** repeats the current interval.
  - **Good** moves one step up.
  - **Easy** skips a step.
- **🔔 Reminders.** When words become due, the bot sends a "Start review" message.
  - At most one every 3 hours, and only every 12 hours after an ignored reminder.
  - None while you're studying.
  - None during quiet hours (23:00–08:00 by default) in your time zone (UTC+5 by default).
- **Daily limit for new words:** 20 by default, changeable in Settings.
- **📊 Stats.** Words by status, due now, today's reviews and accuracy, streak, and a 7-day forecast.
- **📋 Managing words.**
  - `/list` shows your words page by page.
  - `/find word` lets you ✏️ edit, 🔄 reset or 🗑 delete a word.
  - `/export` sends a CSV that opens correctly in Excel.
- **⚙️ Settings:** mode, direction (word→translation, translation→word or mixed), new words per day, reminders, quiet hours, time zone, translation language, interface language, and "delete all my words".

Commands: `/review /add /list /find /stats /settings /timezone /export /sample /help /cancel`

## How it works

```
Telegram ──webhook──▶ Edge Function telegram-bot ──▶ Postgres (users, cards, review_log)
                        ▲          │
pg_cron (every minute) ─┘          ├──▶ MyMemory (translation)
  ?action=tick                     └──▶ dictionaryapi.dev (transcription, audio)
```

Every minute the tick does three things:
- It looks up pronunciations for words added in bulk.
- Once `BOT_TOKEN` exists, it connects the webhook. After that it checks the connection once an hour and repairs it if needed.
- It sends due reminders. The reminder query claims users atomically, so a user is never reminded twice.

**Security**
- Telegram requests are accepted only with a secret token derived from `BOT_TOKEN`.
- Background calls need a random secret stored in `public.app_state`.
- Row Level Security is on for every table, and the public API keys have no access at all. Only the function, with the project's secret key, reads and writes data.

### Checking that everything works

Run these in the Supabase **SQL Editor**:

```sql
-- Result of the last background run (webhook state, reminders sent, errors)
select value from app_state where key = 'tick_status';

-- Webhook bookkeeping (last Telegram delivery error, if any)
select value from app_state where key = 'webhook';

-- Scheduled job runs
select status, start_time from cron.job_run_details order by start_time desc limit 5;
```

The Edge Function logs are in the dashboard under **Edge Functions → telegram-bot → Logs**.

## Optional settings (Edge Function secrets)

| Secret | Default | Meaning |
|---|---|---|
| `BOT_TOKEN` | — | **Required.** Token from @BotFather |
| `MYMEMORY_EMAIL` | — | Your email for MyMemory. Raises the free translation quota from about 5,000 to about 50,000 characters a day |
| `REMINDER_GAP_MINUTES` | 180 | Minimum time between two reminders to the same user |
| `REMINDER_IDLE_MINUTES` | 20 | Don't remind someone who used the bot in the last N minutes |

## Changing the code

The bot logic lives in `bot/src`. The Edge Function in `supabase/functions/telegram-bot` uses a generated copy of it in `lib/`.

1. Edit the files in `bot/src` (or `js/srs.js` for the scheduler).
2. Run the tests:
```bash
cd bot && npm install && npm test
```
3. Regenerate the function's copy. A test fails if you forget this step.
```bash
npm run build:edge
```
4. Deploy with the [Supabase CLI](https://supabase.com/docs/guides/cli), from the repository root:
```bash
supabase link --project-ref givkncacizyipeipzzjl
```
```bash
supabase functions deploy telegram-bot --no-verify-jwt
```
   Bump `VERSION` in `supabase/functions/telegram-bot/index.ts`. The health check shows it at `GET https://givkncacizyipeipzzjl.supabase.co/functions/v1/telegram-bot`.

Database changes go into a new file in `supabase/migrations/`. Apply it with `supabase db push`.

### Self-test without Telegram

The function has a protected `?action=simulate` endpoint. It sends updates from **test users** (negative ids) through the real bot code and database, with a fake Telegram API, and returns every message the bot would have sent. From the SQL Editor:

```sql
select net.http_post(
  url := 'https://givkncacizyipeipzzjl.supabase.co/functions/v1/telegram-bot?action=simulate',
  body := '{"updates":[{"update_id":1,"message":{"message_id":1,"date":0,"chat":{"id":-1,"type":"private"},"from":{"id":-1,"is_bot":false,"first_name":"Test","language_code":"uz"},"text":"apple"}}]}'::jsonb,
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value->>'secret' from app_state where key='cron')));
-- a few seconds later:
select content from net._http_response order by id desc limit 1;
-- clean up the test user:
delete from users where id < 0;
```

### Running locally (development only)

```bash
cd bot && cp .env.example .env
```
Fill in `.env`. Set `DB=memory` to try the bot without a database. Then start it:
```bash
npm start
```

This uses long polling, which removes the Supabase webhook. **Don't run it with the production token**, or use a second test bot from @BotFather. The deployed function re-connects its webhook within an hour.

## Setting it up in a different Supabase project

1. Run the files in `supabase/migrations/` in order. Use the SQL Editor or `supabase db push`.
2. Deploy the function with `supabase functions deploy telegram-bot --no-verify-jwt`.
3. Tell the scheduled job where the function is:
   ```sql
   insert into app_state (key, value)
   values ('tick', jsonb_build_object('url', 'https://<project-ref>.supabase.co/functions/v1/telegram-bot?action=tick'))
   on conflict (key) do update set value = excluded.value;
   ```
4. Add the `BOT_TOKEN` secret.

## Code layout

```
bot/src/bot.js            commands, buttons, review flow, settings
bot/src/i18n.js           all texts in English, Russian and Uzbek
bot/src/translate.js      MyMemory + Free Dictionary API clients
bot/src/reminders.js      reminders and background pronunciation lookups
bot/src/setup.js          webhook, command menu and bot description setup
bot/src/time.js           time zones, quiet hours, streak
bot/src/db/supabase.js    Supabase data access
bot/src/db/memory.js      the same interface in memory (tests, DB=memory)
bot/src/index.js          local long-polling runner
bot/scripts/build-edge.mjs   copies the code above into the Edge Function
js/srs.js                 spaced-repetition scheduler (shared with the web app)
supabase/functions/telegram-bot/index.ts   Edge Function: webhook, tick, simulate
supabase/migrations/      database schema, functions and the scheduled job
```

## Tests

```bash
cd bot && npm test
```

There are 36 tests. They drive the whole bot with simulated Telegram updates, covering:
- all three languages, auto-translation and pronunciation;
- every review mode and editing;
- settings and reminder rules (spacing, quiet hours, back-off, blocked users);
- webhook setup, and a check that the Edge Function copy is up to date.
