// GENERATED from bot/src/i18n.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
// All user-facing texts. The bot is a German ↔ Russian trainer with a Russian (default) or German interface.
// Use t(lang, key, ...args): string arguments are HTML-escaped automatically.
// Use tRaw() only when an argument is already safe HTML.
import { DEFAULT_INTERVALS, formatInterval } from './srs.js';

export const LANGS = ['ru', 'de'];
export const LANG_NAMES = { ru: 'Русский', de: 'Deutsch' };
export const LANG_FLAGS = { ru: '🇷🇺', de: '🇩🇪' };
/** The language a user learns (the "word" side of a card): German or Russian. */
export const LEARN = ['de', 'ru'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/** Interface language from Telegram's language_code: German for German users, Russian for everyone else. */
export function pickLang(code) {
  return String(code || '').toLowerCase().startsWith('de') ? 'de' : 'ru';
}

/** Default language to learn: German speakers learn Russian, everyone else learns German. */
export const pickLearn = (lang) => (lang === 'de' ? 'ru' : 'de');

function ruPlural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

const COUNT = {
  word: {
    ru: (n) => `${n} ${ruPlural(n, 'слово', 'слова', 'слов')}`,
    de: (n) => `${n} ${n === 1 ? 'Wort' : 'Wörter'}`,
  },
  review: {
    ru: (n) => `${n} ${ruPlural(n, 'повторение', 'повторения', 'повторений')}`,
    de: (n) => `${n} ${n === 1 ? 'Wiederholung' : 'Wiederholungen'}`,
  },
  day: {
    ru: (n) => `${n} ${ruPlural(n, 'день', 'дня', 'дней')}`,
    de: (n) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`,
  },
};
export const count = (lang, what, n) => (COUNT[what][lang] ?? COUNT[what].ru)(n);

const UNITS = {
  ru: { m: ' мин', h: ' ч', d: ' д', mo: ' мес', y: ' г' },
  de: { m: ' Min.', h: ' Std.', d: ' Tg.', mo: ' Mon.', y: ' J.' },
};

/** "10 мин" / "10 Min." */
export function fmtInterval(lang, ms) {
  const s = formatInterval(ms);
  const m = s.match(/^(<?)([\d.]+)(mo|y|d|h|m)$/);
  if (!m) return s;
  return `${m[1]}${m[2].replace('.', ',')}${(UNITS[lang] ?? UNITS.ru)[m[3]]}`;
}

const intervalsLine = (lang) => DEFAULT_INTERVALS.map((ms) => fmtInterval(lang, ms)).join(' → ');

export const MENU = {
  ru: { review: '📚 Повторить', add: '➕ Добавить слова', stats: '📊 Статистика', list: '📋 Мои слова', settings: '⚙️ Настройки' },
  de: { review: '📚 Wiederholen', add: '➕ Wörter hinzufügen', stats: '📊 Statistik', list: '📋 Meine Wörter', settings: '⚙️ Einstellungen' },
};

/** All labels of one menu button across languages (old keyboards keep working after a language switch). */
export const menuLabels = (key) => LANGS.map((l) => MENU[l][key]);
export const isMenuLabel = (text) => LANGS.some((l) => Object.values(MENU[l]).includes(text));

const WEEKDAYS = {
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
};
export const weekday = (lang, i) => (WEEKDAYS[lang] ?? WEEKDAYS.ru)[i];

const S = {
  // ---------- general ----------
  greet: {
    ru: (name) => `👋 Привет, ${name}! Я помогу учить немецкие слова методом <b>интервальных повторений</b>: каждое слово возвращается прямо перед тем, как вы его забудете.`,
    de: (name) => `👋 Hallo, ${name}! Ich helfe dir, russische Wörter mit <b>verteilter Wiederholung</b> zu lernen: Jedes Wort kommt zurück, kurz bevor du es vergessen würdest.`,
  },
  help: {
    ru: () => `<b>Как это работает</b>

1️⃣ Отправьте мне слово — немецкое или русское, — и я сам найду перевод, артикль и произношение:
<code>Haus</code> → <b>das Haus</b> [haʊ̯s] — дом
<code>кошка</code> → <b>die Katze</b> [ˈkat͡sə] — кошка
Или со своим переводом, по одному на строке:
<code>lernen - учить - Ich lerne Deutsch.</code>

2️⃣ Нажмите <b>${MENU.ru.review}</b> и оцените, насколько хорошо вы вспомнили слово:
❌ <b>Снова</b> – забыл, слово вернётся через минуту
😐 <b>Трудно</b> – тот же интервал ещё раз
✅ <b>Хорошо</b> – следующий шаг
🚀 <b>Легко</b> – через шаг

3️⃣ Каждое слово возвращается через растущие интервалы:
${intervalsLine('ru')}

🔔 Я напомню, когда пора повторять.

/list – мои слова · /find – поиск и правка · /stats – прогресс · /settings – настройки · /export – экспорт

📖 Словарь и произношение: <a href="https://de.wiktionary.org">Викисловарь</a> и <a href="https://commons.wikimedia.org">Wikimedia Commons</a> (CC BY-SA).`,
    de: () => `<b>So funktioniert es</b>

1️⃣ Schick mir ein Wort – auf Russisch oder Deutsch – und ich finde selbst die Übersetzung und die Aussprache:
<code>кошка</code> → <b>кошка</b> [ˈkoʂkə] — die Katze
<code>Haus</code> → <b>дом</b> [dom] — das Haus
Oder mit eigener Übersetzung, eins pro Zeile:
<code>учить - lernen - Я учу немецкий.</code>

2️⃣ Drück <b>${MENU.de.review}</b> und bewerte, wie gut du dich erinnert hast:
❌ <b>Nochmal</b> – vergessen, kommt in einer Minute wieder
😐 <b>Schwer</b> – derselbe Abstand noch einmal
✅ <b>Gut</b> – nächste Stufe
🚀 <b>Leicht</b> – eine Stufe überspringen

3️⃣ Jedes Wort kommt nach immer längeren Abständen zurück:
${intervalsLine('de')}

🔔 Ich erinnere dich, wenn es Zeit zum Wiederholen ist.

/list – meine Wörter · /find – suchen &amp; bearbeiten · /stats – Fortschritt · /settings – Einstellungen · /export – Export

📖 Wörterbuch und Aussprache: <a href="https://de.wiktionary.org">Wiktionary</a> und <a href="https://commons.wikimedia.org">Wikimedia Commons</a> (CC BY-SA).`,
  },
  first_words: {
    ru: 'Отправьте мне первые слова или попробуйте примеры 👇',
    de: 'Schick mir deine ersten Wörter oder probier die Beispiele aus 👇',
  },
  btn_samples: { ru: '✨ Добавить примеры слов', de: '✨ Beispielwörter hinzufügen' },
  cancelled: { ru: 'Хорошо, отменено.', de: 'Okay, abgebrochen.' },
  unknown_cmd: { ru: 'Неизвестная команда. Смотрите /help', de: 'Unbekannter Befehl. Siehe /help' },
  inactive_btn: { ru: 'Эта кнопка больше не активна.', de: 'Diese Schaltfläche ist nicht mehr aktiv.' },
  private_only: { ru: 'Напишите мне в личные сообщения 🙂', de: 'Schreib mir bitte in einem privaten Chat 🙂' },

  // ---------- adding words ----------
  add_help: {
    ru: (max) => `Отправьте мне слова — по одному на строке:

<code>Haus
кошка
lernen - учить - Ich lerne Deutsch.</code>

Просто слово (немецкое или русское) — я сам найду перевод, артикль и произношение.
Или в формате <i>слово - перевод - пример</i> (пример необязателен).
Несколько переводов: <code>schnell - быстрый, скорый</code>

Можно вставить до ${max} строк за раз, например два столбца из Excel.`,
    de: (max) => `Schick mir Wörter – eins pro Zeile:

<code>кошка
Haus
учить - lernen - Я учу немецкий.</code>

Nur das Wort (russisch oder deutsch) – ich finde Übersetzung und Aussprache selbst.
Oder im Format <i>Wort - Übersetzung - Beispiel</i> (das Beispiel ist optional).
Mehrere Übersetzungen: <code>быстрый - schnell, rasch</code>

Du kannst bis zu ${max} Zeilen auf einmal senden, z. B. zwei Spalten aus Excel.`,
  },
  nothing_parsed: {
    ru: 'Не нашёл слов. Отправьте слово или <code>слово - перевод</code>, по одному на строке.\n\nПример:\n<code>die Katze - кошка</code>',
    de: 'Ich habe keine Wörter gefunden. Schick ein Wort oder <code>Wort - Übersetzung</code>, eins pro Zeile.\n\nBeispiel:\n<code>кошка - die Katze</code>',
  },
  too_many: {
    ru: (n, max) => `Здесь ${n} ${ruPlural(n, 'строка', 'строки', 'строк')} — отправляйте не больше ${max} за раз.`,
    de: (n, max) => `Das sind ${n} Zeilen – bitte schick höchstens ${max} auf einmal.`,
  },
  added_n: {
    ru: (n) => `✅ Добавлено: ${count('ru', 'word', n)}.`,
    de: (n) => `✅ ${count('de', 'word', n)} hinzugefügt.`,
  },
  // w and t are HTML (use tRaw): the word is already bold and may carry a transcription.
  added_one: {
    ru: (w, t) => `✅ Добавлено: ${w} — ${t}`,
    de: (w, t) => `✅ Hinzugefügt: ${w} — ${t}`,
  },
  nothing_new: { ru: '🤔 Ничего нового не добавлено.', de: '🤔 Nichts Neues hinzugefügt.' },
  skipped_dups: {
    ru: (n) => `Уже есть в вашем списке (пропущено): ${n}.`,
    de: (n) => `Schon in deiner Liste (übersprungen): ${n}.`,
  },
  auto_note: {
    ru: '<i>Найдено автоматически — нажмите ✏️, если что-то не так.</i>',
    de: '<i>Automatisch gefunden – tippe auf ✏️, wenn etwas nicht stimmt.</i>',
  },
  auto_note_many: {
    ru: '<i>Найдено автоматически — исправить можно через /find слово.</i>',
    de: '<i>Automatisch gefunden – korrigieren kannst du mit /find Wort.</i>',
  },
  not_translated: {
    ru: (list) => `Не удалось перевести: ${list}.\nОтправьте их в виде <code>слово - перевод</code>.`,
    de: (list) => `Konnte nicht übersetzen: ${list}.\nSchick sie als <code>Wort - Übersetzung</code>.`,
  },
  translate_off_hint: {
    ru: 'Автоперевод выключен. Отправьте слово с переводом: <code>слово - перевод</code>.\nВключить автоперевод можно в ⚙️ Настройках.',
    de: 'Die automatische Übersetzung ist aus. Schick das Wort mit Übersetzung: <code>Wort - Übersetzung</code>.\nEinschalten kannst du sie in den ⚙️ Einstellungen.',
  },
  samples_added: {
    ru: (n) => `✨ Добавлено: ${count('ru', 'word', n)}. Начнём!`,
    de: (n) => `✨ ${count('de', 'word', n)} hinzugefügt. Los geht’s!`,
  },
  btn_start_learning: { ru: '▶️ Начать учить', de: '▶️ Lernen starten' },

  // ---------- review ----------
  head_new: { ru: '🆕 <b>Новое слово</b>', de: '🆕 <b>Neues Wort</b>' },
  head_review: { ru: '🔁 <b>Повторение</b>', de: '🔁 <b>Wiederholung</b>' },
  left: { ru: (n) => `осталось ${n}`, de: (n) => `noch ${n}` },
  choose_word: { ru: 'Выберите слово:', de: 'Wähle das Wort:' },
  choose_translation: { ru: 'Выберите перевод:', de: 'Wähle die Übersetzung:' },
  type_word: { ru: '✍️ Напишите слово:', de: '✍️ Schreib das Wort:' },
  type_translation: { ru: '✍️ Напишите перевод:', de: '✍️ Schreib die Übersetzung:' },
  btn_dont_know: { ru: '🤷 Не знаю', de: '🤷 Weiß nicht' },
  btn_show: { ru: '👁 Показать ответ', de: '👁 Antwort zeigen' },
  how_well: { ru: 'Насколько хорошо вы вспомнили?', de: 'Wie gut hast du dich erinnert?' },
  grade_0: { ru: 'Снова', de: 'Nochmal' },
  grade_1: { ru: 'Трудно', de: 'Schwer' },
  grade_2: { ru: 'Хорошо', de: 'Gut' },
  grade_3: { ru: 'Легко', de: 'Leicht' },
  next_in: { ru: (iv) => `снова через ${iv}`, de: (iv) => `wieder in ${iv}` },
  no_words_yet: {
    ru: 'У вас пока нет слов для изучения. Отправьте мне слово, например:\n<code>Haus</code>',
    de: 'Du hast noch keine Wörter zum Lernen. Schick mir ein Wort, z. B.\n<code>кошка</code>',
  },
  all_done: { ru: '🎉 <b>На сейчас всё!</b>', de: '🎉 <b>Für jetzt alles erledigt!</b>' },
  limit_reached: {
    ru: (limit, waiting, settings) =>
      `Дневной лимит новых слов (${limit}) выполнен. Ещё ${count('ru', 'word', waiting)} ${ruPlural(waiting, 'ждёт', 'ждут', 'ждут')} завтра — лимит можно изменить в разделе «${settings}».`,
    de: (limit, waiting, settings) =>
      `Tageslimit für neue Wörter (${limit}) erreicht. ${waiting === 1 ? 'Ein weiteres Wort wartet' : `${waiting} weitere Wörter warten`} auf morgen – das Limit kannst du unter „${settings}“ ändern.`,
  },
  next_review_in: {
    ru: (iv) => `⏰ Следующее повторение через <b>${iv}</b> — я напомню.`,
    de: (iv) => `⏰ Nächste Wiederholung in <b>${iv}</b> – ich erinnere dich.`,
  },
  word_deleted: { ru: 'Это слово удалено.', de: 'Dieses Wort wurde gelöscht.' },
  already_answered: { ru: 'Уже отвечено 👍', de: 'Schon beantwortet 👍' },
  correct_toast: { ru: '✅ Верно!', de: '✅ Richtig!' },
  wrong_toast: { ru: '❌ Неверно', de: '❌ Falsch' },
  verdict_correct: { ru: '✅ Верно', de: '✅ Richtig' },
  verdict_chose: { ru: (x) => `❌ Вы выбрали: ${x}`, de: (x) => `❌ Deine Wahl: ${x}` },
  ask_again: { ru: '🔁 Спрошу ещё раз через минуту.', de: '🔁 Ich frage in einer Minute noch einmal.' },
  typed_correct: { ru: '✅ Верно!', de: '✅ Richtig!' },
  typed_almost: {
    ru: (x) => `😐 Почти! Правильно: <b>${x}</b>`,
    de: (x) => `😐 Fast! Richtig: <b>${x}</b>`,
  },
  typed_wrong: {
    ru: (x) => `❌ Правильный ответ: <b>${x}</b>`,
    de: (x) => `❌ Richtige Antwort: <b>${x}</b>`,
  },
  next_review_short: {
    ru: (iv) => `Следующее повторение через ${iv}`,
    de: (iv) => `Nächste Wiederholung in ${iv}`,
  },
  no_audio: { ru: 'Для этого слова нет произношения.', de: 'Für dieses Wort gibt es keine Aussprache.' },

  // ---------- word list / find / edit ----------
  list_empty: {
    ru: 'У вас пока нет слов. Отправьте мне слово, например <code>Haus</code>',
    de: 'Du hast noch keine Wörter. Schick mir ein Wort, z. B. <code>кошка</code>',
  },
  list_head: {
    ru: (total, page, pages) => `📋 <b>Мои слова</b> (${total}) · стр. ${page}/${pages}`,
    de: (total, page, pages) => `📋 <b>Meine Wörter</b> (${total}) · Seite ${page}/${pages}`,
  },
  list_legend: {
    ru: '🆕 новое · 📖 учу · ✅ знаю · 🏆 выучено\nИзменить или удалить слово: /find слово',
    de: '🆕 neu · 📖 lerne · ✅ kann ich · 🏆 gelernt\nWort bearbeiten oder löschen: /find Wort',
  },
  due_mark: { ru: 'пора', de: 'fällig' },
  btn_prev: { ru: '⬅️ Назад', de: '⬅️ Zurück' },
  btn_next: { ru: 'Далее ➡️', de: 'Weiter ➡️' },
  find_usage: { ru: 'Например: <code>/find Haus</code>', de: 'Zum Beispiel: <code>/find кошка</code>' },
  find_none: { ru: (q) => `Ничего не найдено по запросу «${q}».`, de: (q) => `Nichts gefunden für „${q}“.` },
  find_more: { ru: (n) => `…и ещё ${n}. Уточните запрос.`, de: (n) => `…und ${n} weitere. Versuch eine genauere Suche.` },
  status_new: { ru: 'новое', de: 'neu' },
  status_learning: { ru: 'учу', de: 'lerne' },
  status_known: { ru: 'знаю', de: 'kann ich' },
  status_mastered: { ru: 'выучено', de: 'gelernt' },
  card_state: {
    ru: (status, stage, max, when) => `${status}, шаг ${stage}/${max}, ${when}`,
    de: (status, stage, max, when) => `${status}, Stufe ${stage}/${max}, ${when}`,
  },
  when_new: { ru: 'ещё не изучалось', de: 'noch nicht gelernt' },
  when_due: { ru: 'пора повторить', de: 'jetzt fällig' },
  when_next: { ru: (iv) => `повторение через ${iv}`, de: (iv) => `nächste Wiederholung in ${iv}` },
  btn_delete: { ru: '🗑 Удалить', de: '🗑 Löschen' },
  btn_reset: { ru: '🔄 Сбросить', de: '🔄 Zurücksetzen' },
  btn_edit: { ru: '✏️ Изменить', de: '✏️ Bearbeiten' },
  deleted_toast: { ru: 'Удалено', de: 'Gelöscht' },
  already_deleted: { ru: 'Уже удалено', de: 'Schon gelöscht' },
  deleted_msg: { ru: '🗑 Удалено.', de: '🗑 Gelöscht.' },
  reset_toast: { ru: 'Прогресс сброшен — слово снова новое', de: 'Fortschritt zurückgesetzt – das Wort ist wieder neu' },
  not_found_toast: { ru: 'Слово не найдено', de: 'Wort nicht gefunden' },
  edit_prompt: {
    ru: (cur) => `✏️ Отправьте новый вариант одной строкой:\n<code>слово - перевод - пример</code>\n\nСейчас:\n<code>${cur}</code>\n\n/cancel – оставить как есть`,
    de: (cur) => `✏️ Schick die neue Version in einer Zeile:\n<code>Wort - Übersetzung - Beispiel</code>\n\nJetzt:\n<code>${cur}</code>\n\n/cancel – nichts ändern`,
  },
  edit_saved: { ru: '✅ Сохранено.', de: '✅ Gespeichert.' },
  edit_duplicate: {
    ru: (w) => `Слово «${w}» уже есть в вашем списке. Отправьте другой вариант или /cancel.`,
    de: (w) => `Das Wort „${w}“ hast du schon. Schick eine andere Version oder /cancel.`,
  },
  edit_bad: {
    ru: 'Отправьте в виде <code>слово - перевод</code> (пример необязателен) или /cancel.',
    de: 'Bitte schick es als <code>Wort - Übersetzung</code> (das Beispiel ist optional) oder /cancel.',
  },

  // ---------- stats ----------
  stats_empty: {
    ru: 'Слов пока нет — отправьте мне несколько, чтобы начать!',
    de: 'Noch keine Wörter – schick mir ein paar, um loszulegen!',
  },
  stats: {
    ru: (s) => `📊 <b>Мой прогресс</b>

📚 Слов: <b>${s.total}</b>
🆕 Новые: ${s.new}
📖 Учу: ${s.learning}
✅ Знаю: ${s.known}
🏆 Выучено: ${s.mastered}

⏰ Пора повторить: <b>${s.due}</b>
📅 Сегодня: ${count('ru', 'review', s.reviews_today)}, верно ${s.pct_today}, новых ${s.new_today}
🔥 Серия: ${count('ru', 'day', s.streak)}
🎯 Точность (за всё время): ${s.accuracy}

<b>Ближайшие повторения</b>
${s.bars}`,
    de: (s) => `📊 <b>Mein Fortschritt</b>

📚 Wörter: <b>${s.total}</b>
🆕 Neu: ${s.new}
📖 Lerne: ${s.learning}
✅ Kann ich: ${s.known}
🏆 Gelernt: ${s.mastered}

⏰ Jetzt fällig: <b>${s.due}</b>
📅 Heute: ${count('de', 'review', s.reviews_today)}, ${s.pct_today} richtig, ${s.new_today} neu
🔥 Serie: ${count('de', 'day', s.streak)}
🎯 Genauigkeit (gesamt): ${s.accuracy}

<b>Kommende Wiederholungen</b>
${s.bars}`,
  },
  today: { ru: 'Сегодня', de: 'Heute' },
  btn_review_now: { ru: '▶️ Повторить сейчас', de: '▶️ Jetzt wiederholen' },

  // ---------- settings ----------
  settings: {
    ru: (o) => `⚙️ <b>Настройки</b>

🎓 Учу: <b>${o.learn}</b>
🎴 Режим: <b>${o.mode}</b>
🔀 Направление: <b>${o.dir}</b>
🆕 Новых слов в день: <b>${o.perDay}</b>
🔔 Напоминания: <b>${o.remind}</b>
🌙 Тихие часы (без напоминаний): <b>${o.quiet}</b>
🌍 Часовой пояс: <b>${o.tz}</b> (у вас сейчас ${o.time})
🔤 Автоперевод: <b>${o.translate}</b>
🌐 Язык интерфейса: <b>${o.lang}</b>

Точный часовой пояс: <code>/timezone +5:30</code>`,
    de: (o) => `⚙️ <b>Einstellungen</b>

🎓 Ich lerne: <b>${o.learn}</b>
🎴 Modus: <b>${o.mode}</b>
🔀 Richtung: <b>${o.dir}</b>
🆕 Neue Wörter pro Tag: <b>${o.perDay}</b>
🔔 Erinnerungen: <b>${o.remind}</b>
🌙 Ruhezeit (keine Erinnerungen): <b>${o.quiet}</b>
🌍 Zeitzone: <b>${o.tz}</b> (deine Uhrzeit: ${o.time})
🔤 Automatische Übersetzung: <b>${o.translate}</b>
🌐 Sprache der Oberfläche: <b>${o.lang}</b>

Genaue Zeitzone: <code>/timezone +5:30</code>`,
  },
  learn_de: { ru: '🇩🇪 немецкий', de: '🇩🇪 Deutsch' },
  learn_ru: { ru: '🇷🇺 русский', de: '🇷🇺 Russisch' },
  mode_flip: { ru: 'Карточки', de: 'Karteikarten' },
  mode_choice: { ru: 'Выбор ответа', de: 'Auswahl' },
  mode_type: { ru: 'Ввод ответа', de: 'Eintippen' },
  dir_forward: { ru: 'Слово → Перевод', de: 'Wort → Übersetzung' },
  dir_reverse: { ru: 'Перевод → Слово', de: 'Übersetzung → Wort' },
  dir_mixed: { ru: 'Вперемешку', de: 'Gemischt' },
  on: { ru: 'вкл', de: 'an' },
  off: { ru: 'выкл', de: 'aus' },
  per_day: { ru: (n) => `${n}/день`, de: (n) => `${n}/Tag` },
  btn_reminders_on: { ru: '🔔 Напоминания: вкл', de: '🔔 Erinnerungen: an' },
  btn_reminders_off: { ru: '🔕 Напоминания: выкл', de: '🔕 Erinnerungen: aus' },
  btn_translate_on: { ru: '🔤 Автоперевод: вкл', de: '🔤 Übersetzung: an' },
  btn_translate_off: { ru: '🔤 Автоперевод: выкл', de: '🔤 Übersetzung: aus' },
  btn_quiet: { ru: (q) => `🌙 Тишина: ${q}`, de: (q) => `🌙 Ruhe: ${q}` },
  btn_wipe: { ru: '🗑 Удалить все мои слова', de: '🗑 Alle meine Wörter löschen' },
  choose_lang: { ru: 'Выберите язык интерфейса:', de: 'Wähle die Sprache der Oberfläche:' },
  lang_set: { ru: 'Язык: Русский 🇷🇺', de: 'Sprache: Deutsch 🇩🇪' },
  btn_back: { ru: '⬅️ Назад', de: '⬅️ Zurück' },
  tz_usage: {
    ru: 'Например: <code>/timezone +3</code>, <code>/timezone -4</code> или <code>/timezone +5:30</code>',
    de: 'Zum Beispiel: <code>/timezone +1</code>, <code>/timezone -4</code> oder <code>/timezone +5:30</code>',
  },
  tz_set: {
    ru: (tz, time) => `🌍 Часовой пояс: <b>${tz}</b>. У вас сейчас ${time}.`,
    de: (tz, time) => `🌍 Zeitzone: <b>${tz}</b>. Deine Uhrzeit: ${time}.`,
  },
  wipe_confirm: {
    ru: '⚠️ Удалить <b>все</b> ваши слова и прогресс? Это нельзя отменить.',
    de: '⚠️ <b>Alle</b> deine Wörter und deinen Fortschritt löschen? Das kann nicht rückgängig gemacht werden.',
  },
  btn_wipe_yes: { ru: 'Да, удалить всё', de: 'Ja, alles löschen' },
  btn_cancel: { ru: 'Отмена', de: 'Abbrechen' },
  wiped: { ru: '🗑 Все слова удалены.', de: '🗑 Alle Wörter gelöscht.' },
  wipe_cancelled: { ru: 'Хорошо, ничего не удалено.', de: 'Okay, nichts wurde gelöscht.' },

  // ---------- export ----------
  export_none: { ru: 'Пока нечего экспортировать.', de: 'Du hast noch keine Wörter zum Exportieren.' },
  export_caption: { ru: (n) => `📦 ${count('ru', 'word', n)}`, de: (n) => `📦 ${count('de', 'word', n)}` },

  // ---------- reminders ----------
  reminder: {
    ru: (n) => `🔔 Пора повторить! Слов на повторение: <b>${n}</b>.\n\nПовторите ${n === 1 ? 'его' : 'их'} сейчас, пока не забыли 🧠`,
    de: (n) => {
      const it = n === 1 ? 'es' : 'sie';
      return `🔔 Zeit zum Wiederholen! <b>${n}</b> ${n === 1 ? 'Wort wartet' : 'Wörter warten'} auf dich.\n\nWiederhole ${it} jetzt, bevor du ${it} vergisst 🧠`;
    },
  },
  btn_start_review: { ru: '▶️ Начать повторение', de: '▶️ Wiederholung starten' },

  // ---------- bot profile (shown by Telegram) ----------
  description: {
    ru: () => `Учите немецкие слова методом интервальных повторений 🧠

• Отправьте немецкое или русское слово — я найду перевод, артикль (der/die/das) и произношение
• Повторяйте карточками, тестами или вводом ответа
• Каждое слово возвращается прямо перед тем, как вы его забудете: ${intervalsLine('ru')}
• Я напомню, когда пора повторять 🔔`,
    de: () => `Lerne russische Wörter mit verteilter Wiederholung 🧠

• Schick ein russisches oder deutsches Wort – ich finde Übersetzung und Aussprache
• Wiederhole mit Karteikarten, Quiz oder durch Eintippen
• Jedes Wort kommt zurück, kurz bevor du es vergessen würdest: ${intervalsLine('de')}
• Ich erinnere dich, wenn es Zeit zum Wiederholen ist 🔔`,
  },
  short_description: {
    ru: 'Немецкие слова с интервальными повторениями: перевод, артикли, произношение и напоминания 🧠',
    de: 'Russische Wörter mit verteilter Wiederholung: Übersetzung, Aussprache und Erinnerungen 🧠',
  },
};

export const COMMANDS = {
  ru: [
    ['review', 'Повторить слова'],
    ['add', 'Как добавить слова'],
    ['list', 'Мои слова'],
    ['find', 'Найти, изменить или удалить слово'],
    ['stats', 'Мой прогресс'],
    ['settings', 'Режим, напоминания, язык'],
    ['export', 'Скачать слова (CSV)'],
    ['sample', 'Добавить примеры слов'],
    ['help', 'Как это работает'],
  ],
  de: [
    ['review', 'Fällige Wörter wiederholen'],
    ['add', 'So fügst du Wörter hinzu'],
    ['list', 'Meine Wörter'],
    ['find', 'Wort suchen, bearbeiten oder löschen'],
    ['stats', 'Mein Fortschritt'],
    ['settings', 'Modus, Erinnerungen, Sprache'],
    ['export', 'Wörter herunterladen (CSV)'],
    ['sample', 'Beispielwörter hinzufügen'],
    ['help', 'So funktioniert es'],
  ],
};

export const STRINGS = S;

function lookup(lang, key) {
  const entry = S[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return entry[lang] ?? entry.ru;
}

/** Translated text; string arguments are HTML-escaped. */
export function t(lang, key, ...args) {
  const v = lookup(lang, key);
  return typeof v === 'function' ? v(...args.map((a) => (typeof a === 'string' ? esc(a) : a))) : v;
}

/** Like t(), but arguments are inserted as-is (they must already be safe HTML). */
export function tRaw(lang, key, ...args) {
  const v = lookup(lang, key);
  return typeof v === 'function' ? v(...args) : v;
}
