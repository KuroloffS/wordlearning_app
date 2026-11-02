# WordLearning Telegram bot

A Telegram bot for learning words with spaced repetition. It stores data in Supabase and **sends you a message when words are due for review**.

## What it does

- **Add words** by sending them as text, one per line:
  ```
  apple - яблоко
  to borrow - занимать, брать взаймы - Can I borrow your pen?
  house	дом
  ```
  The format is `word - translation - optional example`. Tab, `=` and `;` also work as separators. You can paste up to 500 lines at once, for example two columns copied from Excel. Words you already have are skipped.
- **📚 Review** has three modes:
  - **Flashcards:** Show answer, then grade Again / Hard / Good / Easy. Each button shows when the word will come back.
  - **Multiple choice:** pick one of 4 options.
  - **Type the answer:** small typos are accepted, as is any of several translations.
- **Intervals:** 10m → 1d → 3d → 7d → 14d → 1mo → 2mo → 4mo → 8mo.
  - **Again** restarts the word.
  - **Hard** repeats the current interval.
  - **Good** moves one step up.
  - **Easy** skips a step.
- **Directions:** word → translation, translation → word, or mixed.
- **Daily limit for new words:** 20 by default.
- **🔔 Reminders:** when words become due, the bot sends a message with a "▶️ Start review" button.
  - At most one reminder every 3 hours.
  - No reminders while you're studying.
  - No reminders during quiet hours (23:00–08:00 by default), based on your time zone (UTC+5 by default).
- **📊 Stats:** word counts by status, words due now, today's reviews, streak, accuracy, and upcoming reviews for the next 7 days.
- **📋 My words:** a paged list. Use `/find word` to delete a word or reset its progress. `/export` sends a CSV file.
- **⚙️ Settings:** study mode, direction, new words per day, reminders on/off, quiet hours, time zone (`/timezone +5:30` for an exact value), and deleting all words.

Commands: `/review /add /list /find /stats /settings /timezone /export /sample /help /cancel`

## Setup

### 1. Create the bot

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Copy the **token**.

### 2. Create the database

1. Create a project at [supabase.com](https://supabase.com). The free plan is enough.
2. Open **SQL Editor**, paste the whole file [`supabase/migrations/20261102000000_wordlearning_bot.sql`](../supabase/migrations/20261102000000_wordlearning_bot.sql), and click **Run**.
3. Go to **Project Settings → API** and copy the **Project URL** and the **service_role** key, also called the *secret* key.

   The service_role key gives full access to the database. Keep it only on the server where the bot runs, and never share it or commit it. All tables have Row Level Security turned on with no policies, so the public anon key can't read anything.

If you use the Supabase CLI, you can apply the migration with `supabase link` followed by `supabase db push` instead of step 2.

### 3. Run locally

Run these commands from the repository root:

```bash
cd bot
```
```bash
npm install
```
```bash
cp .env.example .env
```

Fill in `BOT_TOKEN`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env`, then start the bot:

```bash
npm start
```

Open your bot in Telegram and press **Start**. Node.js 20.12 or newer is required.

To try the bot quickly without Supabase, set `DB=memory` in `.env`. The data is lost on restart.

## Deploy (keep it running 24/7)

The bot uses long polling, so it doesn't need a public URL or a domain. It only needs a process that runs all the time, because the reminders come from that process.

**VPS (Ubuntu) with pm2:**
```bash
npm i -g pm2
```
```bash
cd wordlearning_app/bot && npm ci --omit=dev
```
```bash
pm2 start src/index.js --name wordlearning-bot
```
```bash
pm2 save && pm2 startup
```

**Docker:** the `Dockerfile` is in the repository root. Build from the root:
```bash
docker build -t wordlearning-bot .
```
```bash
docker run -d --restart=always --env-file bot/.env --name wordlearning-bot wordlearning-bot
```

**Railway / Render / Fly.io:** deploy the repository with the root `Dockerfile` and set the environment variables from `.env.example`.
- On Render, choose a **Background Worker**. Or choose a Web Service and set `PORT`, which turns on a small health-check endpoint.
- Run only **one** copy of the bot. Telegram allows only one polling connection per token.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `BOT_TOKEN` | — | Token from @BotFather |
| `SUPABASE_URL` | — | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | service_role / secret key |
| `REMINDER_CHECK_SECONDS` | 60 | How often to look for due words |
| `REMINDER_GAP_MINUTES` | 180 | Minimum time between two reminders to the same user |
| `REMINDER_IDLE_MINUTES` | 20 | Don't remind someone who used the bot in the last N minutes |
| `PORT` | — | If set, serves `ok` on this port, for hosts that need a health check |
| `DB` | — | `memory` runs without Supabase (testing only) |

## Tests

```bash
npm test
```

The tests drive the whole bot with simulated Telegram updates and an in-memory database. They cover adding words, all three review modes, protection against double-pressed buttons, the daily limit, settings, list, find, delete, export, stats and the reminder rules.

## Code layout

```
bot/src/index.js         entry point: env, polling, reminder loop
bot/src/bot.js           all commands, buttons and messages
bot/src/reminders.js     finds users with due words and messages them
bot/src/time.js          time zones, quiet hours, streak
bot/src/db/supabase.js   Supabase data access
bot/src/db/memory.js     same interface in memory (tests, DB=memory)
js/srs.js                spaced-repetition scheduler, shared with the web app
supabase/migrations/     database schema
```

## Database

| Table | Contents |
|---|---|
| `users` | Telegram user, settings, reminder state |
| `cards` | Words: `stage` (step on the interval ladder), `reps`, `due` |
| `review_log` | Every answer, used for stats, streaks and the daily new-word limit |

| Function | Purpose |
|---|---|
| `add_cards()` | Bulk insert that skips duplicates |
| `user_stats()` | Everything the stats screen needs, in one call |
| `due_users()` | Who should get a reminder now |
