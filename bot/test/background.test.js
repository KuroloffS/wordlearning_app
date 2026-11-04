import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GrammyError } from 'grammy';
import { harness, USERS, fakeDictionary } from './helpers.js';
import { sendReminders, enrichCards } from '../src/reminders.js';
import { ensureWebhook, SETUP_VERSION } from '../src/setup.js';
import { createMemoryDb } from '../src/db/memory.js';
import { DAY, HOUR, MINUTE } from '../../js/srs.js';

async function learnOneWord(h, text = 'die Sonne - солнце') {
  await h.send('/start');
  await h.send(text);
  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[3]); // Easy → back in 1 day
}

test('reminders: due words, gap, quiet hours, language', async () => {
  // 09:00 UTC = 14:00 in UTC+5 (default time zone for the Russian interface)
  const h = harness({ start: Date.UTC(2026, 0, 5, 9, 0) });
  await learnOneWord(h);
  const opts = (now) => ({ now, gapMin: 180, idleMin: 20, pauseMs: 0 });

  assert.equal((await sendReminders(h.bot.api, h.db, opts(h.clock.now + HOUR))).sent, 0);
  const later = h.clock.now + DAY + MINUTE;
  assert.equal((await sendReminders(h.bot.api, h.db, opts(later))).sent, 1);
  assert.match(h.last().text, /Пора повторить! Слов на повторение: <b>1<\/b>/);
  assert.deepEqual(h.buttons(h.last()), ['review']);
  assert.equal((await sendReminders(h.bot.api, h.db, opts(later + HOUR))).sent, 0); // gap
  assert.equal((await sendReminders(h.bot.api, h.db, opts(Date.UTC(2026, 0, 6, 18, 30)))).sent, 0); // 23:30 local: quiet
  assert.equal((await sendReminders(h.bot.api, h.db, opts(Date.UTC(2026, 0, 7, 4, 0)))).sent, 1); // 09:00 local

  const g = harness({ user: USERS.de, start: Date.UTC(2026, 0, 5, 9, 0) });
  await learnOneWord(g, 'дом - das Haus');
  await sendReminders(g.bot.api, g.db, opts(g.clock.now + DAY + MINUTE));
  assert.match(g.last().text, /Zeit zum Wiederholen! <b>1<\/b> Wort wartet auf dich/);
});

test('reminders back off when the previous one was ignored', async () => {
  const h = harness({ start: Date.UTC(2026, 0, 5, 4, 0) });
  await learnOneWord(h);
  const opts = (now) => ({ now, gapMin: 180, idleMin: 20, pauseMs: 0 });
  const t0 = h.clock.now + DAY + MINUTE;
  assert.equal((await sendReminders(h.bot.api, h.db, opts(t0))).sent, 1);
  assert.equal((await sendReminders(h.bot.api, h.db, opts(t0 + 4 * HOUR))).sent, 0);
  h.clock.now = t0 + 5 * HOUR;
  await h.send('/stats');
  assert.equal((await sendReminders(h.bot.api, h.db, opts(t0 + 6 * HOUR))).sent, 1);
});

test('reminders: blocked users are switched off, temporary errors are retried, test users are separate', async () => {
  const h = harness();
  await learnOneWord(h);
  const now = h.clock.now + DAY + MINUTE;
  assert.equal((await sendReminders(h.bot.api, h.db, { now, test: true, pauseMs: 0 })).sent, 0);
  const blocked = {
    sendMessage: async () => {
      throw new GrammyError('x', { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, 'sendMessage', {});
    },
  };
  assert.deepEqual(await sendReminders(blocked, h.db, { now, pauseMs: 0 }), { sent: 0, failed: 1 });
  assert.equal(h.userState().remind, false);

  const h2 = harness();
  await learnOneWord(h2);
  const now2 = h2.clock.now + DAY + MINUTE;
  await sendReminders({ sendMessage: async () => Promise.reject(new Error('socket hang up')) }, h2.db, { now: now2, pauseMs: 0 });
  assert.equal(h2.userState().last_notified_at, null);
  assert.equal((await sendReminders(h2.bot.api, h2.db, { now: now2 + MINUTE, pauseMs: 0 })).sent, 1);
});

test('background enrichment adds articles and pronunciation to words added in bulk', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('das Haus - дом');
  await h.send('Haus - дом (2)\nKatze - кошка\nflaky - x\nlernen - учить\nкошка - die Katze');
  assert.equal(h.cardByWord('Katze').enriched, false); // more than 3 words: looked up in the background
  const calls = [];
  const r = await enrichCards(h.db, fakeDictionary(calls), { limit: 10 });
  assert.equal(r.done, 4); // "flaky" failed and stays for the next pass
  // "кошка - die Katze" was turned around when added; it already has its article.
  assert.equal(h.cardByWord('die Katze').phonetic, '[ˈkat͡sə]');
  assert.ok(h.cardByWord('Katze'), '"Katze" keeps its name because "die Katze" already exists');
  assert.equal(h.cardByWord('Katze').phonetic, '[ˈkat͡sə]');
  assert.ok(h.cardByWord('Haus'), '"Haus" keeps its name because "das Haus" already exists');
  assert.equal(h.cardByWord('Haus').phonetic, '[haʊ̯s]');
  assert.equal(h.cardByWord('lernen').phonetic, '[ˈlɛʁnən]');
  assert.equal(h.cardByWord('flaky').enriched, false);
});

test('webhook setup: once per token, hourly checks, profile refresh on new version, legacy texts removed', async () => {
  const db = createMemoryDb();
  const calls = [];
  let webhookUrl = '';
  const api = new Proxy(
    {},
    {
      get: (_t, method) => async (...args) => {
        calls.push([method, args]);
        if (method === 'getWebhookInfo') return { url: webhookUrl, pending_update_count: 0 };
        if (method === 'setWebhook') webhookUrl = args[0];
        return true;
      },
    },
  );
  const names = () => calls.map((c) => c[0]);
  const url = 'https://ref.supabase.co/functions/v1/telegram-bot';
  const now = Date.UTC(2026, 0, 5);

  let r = await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now });
  assert.equal(r.action, 'set');
  assert.equal(names().filter((n) => n === 'setMyCommands').length, 3);
  assert.equal(names().filter((n) => n === 'deleteMyCommands').length, 2);
  assert.deepEqual(calls.filter((c) => c[0] === 'deleteMyCommands').map((c) => c[1][0].language_code), ['uz', 'en']);
  assert.equal(calls.find((c) => c[0] === 'setMyCommands')[1][0][0].description, 'Повторить слова');
  assert.equal((await db.getAppState('webhook')).version, SETUP_VERSION);

  calls.length = 0;
  assert.equal((await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now: now + 10 * MINUTE })).action, 'none');
  assert.equal(calls.length, 0);

  assert.equal((await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now: now + 2 * HOUR })).action, 'checked');
  assert.deepEqual(names(), ['getWebhookInfo']);

  // An older bot version stored state: texts are refreshed, the webhook is not touched.
  calls.length = 0;
  await db.setAppState('webhook', { ...(await db.getAppState('webhook')), version: SETUP_VERSION - 1 });
  assert.equal((await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now: now + 3 * HOUR })).action, 'set');
  assert.ok(!names().includes('setWebhook'));
  assert.ok(names().includes('setMyCommands'));

  webhookUrl = ''; // someone removed the webhook (e.g. ran the bot locally with long polling)
  calls.length = 0;
  await db.setAppState('webhook', { ...(await db.getAppState('webhook')), checked_at: 0 });
  assert.equal((await ensureWebhook(api, db, { url, secretToken: 's1', tokenId: 'a', now: now + 5 * HOUR })).action, 'set');
  assert.deepEqual(names(), ['getWebhookInfo', 'setWebhook']);

  calls.length = 0;
  assert.equal((await ensureWebhook(api, db, { url, secretToken: 's2', tokenId: 'b', now: now + 5 * HOUR + MINUTE })).action, 'set');
  assert.ok(names().includes('setWebhook') && names().includes('setMyCommands'));
});
