import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, USERS, AUDIO } from './helpers.js';
import { MENU } from '../src/i18n.js';
import { gradeAnswer, orient } from '../src/bot.js';
import { GRADES, MINUTE } from '../../js/srs.js';

const RU_MENU = [MENU.ru.review, MENU.ru.add, MENU.ru.stats, MENU.ru.list, MENU.ru.settings];

test('start, add words (articles are added), review with flashcards', async () => {
  const h = harness();
  await h.send('/start');
  assert.match(h.all()[0].text, /Привет, Ольга! Я помогу учить немецкие слова/);
  assert.deepEqual(h.keyboard(h.all()[0]), RU_MENU);
  assert.deepEqual(h.buttons(h.last()), ['sample']);

  await h.send('das Haus - дом - Das Haus ist groß.\nKatze - кошка\nHaus - again');
  assert.match(h.last().text, /Добавлено: 2 слова/);
  assert.match(h.last().text, /Уже есть в вашем списке \(пропущено\): 1/);
  assert.match(h.last().text, /<b>die Katze<\/b> <i>\[ˈkat͡sə\]<\/i> — кошка/); // article + IPA from the dictionary

  await h.send(MENU.ru.review);
  const card = h.last();
  assert.match(card.text, /Новое слово/);
  assert.match(card.text, /<b>das Haus<\/b> <i>\[haʊ̯s\]<\/i>/);
  const [show, sound] = h.buttons(card);
  assert.match(show, /^s:/);
  assert.match(sound, /^p:/);

  await h.press(show);
  const edit = h.last('editMessageText');
  assert.match(edit.text, /дом/);
  assert.match(edit.text, /Das Haus ist groß/);
  assert.deepEqual(h.labels(edit).slice(0, 4), ['❌ Снова · 1 мин', '😐 Трудно · 10 мин', '✅ Хорошо · 10 мин', '🚀 Легко · 1 д']);

  const grades = h.buttons(edit).filter((d) => d.startsWith('g:'));
  await h.press(grades[2]);
  assert.equal(h.cardByWord('das Haus').stage, 1);
  assert.equal(h.cardByWord('das Haus').due, h.clock.now + 10 * MINUTE);
  assert.match(h.last('editMessageText').text, /Хорошо · снова через 10 мин/);
  assert.match(h.last().text, /<b>die Katze<\/b>/);

  await h.press(grades[2]); // stale button
  assert.equal(h.cardByWord('das Haus').stage, 1);
  assert.equal(h.last('answerCallbackQuery').text, 'Уже отвечено 👍');
});

test('due reviews come before new words; daily limit for new words', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('eins - один\nzwei - два\ndrei - три');
  await h.db.updateUser(USERS.ru.id, { new_per_day: 1 });
  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[2]);
  assert.match(h.last().text, /На сейчас всё/);
  assert.match(h.last().text, /Дневной лимит новых слов \(1\) выполнен\. Ещё 2 ждут завтра/);
  assert.match(h.last().text, /Следующее повторение через <b>10 мин<\/b>/);

  h.clock.now += 11 * MINUTE;
  await h.send('/review');
  assert.match(h.last().text, /Повторение/);
  assert.match(h.last().text, /eins/);
});

test('typing mode: a missing or wrong article is "almost"', async () => {
  assert.equal(gradeAnswer('das Haus', 'das Haus'), GRADES.GOOD);
  assert.equal(gradeAnswer('Haus', 'das Haus'), GRADES.HARD);
  assert.equal(gradeAnswer('der Haus', 'das Haus'), GRADES.HARD);
  assert.equal(gradeAnswer('Hund', 'das Haus'), GRADES.AGAIN);
  assert.equal(gradeAnswer('дом', 'дом, здание'), GRADES.GOOD);

  const h = harness();
  await h.send('/start');
  await h.send('das Haus - дом');
  await h.db.updateUser(USERS.ru.id, { mode: 'type', direction: 'reverse' });
  await h.send('/review');
  assert.match(h.last().text, /Напишите слово/);
  await h.send('Haus');
  assert.ok(h.all().some((m) => /Почти! Правильно: <b>das Haus<\/b>/.test(m.text)));
  assert.equal(h.cardByWord('das Haus').stage, 1); // Hard counts as remembered
  assert.equal(h.cardByWord('das Haus').last_reviewed, h.clock.now);

  h.clock.now += 11 * MINUTE;
  await h.send('/review');
  await h.send('Hund');
  assert.ok(h.all().some((m) => /Правильный ответ: <b>das Haus/.test(m.text) && /Следующее повторение через 1 мин</.test(m.text)));
  assert.equal(h.cardByWord('das Haus').stage, 0);
});

test('a menu button during a typed answer cancels the question', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('der Hund - собака');
  await h.db.updateUser(USERS.ru.id, { mode: 'type' });
  await h.send('/review');
  await h.send(MENU.ru.stats);
  assert.match(h.last().text, /Мой прогресс/);
  await h.send('die Maus - мышь');
  assert.match(h.last().text, /Добавлено: <b>die Maus<\/b> — мышь/);
});

test('multiple choice', async () => {
  const h = harness();
  await h.send('/start');
  await h.press('sample');
  assert.match(h.last().text, /Добавлено: 12 слов/);
  assert.ok(h.cardByWord('das Haus'));
  assert.equal(h.cardByWord('das Haus').translation, 'дом');
  await h.db.updateUser(USERS.ru.id, { mode: 'choice' });
  await h.send('/review');
  const msg = h.last();
  const opts = h.buttons(msg).filter((d) => d.startsWith('c:'));
  assert.equal(opts.length, 4);
  const correct = opts[0].split(':')[5];
  await h.press(opts[Number(correct)], { message_id: 5, date: 0, chat: { id: USERS.ru.id, type: 'private' }, text: 'x', reply_markup: msg.reply_markup });
  assert.match(h.last('editMessageText').text, /Верно/);
  assert.equal(h.db._state.log.at(-1).grade, 2);
});

test('settings: learning language, auto-translation, mode, limits, time zone; list, find, delete, export, stats', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('/settings');
  assert.match(h.last().text, /Учу: <b>🇩🇪 немецкий<\/b>/);
  assert.match(h.last().text, /Автоперевод: <b>вкл<\/b>/);
  await h.press('set:learn');
  assert.equal(h.userState().learn, 'ru');
  assert.match(h.last('editMessageText').text, /Учу: <b>🇷🇺 русский<\/b>/);
  await h.press('set:learn');
  await h.press('set:tr');
  assert.equal(h.userState().auto_translate, false);
  await h.press('set:tr');
  await h.press('set:mode');
  assert.equal(h.userState().mode, 'choice');
  await h.press('set:new:5');
  assert.equal(h.userState().new_per_day, 25);
  await h.press('set:remind');
  assert.equal(h.userState().remind, false);
  await h.press('set:quiet');
  assert.deepEqual([h.userState().quiet_start, h.userState().quiet_end], [22, 8]);
  await h.send('/timezone +3');
  assert.equal(h.userState().tz_offset_min, 180);
  await h.send('/timezone banana');
  assert.match(h.last().text, /Например/);

  await h.send('/sample');
  await h.send('/list');
  assert.match(h.last().text, /Мои слова<\/b> \(12\)/);
  await h.send('/find Katze');
  const del = h.buttons(h.last()).find((d) => d.startsWith('d:'));
  await h.press(del);
  assert.equal(h.db._state.cards.length, 11);
  assert.equal(h.last('editMessageText').text, '🗑 Удалено.');

  await h.send('/export');
  assert.equal(h.last('sendDocument').caption, '📦 11 слов');
  await h.send('/stats');
  assert.match(h.last().text, /Слов: <b>11<\/b>/);
  assert.match(h.last().text, /Ближайшие повторения/);
});

test('German interface learns Russian; the interface language can be switched', async () => {
  const h = harness({ user: USERS.de });
  await h.send('/start');
  assert.match(h.all()[0].text, /Hallo, Hans! Ich helfe dir, russische Wörter/);
  assert.ok(h.keyboard(h.all()[0]).includes(MENU.de.review));
  assert.equal(h.userState().learn, 'ru');
  assert.equal(h.userState().tz_offset_min, 60);

  await h.send('/sample');
  assert.match(h.last().text, /12 Wörter hinzugefügt/);
  assert.equal(h.cardByWord('дом').translation, 'das Haus');
  assert.equal(h.cardByWord('дом').example, 'Дом большой.');
  await h.send(MENU.de.review);
  assert.match(h.last().text, /Neues Wort/);
  await h.press(h.buttons(h.last())[0]);
  assert.match(h.last('editMessageText').text, /Wie gut hast du dich erinnert\?/);
  assert.ok(h.labels(h.last('editMessageText')).includes('✅ Gut · 10 Min.'));

  await h.send('/settings');
  await h.press('set:lang');
  await h.press('lang:ru');
  assert.equal(h.userState().lang, 'ru');
  assert.match(h.last().text, /Язык: Русский/);
  assert.ok(h.keyboard(h.last()).includes(MENU.ru.review));
  await h.send(MENU.de.stats); // the old German keyboard still works
  assert.match(h.last().text, /Мой прогресс/);

  // Any other Telegram language gets the Russian interface and learns German.
  h.setUser(USERS.uz);
  await h.send('/start');
  assert.match(h.all().find((m) => m.chat_id === USERS.uz.id).text, /Привет, Sardor/);
  assert.equal(h.userState().learn, 'de');
});

test('a single word is translated with article, IPA and audio (Russian interface)', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('Haus');
  let msg = h.last();
  assert.match(msg.text, /Добавлено: <b>das Haus<\/b> <i>\[haʊ̯s\]<\/i> — дом/);
  assert.match(msg.text, /Найдено автоматически/);
  assert.deepEqual(h.buttons(msg).map((d) => d.split(':')[0]), ['e', 'd', 'p', 'review']);
  assert.equal(h.cardByWord('das Haus').audio_url, AUDIO.haus);

  // A Russian word becomes a German card.
  await h.send('кошка');
  assert.match(h.last().text, /<b>die Katze<\/b> <i>\[ˈkat͡sə\]<\/i> — кошка/);

  // Not in the dictionary: machine translation; unknown words are reported.
  await h.send('Fahrrad\nqwzxv\nboom');
  msg = h.last().text;
  assert.match(msg, /Добавлено: <b>Fahrrad<\/b> — велосипед/);
  assert.match(msg, /Не удалось перевести: qwzxv, boom/);
});

test('German interface: words are saved Russian-first', async () => {
  const h = harness({ user: USERS.de });
  await h.send('/start');
  await h.send('кошка');
  assert.match(h.last().text, /Hinzugefügt: <b>кошка<\/b> <i>\[ˈkoʂkə\]<\/i> — die Katze/);
  await h.send('Haus');
  assert.match(h.last().text, /Hinzugefügt: <b>дом<\/b> <i>\[dom\]<\/i> — das Haus/);
  assert.equal(h.cardByWord('дом').audio_url, AUDIO.dom);
  // A manual pair typed the other way round is turned around.
  await h.send('die Maus - мышь');
  assert.ok(h.cardByWord('мышь'));
  assert.equal(h.cardByWord('мышь').translation, 'die Maus');
});

test('with auto-translation off the bot asks for "word - translation"', async () => {
  const h = harness();
  await h.send('/start');
  await h.db.updateUser(USERS.ru.id, { auto_translate: false });
  await h.send('Haus');
  assert.match(h.last().text, /Автоперевод выключен/);
  assert.equal(h.db._state.cards.length, 0);
});

test('edit a word: rename (re-oriented), duplicate check, bad format, cancel', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('Apfel - яблоко\nder Hund - собака');
  await h.send('/find Apfel');
  const editBtn = h.buttons(h.last()).find((d) => d.startsWith('e:'));
  await h.press(editBtn);
  assert.match(h.last().text, /Отправьте новый вариант/);
  assert.match(h.last().text, /<code>Apfel - яблоко<\/code>/);

  await h.send('просто текст');
  assert.match(h.last().text, /Отправьте в виде/);
  await h.send('der Hund - собака');
  assert.match(h.last().text, /Слово «der Hund» уже есть/);
  await h.send('дом - Haus - Das Haus ist alt.'); // typed Russian-first: turned around, article added
  assert.match(h.last().text, /Сохранено/);
  const card = h.cardByWord('das Haus');
  assert.ok(card);
  assert.equal(card.translation, 'дом');
  assert.equal(card.phonetic, '[haʊ̯s]');
  assert.equal(h.userState().pending, null);

  await h.press(editBtn);
  await h.send('/cancel');
  assert.equal(h.userState().pending, null);
});

test('pronunciation is uploaded once, then sent by Telegram file id', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('Haus');
  const id = h.cardByWord('das Haus').id;
  await h.press(`p:${id}`);
  assert.deepEqual(h.audioDownloads, [AUDIO.haus]);
  assert.equal(h.last('sendVoice').voice.constructor.name, 'InputFile');
  const fileId = h.cardByWord('das Haus').audio_file_id;
  assert.match(fileId, /^VOICE-/);
  await h.press(`p:${id}`);
  assert.equal(h.last('sendVoice').voice, fileId);
  assert.equal(h.audioDownloads.length, 1);

  const h2 = harness({ failMethods: ['sendVoice'] });
  await h2.send('/start');
  await h2.send('Haus');
  await h2.press(`p:${h2.cardByWord('das Haus').id}`);
  assert.equal(h2.last('sendAudio').title, 'das Haus');

  await h.send('eins - один');
  await h.press(`p:${h.cardByWord('eins').id}`);
  assert.equal(h.last('answerCallbackQuery').text, 'Для этого слова нет произношения.');
});

test('reset progress and list pagination', async () => {
  const h = harness();
  await h.send('/start');
  await h.send(Array.from({ length: 25 }, (_, i) => `wort${i} - слово${i}`).join('\n'));
  await h.send('/list');
  assert.match(h.last().text, /стр\. 1\/2/);
  assert.doesNotMatch(h.last().text, /<i><\/i>/);
  assert.deepEqual(h.buttons(h.last()), ['l:1']);
  await h.press('l:1');
  assert.match(h.last('editMessageText').text, /стр\. 2\/2/);

  await h.send('/review');
  await h.press(h.buttons(h.last())[0]);
  await h.press(h.buttons(h.last('editMessageText'))[2]);
  const graded = h.db._state.cards.find((c) => c.reps === 1);
  await h.press(`z:${graded.id}`);
  assert.equal(h.db._state.cards.find((c) => c.id === graded.id).reps, 0);
  assert.match(h.last('answerCallbackQuery').text, /Прогресс сброшен/);
});

test('wipe all words asks for confirmation', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('eins - один');
  await h.press('wipe');
  assert.deepEqual(h.buttons(h.last()), ['wipe:yes', 'wipe:no']);
  await h.press('wipe:no');
  assert.equal(h.db._state.cards.length, 1);
  await h.press('wipe:yes');
  assert.equal(h.db._state.cards.length, 0);
});

test('group chats are ignored; unknown buttons, commands and stickers are answered', async () => {
  const h = harness();
  await h.send('/start', { chat: { id: -100, type: 'group', title: 'g' } });
  assert.equal(h.last().text, 'Напишите мне в личные сообщения 🙂');
  await h.send('eins - один', { chat: { id: -100, type: 'group', title: 'g' } });
  assert.equal(h.db._state.cards.length, 0);

  await h.send('/start');
  await h.press('old:button');
  assert.equal(h.last('answerCallbackQuery').text, 'Эта кнопка больше не активна.');
  await h.send('/nonsense');
  assert.match(h.last().text, /Неизвестная команда/);
  await h.bot.handleUpdate({ update_id: 999, message: { message_id: 999, date: 0, chat: { id: USERS.ru.id, type: 'private' }, from: USERS.ru, sticker: { file_id: 'x', file_unique_id: 'x', type: 'regular', width: 1, height: 1, is_animated: false, is_video: false } } });
  assert.match(h.last().text, /Не нашёл слов/);
});

test('switching from typing to flashcards drops the unanswered question', async () => {
  const h = harness();
  await h.send('/start');
  await h.send('der Hund - собака\ndie Sonne - солнце');
  await h.db.updateUser(USERS.ru.id, { mode: 'type' });
  await h.send('/review');
  assert.equal(h.userState().pending.type, 'answer');
  await h.press('set:mode'); // type → flip
  await h.press('review');
  assert.equal(h.userState().pending, null);
  await h.send('die Maus - мышь');
  assert.match(h.last().text, /Добавлено: <b>die Maus<\/b> — мышь/);
});

test('orient() puts the learned language first', () => {
  assert.deepEqual(orient({ word: 'дом', translation: 'Haus', example: '' }, 'de'), { word: 'Haus', translation: 'дом', example: '' });
  assert.deepEqual(orient({ word: 'Haus', translation: 'дом', example: '' }, 'de'), { word: 'Haus', translation: 'дом', example: '' });
  assert.deepEqual(orient({ word: 'Haus', translation: 'дом', example: '' }, 'ru'), { word: 'дом', translation: 'Haus', example: '' });
  assert.deepEqual(orient({ word: 'eins', translation: 'zwei', example: '' }, 'ru'), { word: 'eins', translation: 'zwei', example: '' });
});
