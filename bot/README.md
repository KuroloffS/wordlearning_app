# WordLearning Telegram bot

A Telegram bot for learning **German ↔ Russian** words with spaced repetition.

- Send it a German or Russian word, and it finds the translation, the article (der/die/das), the transcription and a native pronunciation.
- It **sends you a message when words are due for review**.

It runs entirely on Supabase:
- an Edge Function receives Telegram messages through a webhook;
- a scheduled database job calls it every minute to send reminders and look up pronunciations;
- the data lives in Postgres.

There is no server to rent or maintain.

## ✅ Status

| Part | State |
|---|---|
| Database (project **WordLearning Bot**, org Kuroloff, region Frankfurt) | ✅ all migrations applied |
| Edge Function `telegram-bot` | ✅ deployed (version `2026-11-04.5`) and tested end to end against the real dictionary |
| Every-minute background job (`wordlearning-bot-tick`) | ✅ running |
| `BOT_TOKEN` | ✅ connected; webhook, command menu and description set in Russian and German |

## What the bot does

**Only German ↔ Russian**
- **Interface:** Russian by default. Users whose Telegram is set to German get German. You can switch in ⚙️ → 🌐.
- **What you learn:** German by default. German speakers learn Russian by default. You can switch in ⚙️ → 🎓.
- The language you learn is always the "word" side of a card.

**Adding words**
- **Send just a word**, in German or Russian:

  | You send | Card |
  |---|---|
  | `Haus` | **das Haus** [haʊ̯s] — дом 🔊 |
  | `кошка` | **die Katze** [ˈkat͡sə] — кошка 🔊 |
  | `велосипед` | **das Fahrrad** [ˈfaːɐ̯ˌʁaːt] — велосипед 🔊 |
  | `schnell` | **schnell** [ʃnɛl] — быстрый, скорый 🔊 |

  The bot adds a missing article and fixes a wrong one: `katze` and `der Katze` both become *die Katze*.
- **Or add your own translation**, one pair per line: `lernen - учить - Ich lerne Deutsch.`
  - You can send up to 500 lines at once, for example two columns copied from Excel.
  - A pair written the other way round, such as `кошка - die Katze`, is turned around automatically.
  - Longer lists are looked up in the background within a minute. Bare German nouns get their article: `Hund` becomes *der Hund*.
- Words you already have are skipped.
- Automatic translation can be switched off in ⚙️ → 🔤.

**Learning**
- **🔊 Pronunciation.** The button sends a native recording from Wikimedia Commons as a voice message. You hear the German word if you learn German and the Russian word if you learn Russian. Each recording is uploaded to Telegram once, then reused.
- **Reviewing.** There are three modes:
  - **flashcards:** show the answer, then grade Again / Hard / Good / Easy, with the next interval shown on each button;
  - **multiple choice;**
  - **typing:** small typos are accepted, and a German noun with a missing or wrong article counts as "almost" (Hard).
- **Intervals.** 10 min → 1 day → 3 days → 7 days → 14 days → 1 month → 2 months → 4 months → 8 months.
  - **Again** restarts the word.
  - **Hard** repeats the current interval.
  - **Good** moves one step up.
  - **Easy** skips a step.
- **🔔 Reminders.** When words become due, the bot sends a "Start review" message.
  - At most one every 3 hours, and only every 12 hours after an ignored reminder.
  - None while you're studying.
  - None during quiet hours (23:00–08:00 by default).
  - Times are in your time zone: UTC+5 by default for the Russian interface, UTC+1 for the German one. Change it in ⚙️ or with `/timezone +3`.
- **Daily limit for new words:** 20 by default, changeable in Settings.
- **📊 Stats.** Words by status, due now, today's reviews and accuracy, streak, and a 7-day forecast.

**Managing words**
- `/list` shows your words page by page.
- `/find word` lets you ✏️ edit, 🔄 reset or 🗑 delete a word.
- `/export` sends a CSV that opens correctly in Excel.
- **⚙️ Settings:** what you learn, automatic translation, mode, direction (word→translation, translation→word or mixed), new words per day, reminders, quiet hours, time zone, interface language, and "delete all my words".

Commands: `/review /add /list /find /stats /settings /timezone /export /sample /help /cancel`

## Where the words come from

| Source | Used for |
|---|---|
| [German Wiktionary](https://de.wiktionary.org) | One request gives the article, IPA and the Russian translation of a German word, or the German meaning of a Russian word. |
| [Wikimedia Commons](https://commons.wikimedia.org) | Native pronunciation recordings. Commons serves MP3 versions that Telegram plays as voice messages. |
| [MyMemory](https://mymemory.translated.net) | Fallback machine translation for words that Wiktionary doesn't have, such as phrases and rare words. |

- No API keys are needed. Requests send a descriptive User-Agent, as Wikimedia asks.
- Wiktionary and Commons content is licensed CC BY-SA. The `/help` text credits both.

## How it works

```
Telegram ──webhook──▶ Edge Function telegram-bot ──▶ Postgres (users, cards, review_log)
                        ▲          │
pg_cron (every minute) ─┘          ├──▶ de.wiktionary.org (translation, article, IPA)
  ?action=tick                     ├──▶ Wikimedia Commons (pronunciation recordings)
                                   └──▶ MyMemory (fallback translation)
```

Every minute the tick does three things:
- It looks up articles and pronunciations for words added in bulk.
- It keeps the webhook connected. Once an hour it checks the connection and repairs it if needed. After an update that changes the command menu or descriptions (a new `SETUP_VERSION`), it sends them to Telegram again.
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

The health check `GET https://givkncacizyipeipzzjl.supabase.co/functions/v1/telegram-bot` returns the deployed version.

The Edge Function logs are in the dashboard under **Edge Functions → telegram-bot → Logs**.

## Settings (Edge Function secrets)

| Secret | Default | Meaning |
|---|---|---|
| `BOT_TOKEN` | — | **Required.** Token from @BotFather |
| `MYMEMORY_EMAIL` | — | Your email for MyMemory. Raises the free fallback quota from about 5,000 to about 50,000 characters a day |
| `REMINDER_GAP_MINUTES` | 180 | Minimum time between two reminders to the same user |
| `REMINDER_IDLE_MINUTES` | 20 | Don't remind someone who used the bot in the last N minutes |

To switch to a different bot, put its token in the `BOT_TOKEN` secret:
- Open the [Supabase dashboard](https://supabase.com/dashboard), go to **WordLearning Bot** → **Edge Functions** → **Secrets**, and update `BOT_TOKEN`.
- The function notices the new token and connects the webhook, command menu and descriptions within a minute.

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
   Bump `VERSION` in `supabase/functions/telegram-bot/index.ts` so the health check shows the new version.

If you change the commands or the bot description, also bump `SETUP_VERSION` in `bot/src/setup.js`. The next tick then sends them to Telegram again.

Database changes go into a new file in `supabase/migrations/`. Apply it with `supabase db push`.

### Self-test without Telegram

The function has a protected `?action=simulate` endpoint. It sends updates from **test users** (negative ids) through the real bot code, database and dictionary, with a fake Telegram API. It returns every message the bot would have sent.

Run these from the SQL Editor:

```sql
select net.http_post(
  url := 'https://givkncacizyipeipzzjl.supabase.co/functions/v1/telegram-bot?action=simulate',
  body := '{"updates":[{"update_id":1,"message":{"message_id":1,"date":0,"chat":{"id":-1,"type":"private"},"from":{"id":-1,"is_bot":false,"first_name":"Test","language_code":"ru"},"text":"Haus"}}]}'::jsonb,
  headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value->>'secret' from app_state where key='cron')));
-- a few seconds later:
select content from net._http_response order by id desc limit 1;
-- clean up the test user:
delete from users where id < 0;
```

Adding `"reminders": true` to the body also runs a reminder pass for test users. Adding `"enrich": true` runs the background lookup.

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

### Database notes

The columns used by the German ↔ Russian version are:
- `users.ui_lang`: the interface language, `ru` or `de`;
- `users.learn`: the language being learned, `de` or `ru`;
- `users.auto_translate`;
- `cards.audio_file_id`: Telegram's id of the uploaded recording.

The columns `users.lang` and `users.translate_to` and the function `touch_user` are left over from the earlier Uzbek/Russian/English version. Nothing uses them any more, and they can be dropped.

## Code layout

```
bot/src/bot.js            commands, buttons, review flow, settings
bot/src/dictionary.js     German Wiktionary + Wikimedia Commons (article, IPA, translation, recordings)
bot/src/translate.js      German/Russian helpers and the MyMemory fallback
bot/src/i18n.js           all texts in Russian and German
bot/src/samples.js        German ↔ Russian starter words
bot/src/reminders.js      reminders and background lookups
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

There are 45 tests. They drive the whole bot with simulated Telegram updates, covering:
- both interface languages, both learning directions, automatic cards and the article rules;
- dictionary parsing against excerpts of real Wiktionary pages;
- pronunciation upload and reuse;
- every review mode, including article leniency when typing, and editing;
- settings and reminder rules (spacing, quiet hours, back-off, blocked users);
- background lookups, webhook and profile setup, and a check that the Edge Function copy is up to date.
