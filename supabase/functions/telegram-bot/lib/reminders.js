// GENERATED from bot/src/reminders.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
// Background work, run once a minute (Supabase cron → Edge Function, or a timer in the Node runner):
//  - message users whose words are due for review
//  - look up transcription/pronunciation for newly added English words
import { InlineKeyboard, GrammyError } from 'grammy';
import { t, LANGS } from './i18n.js';
import { englishCandidate, mapLimit } from './translate.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One reminder pass. Returns { sent, failed }.
 * gapMin  – minimum minutes between two reminders to the same user
 * idleMin – don't remind users who used the bot in the last N minutes (they're studying already)
 * test    – only synthetic test users (negative ids); real users otherwise
 */
export async function sendReminders(api, db, { now = Date.now(), gapMin = 180, idleMin = 20, limit = 150, test = false, pauseMs = 40 } = {}) {
  const rows = await db.claimReminders(now, gapMin, idleMin, limit, test);
  let sent = 0;
  let failed = 0;
  for (const r of rows) {
    const lang = LANGS.includes(r.lang) ? r.lang : 'en';
    const n = Number(r.due_count);
    try {
      await api.sendMessage(r.user_id, t(lang, 'reminder', n), {
        parse_mode: 'HTML',
        reply_markup: new InlineKeyboard().text(t(lang, 'btn_start_review'), 'review'),
      });
      sent++;
    } catch (e) {
      failed++;
      if (e instanceof GrammyError && (e.error_code === 403 || (e.error_code === 400 && /chat not found|user is deactivated/i.test(e.description)))) {
        // The user blocked the bot or deleted their account: stop reminding them.
        await db.updateUser(r.user_id, { remind: false });
      } else {
        // Temporary problem: release the claim so the next pass retries.
        await db.updateUser(r.user_id, { last_notified_at: r.prev_notified_at ?? null });
        if (e instanceof GrammyError && e.error_code === 429) await sleep(Math.min(10, e.parameters?.retry_after ?? 3) * 1000);
        else console.error('Reminder failed for', r.user_id, e.message);
      }
    }
    if (pauseMs) await sleep(pauseMs); // stay well below Telegram's ~30 messages/second limit
  }
  return { sent, failed };
}

/**
 * Looks up transcription + pronunciation audio for words added in bulk.
 * Words that aren't English (or have no entry) are marked done with empty values.
 * Network errors leave the card for a later pass.
 */
export async function enrichCards(db, dictionary, { limit = 25 } = {}) {
  if (!dictionary) return { done: 0 };
  const cards = await db.cardsToEnrich(limit);
  let done = 0;
  await mapLimit(cards, 4, async (c) => {
    try {
      const r = englishCandidate(c.word) ? await dictionary(c.word) : null;
      await db.saveEnrichment(c.id, { phonetic: r?.phonetic ?? '', audio_url: r?.audio_url ?? '' });
      done++;
    } catch (e) {
      console.warn('Enrichment failed for', c.word, e.message);
    }
  });
  return { done, pending: cards.length - done };
}

/** Node runner helper: runs both jobs on a timer. Returns a stop function. */
export function startBackgroundLoop(api, db, { everySec = 60, gapMin, idleMin, dictionary } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await sendReminders(api, db, { now: Date.now(), gapMin, idleMin });
      if (r.sent) console.log(`Sent ${r.sent} reminder(s)`);
      await enrichCards(db, dictionary);
    } catch (e) {
      console.error('Background pass failed:', e.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everySec * 1000);
  tick();
  return () => clearInterval(timer);
}
