# WordLearning

A spaced-repetition vocabulary trainer. Add words with translations. Each word you learn comes back for review at growing intervals, timed for just before you would forget it.

No build step and no dependencies. It's plain HTML, CSS and JavaScript. Data is saved in the browser (`localStorage`). It works offline and can be installed as an app (PWA).

## How the intervals work

Each word has a **stage** that counts how many times in a row you have answered it correctly. The default schedule is:

| Stage | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| Next review after | 10 min | 1 day | 3 days | 1 week | 2 weeks | 1 month | 2 months | 4 months | 8 months |

After every review you rate yourself:

- **Again**: you forgot it. The word goes back to the start and appears again in about a minute.
- **Hard**: you remembered with difficulty. The current interval repeats.
- **Good**: the word moves one step up.
- **Easy**: the word skips a step.

Each button shows the interval it will set. You can edit the schedule in **Settings**, for example `10m, 1d, 3d, 7d, 14d, 1mo`.

## Features

- **Study modes:** flashcards, typing the answer, or multiple choice. Typed answers are graded automatically: small typos and missing accents are accepted, and any of several translations separated by `,` or `/` counts.
- **Directions:** word → translation, translation → word, or mixed.
- **Daily limit for new words:** 20 by default. New words are mixed in among the due reviews.
- **Free practice:** practise a whole deck without changing any schedules.
- **Decks:** create, rename and delete them. You can search and filter by status (new, learning, known, mastered, due).
- **Bulk import:** paste lines like `word - translation - example`, or copy straight from a spreadsheet.
- **Pronunciation:** text-to-speech in the language you choose, with optional auto-play.
- **Stats:** the review forecast for the next 7 days, reviews over the last 14 days, words by stage, your streak and your accuracy.
- **Reminders:** a due-count badge, a count in the tab title, and an optional browser notification when words become due.
- **Backup:** export and import JSON, export CSV.
- **Keyboard shortcuts:** `Space` shows the answer, `1`–`4` grade it, `Enter` picks the suggested grade, and `S` speaks the word.

## Run

```bash
npm start
```

Then open http://localhost:8080. Any static file server works, for example GitHub Pages or Netlify. ES modules need to be served over http(s), not opened directly as `file://`.

## Test

```bash
npm test
```

## Structure

```
index.html          UI (all views)
css/style.css       styles, light/dark theme
js/srs.js           spaced-repetition scheduler and helpers (pure, unit-tested)
js/storage.js       localStorage persistence, daily log, streak
js/app.js           UI logic: study sessions, word list, stats, settings
sw.js               offline cache
tests/srs.test.js   scheduler tests (node --test)
```

## Telegram bot

The `bot/` folder has the Telegram version, which is **deployed and running on Supabase**:
- an Edge Function with a webhook;
- a scheduled job that sends reminders when words are due;
- an interface in Uzbek, Russian and English;
- automatic translation and pronunciation for new words.

The only remaining step is adding the `BOT_TOKEN` secret. See [bot/README.md](bot/README.md).
