import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, USERS, AUDIO } from './helpers.js';
import { MENU } from '../src/i18n.js';
import { MINUTE } from '../../js/srs.js';

test('start, add words, review with flashcards (English)', async () => {
  const h = harness();
  await h.send('/start');
  assert.match(h.all()[0].text, /Hi, Ali/);
  assert.deepEqual(h.keyboard(h.all()[0]), [MENU.en.review, MENU.en.add, MENU.en.stats, MENU.en.list, MENU.en.settings]);
  assert.deepEqual(h.buttons(h.last()), ['sample']);

  await h.send('apple - olma - An apple a day\nhouse\tuy\napple - again');
  assert.match(h.last().text, /Added 2 words/);
  assert.match(h.last().text, /Already in your list \(skipped\): 1/);
  assert.match(h.last().text, /<b>apple<\/b> <i>\/ˈæp\.əl\/<\/i> — olma/); // looked up right away (small batch)

  await h.send(MENU.en.review);
  const card = h.last();
  assert.match(card.text, /New word/);
  assert.match(card.text, /<b>apple<\/b>/);
  const [show, sound] = h.buttons(card);
  assert.match(show, /^s:/);
  assert.match(sound, /^p:/);

  await h.press(show);
  const edit = h.last('editMessageText');
  assert.match(edit.text, /olma/);
  assert.match(edit.text, /An apple a day/);
  const grades = h.buttons(edit).filter((d) => d.startsWith('g:'));
  assert.equal(grades.length, 4);
  assert.deepEqual(h.labels(edit).slice(0, 4), ['❌ Again · 1m', '😐 Hard · 10m', '✅ Good · 10m', '🚀 Easy · 1d']);

  await h.press(grades[2]); // Good
  const graded = h.cardByWord('apple');
  assert.equal(graded.stage, 1);
  assert.equal(graded.due, h.clock.now + 10 * MINUTE);
  assert.match(h.last('editMessageText').text, /Good · next in 10m/);
  assert.match(h.last().text, /<b>house<\/b>/); // next card sent automatically

  // Pressing the same grade button again must not advance the card twice.
  await h.press(grades[2]);
  assert.equal(h.cardByWord('apple').stage, 1);
  assert.equal(h.last('answerCallbackQuery').text, 'Already answered 👍');
});

test('due reviews come before new words; daily limit for new words', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('a1 - x1\na2 - x2\na3 - x3');
  await h.db.updateUser(USERS.en.id, { new_per_day: 1 });

  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[2]);
  assert.match(h.last().text, /All done/);
  assert.match(h.last().text, /Daily limit of new words \(1\) reached\. 2 more are waiting/);
  assert.match(h.last().text, /Next review in <b>10m<\/b>/);

  h.clock.now += 11 * MINUTE;
  await h.send('/review');
  assert.match(h.last().text, /Review/);
  assert.match(h.last().text, /a1/);
});

test('typing mode grades the typed answer', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('library - kutubxona');
  await h.db.updateUser(USERS.en.id, { mode: 'type' });
  await h.send('/review');
  assert.match(h.last().text, /Type the translation/);
  await h.send('Kutubxona');
  assert.ok(h.all().some((m) => /Correct!/.test(m.text)));
  assert.equal(h.cardByWord('library').stage, 1);

  h.clock.now += 11 * MINUTE;
  await h.send('/review');
  await h.send('kitob');
  assert.ok(h.all().some((m) => /Correct answer: <b>kutubxona/.test(m.text) && /Next review in 1m</.test(m.text)));
  assert.equal(h.cardByWord('library').stage, 0);
  assert.equal(h.cardByWord('library').last_reviewed, h.clock.now);
});

test('a menu button during a typed answer cancels the question', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('dog - it');
  await h.db.updateUser(USERS.en.id, { mode: 'type' });
  await h.send('/review');
  await h.send(MENU.en.stats);
  assert.match(h.last().text, /Your progress/);
  await h.send('cat - mushuk');
  assert.match(h.last().text, /Added: <b>cat<\/b> — mushuk/);
});

test('multiple choice', async () => {
  const h = harness();
  await h.send('/start');
  await h.press('sample:uz');
  assert.match(h.last().text, /Added 12 words/);
  await h.db.updateUser(USERS.en.id, { mode: 'choice' });
  await h.send('/review');
  const msg = h.last();
  const opts = h.buttons(msg).filter((d) => d.startsWith('c:'));
  assert.equal(opts.length, 4);
  const correct = opts[0].split(':')[5];
  await h.press(opts[Number(correct)], { message_id: 5, date: 0, chat: { id: USERS.en.id, type: 'private' }, text: 'x', reply_markup: msg.reply_markup });
  assert.match(h.last('editMessageText').text, /Correct/);
  assert.equal(h.db._state.log.at(-1).grade, 2);
});

test('settings, time zone, list, find, delete, export, stats', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('/settings');
  assert.match(h.last().text, /Study mode: <b>Flashcards<\/b>/);
  await h.press('set:mode');
  assert.equal(h.db._state.users.get(USERS.en.id).mode, 'choice');
  assert.match(h.last('editMessageText').text, /Multiple choice/);
  await h.press('set:new:5');
  assert.equal(h.db._state.users.get(USERS.en.id).new_per_day, 25);
  await h.press('set:remind');
  assert.equal(h.db._state.users.get(USERS.en.id).remind, false);
  await h.press('set:quiet');
  assert.deepEqual([h.db._state.users.get(USERS.en.id).quiet_start, h.db._state.users.get(USERS.en.id).quiet_end], [22, 8]);
  await h.send('/timezone +3');
  assert.equal(h.db._state.users.get(USERS.en.id).tz_offset_min, 180);
  await h.send('/timezone banana');
  assert.match(h.last().text, /Usage/);

  await h.press('sample:ru');
  await h.send('/list');
  assert.match(h.last().text, /Your words<\/b> \(12\)/);
  await h.send('/find borrow');
  const del = h.buttons(h.last()).find((d) => d.startsWith('d:'));
  await h.press(del);
  assert.equal(h.db._state.cards.length, 11);
  assert.equal(h.last('editMessageText').text, '🗑 Deleted.');

  await h.send('/export');
  const doc = h.last('sendDocument');
  assert.equal(doc.caption, '📦 11 words');

  await h.send('/stats');
  assert.match(h.last().text, /Words: <b>11<\/b>/);
  assert.match(h.last().text, /Upcoming reviews/);
});

test('Uzbek and Russian users get their language; language can be switched', async () => {
  const h = harness({ user: USERS.uz });
  await h.send('/start');
  assert.match(h.all()[0].text, /Salom, Sardor!/);
  assert.ok(h.keyboard(h.all()[0]).includes(MENU.uz.review));
  await h.send('/sample'); // Uzbek users get the English–Uzbek set directly
  assert.match(h.last().text, /12 ta namuna soʻz qoʻshildi/);
  await h.send(MENU.uz.review);
  assert.match(h.last().text, /Yangi soʻz/);
  await h.press(h.buttons(h.last())[0]);
  assert.match(h.last('editMessageText').text, /Qanchalik yaxshi esladingiz\?/);
  assert.ok(h.labels(h.last('editMessageText')).includes('✅ Yaxshi · 10 daq'));

  await h.send('/settings');
  assert.match(h.last().text, /Sozlamalar/);
  await h.press('set:lang');
  await h.press('lang:ru');
  assert.equal(h.db._state.users.get(USERS.uz.id).lang, 'ru');
  assert.match(h.last().text, /Язык: Русский/);
  assert.ok(h.keyboard(h.last()).includes(MENU.ru.review));
  // The old Uzbek keyboard still works after switching.
  await h.send(MENU.uz.stats);
  assert.match(h.last().text, /Мой прогресс/);

  h.setUser(USERS.ru);
  await h.send('/start');
  assert.match(h.last('sendMessage').text, /Отправьте мне первые слова/);
  await h.send('/sample');
  assert.match(h.last().text, /Добавлено: 12 слов/);
  assert.ok(h.db._state.cards.some((c) => c.user_id === USERS.ru.id && c.translation === 'яблоко'));
});

test('a single word is translated automatically into the user language', async () => {
  const h = harness({ user: USERS.uz }); // language_code uz → translate into Uzbek
  await h.send('/start');
  await h.send('apple');
  const msg = h.last();
  assert.match(msg.text, /Qoʻshildi: <b>apple<\/b> <i>\/ˈæp\.əl\/<\/i> — olma/);
  assert.match(msg.text, /Avtomatik tarjima qilindi/);
  assert.deepEqual(h.buttons(msg).map((d) => d.split(':')[0]), ['e', 'd', 'p', 'review']);

  // A word in the user's own language becomes an English card.
  await h.send('kitob');
  assert.match(h.last().text, /<b>book<\/b> — kitob/);

  // Several words at once, mixed with explicit translations; one fails.
  await h.send('weather\nreliable\nqwzx\nhouse - uy');
  const many = h.last().text;
  assert.match(many, /3 ta soʻz qoʻshildi/);
  assert.match(many, /• <b>weather<\/b> <i>\/ˈwɛðə\/<\/i> — ob-havo/);
  assert.match(many, /Tarjima qilib boʻlmadi: qwzx/);

  // Network errors are reported as "couldn't translate", not crashes.
  await h.send('boom');
  assert.match(h.last().text, /Tarjima qilib boʻlmadi: boom/);
});

test('without an auto-translation language the bot asks for "word - translation"', async () => {
  const h = harness(); // language_code en → auto-translation off
  await h.send('/start');
  await h.send('apple');
  assert.match(h.last().text, /send it with a translation/);
  assert.equal(h.db._state.cards.length, 0);

  await h.send('/settings');
  await h.press('set:tr');
  assert.ok(h.buttons(h.last('editMessageText')).includes('tr:uz'));
  await h.press('tr:uz');
  assert.equal(h.db._state.users.get(USERS.en.id).translate_to, 'uz');
  assert.match(h.last('editMessageText').text, /Auto-translate new words into: <b>🇺🇿 Oʻzbekcha<\/b>/);
  await h.send('apple');
  assert.match(h.last().text, /Added: <b>apple<\/b>.* — olma/);
});

test('edit a word: rename, duplicate check, bad format, cancel', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('apple - olma\nhouse - uy');
  await h.send('/find apple');
  const editBtn = h.buttons(h.last()).find((d) => d.startsWith('e:'));
  await h.press(editBtn);
  assert.match(h.last().text, /Send the new version/);
  assert.match(h.last().text, /<code>apple - olma<\/code>/);

  await h.send('just one part');
  assert.match(h.last().text, /Please send it as/);
  await h.send('house - uy');
  assert.match(h.last().text, /You already have the word “house”/);
  await h.send('apple - olma, olmacha - I like apples');
  assert.match(h.last().text, /Saved/);
  const card = h.cardByWord('apple');
  assert.equal(card.translation, 'olma, olmacha');
  assert.equal(card.example, 'I like apples');
  assert.equal(h.db._state.users.get(USERS.en.id).pending, null);

  // Renaming the word refreshes its pronunciation.
  await h.press(editBtn);
  await h.send('weather - ob-havo');
  assert.equal(h.cardByWord('weather').phonetic, '/ˈwɛðə/');
  assert.equal(h.cardByWord('weather').audio_url, '');

  await h.press(editBtn);
  await h.send('/cancel');
  assert.equal(h.db._state.users.get(USERS.en.id).pending, null);
  await h.send('cat - mushuk');
  assert.match(h.last().text, /Added: <b>cat<\/b> — mushuk/);
});

test('pronunciation button sends a voice message, falling back to audio', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('apple - olma');
  const id = h.cardByWord('apple').id;
  await h.press(`p:${id}`);
  assert.equal(h.last('sendVoice').voice, AUDIO);

  const h2 = harness({ failMethods: ['sendVoice'] });
  await h2.send('/start');
  await h2.send('apple - olma');
  await h2.press(`p:${h2.cardByWord('apple').id}`);
  assert.equal(h2.last('sendAudio').audio, AUDIO);

  await h.send('house - uy');
  await h.press(`p:${h.cardByWord('house').id}`);
  assert.equal(h.last('answerCallbackQuery').text, 'No pronunciation for this word.');
});

test('reset progress and list pagination', async () => {
  const h = harness();
  await h.send('/start');
  await h.send(Array.from({ length: 25 }, (_, i) => `w${i} - t${i}`).join('\n'));
  await h.send('/list');
  assert.match(h.last().text, /page 1\/2/);
  assert.doesNotMatch(h.last().text, /<i><\/i>/);
  assert.deepEqual(h.buttons(h.last()), ['l:1']);
  await h.press('l:1');
  assert.match(h.last('editMessageText').text, /page 2\/2/);

  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[2]);
  const graded = h.db._state.cards.find((c) => c.reps === 1);
  await h.press(`z:${graded.id}`);
  assert.equal(h.db._state.cards.find((c) => c.id === graded.id).reps, 0);
  assert.match(h.last('answerCallbackQuery').text, /Progress reset/);
});

test('wipe all words asks for confirmation', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('a - b');
  await h.press('wipe');
  assert.deepEqual(h.buttons(h.last()), ['wipe:yes', 'wipe:no']);
  await h.press('wipe:no');
  assert.equal(h.db._state.cards.length, 1);
  await h.press('wipe:yes');
  assert.equal(h.db._state.cards.length, 0);
});

test('group chats are ignored; unknown buttons are answered', async () => {
  const h = harness();
  await h.send('/start', { chat: { id: -100, type: 'group', title: 'g' } });
  assert.equal(h.last().text, 'Please message me in a private chat 🙂');
  await h.send('apple - olma', { chat: { id: -100, type: 'group', title: 'g' } });
  assert.equal(h.db._state.cards.length, 0);

  await h.send('/start');
  await h.press('old:button');
  assert.equal(h.last('answerCallbackQuery').text, 'This button is no longer active.');
  await h.send('/nonsense');
  assert.match(h.last().text, /Unknown command/);
  await h.bot.handleUpdate({ update_id: 999, message: { message_id: 999, date: 0, chat: { id: USERS.en.id, type: 'private' }, from: USERS.en, sticker: { file_id: 'x', file_unique_id: 'x', type: 'regular', width: 1, height: 1, is_animated: false, is_video: false } } });
  assert.match(h.last().text, /didn't find any words/);
});

test('switching from typing to flashcards drops the unanswered question', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('dog - it\nsun - quyosh');
  await h.db.updateUser(USERS.en.id, { mode: 'type' });
  await h.send('/review');
  assert.equal(h.db._state.users.get(USERS.en.id).pending.type, 'answer');
  await h.press('set:mode'); // type → flip (via the settings button, no message sent)
  await h.press('review');
  assert.equal(h.db._state.users.get(USERS.en.id).pending, null);
  await h.send('cat - mushuk');
  assert.match(h.last().text, /Added: <b>cat<\/b> — mushuk/);
});
