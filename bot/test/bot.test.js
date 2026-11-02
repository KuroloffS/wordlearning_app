import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBot, MENU } from '../src/bot.js';
import { createMemoryDb } from '../src/db/memory.js';
import { sendReminders } from '../src/reminders.js';
import { DAY, MINUTE, HOUR } from '../../js/srs.js';

const USER = { id: 111, is_bot: false, first_name: 'Ali', username: 'ali' };
const BOT_INFO = { id: 1, is_bot: true, first_name: 'WL', username: 'wl_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false };

function harness({ start = Date.UTC(2026, 0, 5, 9, 0) } = {}) {
  const clock = { now: start };
  const db = createMemoryDb();
  const bot = createBot('TEST:TOKEN', db, { clock: () => clock.now, botInfo: BOT_INFO, random: () => 0.9 });
  const calls = [];
  let msgId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    const result = method.startsWith('send')
      ? { message_id: ++msgId, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text }
      : true;
    return { ok: true, result };
  });
  let updateId = 0;
  const chat = { id: USER.id, type: 'private', first_name: USER.first_name };
  const send = async (text) => {
    const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
    await bot.handleUpdate({ update_id: ++updateId, message: { message_id: ++msgId, date: 0, chat, from: USER, text, entities } });
  };
  const press = async (data, message = { message_id: 1, date: 0, chat, text: 'x' }) => {
    await bot.handleUpdate({ update_id: ++updateId, callback_query: { id: String(updateId), from: USER, chat_instance: '1', data, message } });
  };
  const last = (method = 'sendMessage') => [...calls].reverse().find((c) => c.method === method)?.payload;
  const buttons = (payload) => (payload?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
  return { bot, db, calls, send, press, last, buttons, clock };
}

test('start, add words, review with flashcards', async () => {
  const h = harness();
  await h.send('/start');
  assert.match(h.calls[0].payload.text, /Hi, Ali/);
  assert.deepEqual(h.buttons(h.last()), ['sample']);

  await h.send('apple - яблоко - An apple a day\nhouse\tдом\napple - again');
  assert.match(h.last().text, /Added 2 words/);
  assert.match(h.last().text, /1 word you already have was skipped/);

  await h.send(MENU.review);
  let card = h.last();
  assert.match(card.text, /New word/);
  assert.match(card.text, /<b>apple<\/b>/);
  const [show] = h.buttons(card);
  assert.match(show, /^s:/);

  await h.press(show);
  const edit = h.last('editMessageText');
  assert.match(edit.text, /яблоко/);
  assert.match(edit.text, /An apple a day/);
  const grades = h.buttons(edit);
  assert.equal(grades.length, 4);

  await h.press(grades[2]); // Good
  const graded = h.db._state.cards.find((c) => c.word === 'apple');
  assert.equal(graded.stage, 1);
  assert.equal(graded.due, h.clock.now + 10 * MINUTE);
  assert.match(h.last('editMessageText').text, /Good · next in 10m/);
  assert.match(h.last().text, /<b>house<\/b>/); // next card sent automatically

  // Pressing the same grade button twice must not advance the card again.
  await h.press(grades[2]);
  assert.equal(h.db._state.cards.find((c) => c.word === 'apple').stage, 1);
  assert.equal(h.last('answerCallbackQuery').text, 'Already answered 👍');
});

test('due review comes before new words and new-per-day limit applies', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('a1 - x1\na2 - x2\na3 - x3');
  await h.db.updateUser(USER.id, { new_per_day: 1 });

  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[2]);
  // Limit of 1 new word reached, a1 due in 10m → "all done".
  assert.match(h.last().text, /All done/);
  assert.match(h.last().text, /learned your 1 new words/);

  h.clock.now += 11 * MINUTE;
  await h.send('/review');
  assert.match(h.last().text, /Review/);
  assert.match(h.last().text, /a1/);
});

test('typing mode grades the typed answer', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('library - библиотека');
  await h.db.updateUser(USER.id, { mode: 'type' });
  await h.send('/review');
  assert.match(h.last().text, /Type the translation/);
  await h.send('Библиотека');
  const msgs = h.calls.filter((c) => c.method === 'sendMessage').map((c) => c.payload.text);
  assert.ok(msgs.some((t) => /Correct!/.test(t)));
  assert.equal(h.db._state.cards[0].stage, 1);

  // Wrong answer → Again.
  h.clock.now += 11 * MINUTE;
  await h.send('/review');
  await h.send('книга');
  assert.ok(h.calls.some((c) => /Correct answer: <b>библиотека/.test(c.payload.text ?? '')));
  assert.equal(h.db._state.cards[0].stage, 0);
  assert.equal(h.db._state.cards[0].lapses, 0); // lapses only count from stage 2
});

test('menu button while typing cancels the pending answer', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('dog - собака');
  await h.db.updateUser(USER.id, { mode: 'type' });
  await h.send('/review');
  await h.send(MENU.stats);
  assert.match(h.last().text, /Your progress/);
  await h.send('cat - кошка');
  assert.match(h.last().text, /Added 1 word/);
});

test('multiple choice', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('/sample');
  await h.db.updateUser(USER.id, { mode: 'choice' });
  await h.send('/review');
  const msg = h.last();
  const opts = h.buttons(msg).filter((d) => d.startsWith('c:'));
  assert.equal(opts.length, 4);
  const [, , , , , correct] = opts[0].split(':');
  await h.press(opts[Number(correct)], { message_id: 5, date: 0, chat: { id: USER.id, type: 'private' }, text: 'x', reply_markup: msg.reply_markup });
  assert.match(h.last('editMessageText').text, /Correct/);
  assert.equal(h.db._state.log.at(-1).grade, 2);
});

test('settings buttons, timezone, list, find, delete, export, stats', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('/settings');
  await h.press('set:mode');
  assert.equal(h.db._state.users.get(USER.id).mode, 'choice');
  await h.press('set:new:5');
  assert.equal(h.db._state.users.get(USER.id).new_per_day, 25);
  await h.press('set:remind');
  assert.equal(h.db._state.users.get(USER.id).remind, false);
  await h.send('/timezone +3');
  assert.equal(h.db._state.users.get(USER.id).tz_offset_min, 180);
  await h.send('/timezone banana');
  assert.match(h.last().text, /Usage/);

  await h.send('/sample');
  await h.send('/list');
  assert.match(h.last().text, /Your words<\/b> \(10\)/);
  await h.send('/find borrow');
  const del = h.buttons(h.last()).find((d) => d.startsWith('d:'));
  await h.press(del);
  assert.equal(h.db._state.cards.length, 9);

  await h.send('/export');
  assert.ok(h.calls.some((c) => c.method === 'sendDocument'));

  await h.send('/stats');
  assert.match(h.last().text, /Words: <b>9<\/b>/);
});

test('reminders respect due words, gap and quiet hours', async () => {
  // 09:00 UTC = 14:00 in UTC+5
  const h = harness({ start: Date.UTC(2026, 0, 5, 9, 0) });
  await h.send('/start');
  await h.send('sun - солнце');
  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[3]); // Easy → 1 day

  const api = h.bot.api;
  const opts = (now) => ({ now, gapMin: 180, idleMin: 20 });
  assert.equal(await sendReminders(api, h.db, opts(h.clock.now + HOUR)), 0); // nothing due yet
  const later = h.clock.now + DAY + MINUTE;
  assert.equal(await sendReminders(api, h.db, opts(later)), 1);
  assert.match(h.last().text, /Time to repeat! <b>1<\/b> word is waiting/);
  assert.deepEqual(h.buttons(h.last()), ['review']);
  assert.equal(await sendReminders(api, h.db, opts(later + HOUR)), 0); // gap
  // 23:30 local (UTC+5) is quiet time.
  const night = Date.UTC(2026, 0, 6, 18, 30);
  assert.equal(await sendReminders(api, h.db, opts(night)), 0);
  assert.equal(await sendReminders(api, h.db, opts(Date.UTC(2026, 0, 7, 4, 0))), 1); // 09:00 local
});
