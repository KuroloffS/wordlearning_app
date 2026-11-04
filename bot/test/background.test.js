import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, USERS, fakeDictionary } from './helpers.js';
import { sendReminders, enrichCards } from '../src/reminders.js';
import { ensureWebhook, SETUP_VERSION } from '../src/setup.js';
import { createMemoryDb } from '../src/db/memory.js';
import { DAY, HOUR, MINUTE } from '../../js/srs.js';

async function learnOneWord(h, text = 'sun - quyosh') {
  await h.send('/start');
  await h.send(text);
  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[3]); // Easy → back in 1 day
}

test('reminders: due words, gap, quiet hours, language', async () => {
  // 09:00 UTC = 14:00 in UTC+5
  const h = harness({ start: Date.UTC(2026, 0, 5, 9, 0), user: USERS.uz });
  await learnOneWord(h);
  const opts = (now) => ({ now, gapMin: 180, idleMin: 20, pauseMs: 0 });

  assert.equal((await sendReminders(h.bot.api, h.db, opts(h.clock.now + HOUR))).sent, 0); // nothing due yet
  const later = h.clock.now + DAY + MINUTE;
  assert.equal((await sendReminders(h.bot.api, h.db, opts(later))).sent, 1);
  assert.match(h.last().text, /Takrorlash vaqti keldi! <b>1<\/b> ta soʻz/);
  assert.equal(h.last().chat_id, USERS.uz.id);
  assert.deepEqual(h.buttons(h.last()), ['review']);
  assert.equal((await sendReminders(h.bot.api, h.db, opts(later + HOUR))).sent, 0); // within the 3h gap
  // 23:30 local time is inside the default quiet hours (23:00–08:00).
  assert.equal((await sendReminders(h.bot.api, h.db, opts(Date.UTC(2026, 0, 6, 18, 30)))).sent, 0);
  assert.equal((await sendReminders(h.bot.api, h.db, opts(Date.UTC(2026, 0, 7, 4, 0)))).sent, 1); // 09:00 local
});

test('reminders: blocked users are switched off, temporary errors are retried', async () => {
  const h = harness();
  await learnOneWord(h);
  const now = h.clock.now + DAY + MINUTE;
  const blockedApi = { sendMessage: async () => Promise.reject(Object.assign(new (await import('grammy')).GrammyError('x', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 'sendMessage', {}))) };
  const r = await sendReminders(blockedApi, h.db, { now, pauseMs: 0 });
  assert.deepEqual(r, { sent: 0, failed: 1 });
  assert.equal(h.db._state.users.get(USERS.en.id).remind, false);

  const h2 = harness();
  await learnOneWord(h2);
  const flakyApi = { sendMessage: async () => Promise.reject(new Error('socket hang up')) };
  const now2 = h2.clock.now + DAY + MINUTE;
  await sendReminders(flakyApi, h2.db, { now: now2, pauseMs: 0 });
  assert.equal(h2.db._state.users.get(USERS.en.id).last_notified_at, null); // claim released
  assert.equal((await sendReminders(h2.bot.api, h2.db, { now: now2 + MINUTE, pauseMs: 0 })).sent, 1);
});

test('reminders: test mode only touches test users (negative ids)', async () => {
  const h = harness();
  await learnOneWord(h);
  const now = h.clock.now + DAY + MINUTE;
  assert.equal((await sendReminders(h.bot.api, h.db, { now, test: true, pauseMs: 0 })).sent, 0);
  assert.equal((await sendReminders(h.bot.api, h.db, { now, pauseMs: 0 })).sent, 1);
});

test('background enrichment adds pronunciation to words added in bulk', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('apple - olma\nweather - ob-havo\nflaky - x\nолма - y\nhouse - uy');
  // More than 3 words: nothing looked up synchronously.
  assert.equal(h.dictionaryCalls.length, 0);
  const calls = [];
  const r = await enrichCards(h.db, fakeDictionary(calls), { limit: 10 });
  assert.equal(r.done, 4); // "flaky" failed and stays for the next pass
  assert.deepEqual(calls.sort(), ['apple', 'flaky', 'house', 'weather']); // non-Latin word skipped without a request
  assert.equal(h.cardByWord('apple').phonetic, '/ˈæp.əl/');
  assert.equal(h.cardByWord('олма').enriched, true);
  assert.equal(h.cardByWord('flaky').enriched, false);
  assert.equal(h.cardByWord('house').enriched, true);
  assert.equal((await h.db.cardsToEnrich(10)).length, 1);
});

test('webhook setup runs once, re-checks hourly, and redoes everything for a new token', async () => {
  const db = createMemoryDb();
  const calls = [];
  let webhookUrl = '';
  const api = new Proxy(
    {},
    {
      get: (_t, method) => async (...args) => {
        calls.push(method);
        if (method === 'getWebhookInfo') return { url: webhookUrl, pending_update_count: 0 };
        if (method === 'setWebhook') webhookUrl = args[0];
        return true;
      },
    },
  );
  const url = 'https://ref.supabase.co/functions/v1/telegram-bot';
  const now = Date.UTC(2026, 0, 5);

  let r = await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now });
  assert.equal(r.action, 'set');
  assert.equal(calls.filter((c) => c === 'setMyCommands').length, 3);
  assert.equal(calls.filter((c) => c === 'setMyDescription').length, 3);
  assert.equal(calls.filter((c) => c === 'setMyShortDescription').length, 3);
  assert.equal((await db.getAppState('webhook')).version, SETUP_VERSION);

  calls.length = 0;
  r = await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now: now + 10 * MINUTE });
  assert.equal(r.action, 'none');
  assert.equal(calls.length, 0);

  r = await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now: now + 2 * HOUR });
  assert.equal(r.action, 'checked');
  assert.deepEqual(calls, ['getWebhookInfo']);

  // Someone removed the webhook (e.g. ran the bot locally with long polling).
  webhookUrl = '';
  calls.length = 0;
  r = await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now: now + 4 * HOUR });
  assert.equal(r.action, 'set');
  assert.deepEqual(calls, ['getWebhookInfo', 'setWebhook']);

  calls.length = 0;
  r = await ensureWebhook(api, db, { url, secretToken: 's2', tokenId: 'b', now: now + 4 * HOUR + MINUTE });
  assert.equal(r.action, 'set');
  assert.ok(calls.includes('setMyCommands'));
});

test('reminders back off when the previous one was ignored', async () => {
  const h = harness({ start: Date.UTC(2026, 0, 5, 4, 0) }); // 09:00 in UTC+5
  await learnOneWord(h);
  const opts = (now) => ({ now, gapMin: 180, idleMin: 20, pauseMs: 0 });
  const t0 = h.clock.now + DAY + MINUTE;
  assert.equal((await sendReminders(h.bot.api, h.db, opts(t0))).sent, 1);
  // Ignored: the 3 h gap is not enough, 12 h is needed.
  assert.equal((await sendReminders(h.bot.api, h.db, opts(t0 + 4 * HOUR))).sent, 0);
  // The user opens the bot after the reminder → the normal 3 h gap applies again.
  h.clock.now = t0 + 5 * HOUR;
  await h.send('/stats');
  assert.equal((await sendReminders(h.bot.api, h.db, opts(t0 + 6 * HOUR))).sent, 1);
});
