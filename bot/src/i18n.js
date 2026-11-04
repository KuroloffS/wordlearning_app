// All user-facing texts in English, Russian and Uzbek (Latin).
// Use t(lang, key, ...args): string arguments are HTML-escaped automatically.
// Use tRaw() only when an argument is already safe HTML.
import { DEFAULT_INTERVALS, formatInterval } from '../../js/srs.js';

export const LANGS = ['en', 'ru', 'uz'];
export const LANG_NAMES = { en: 'English', ru: 'Русский', uz: 'Oʻzbekcha' };
export const LANG_FLAGS = { en: '🇬🇧', ru: '🇷🇺', uz: '🇺🇿' };

/** Languages offered for automatic translation of new words (code → autonym). */
export const TRANSLATE_TARGETS = {
  uz: '🇺🇿 Oʻzbekcha',
  ru: '🇷🇺 Русский',
  en: '🇬🇧 English',
  tr: '🇹🇷 Türkçe',
  kk: '🇰🇿 Қазақша',
  ky: '🇰🇬 Кыргызча',
  tg: '🇹🇯 Тоҷикӣ',
  de: '🇩🇪 Deutsch',
  fr: '🇫🇷 Français',
  es: '🇪🇸 Español',
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/** Interface language from Telegram's language_code. */
export function pickLang(code) {
  const c = String(code || '').toLowerCase().slice(0, 2);
  if (c === 'uz') return 'uz';
  if (['ru', 'uk', 'be', 'kk', 'ky', 'tg'].includes(c)) return 'ru';
  return 'en';
}

/** Default auto-translation target (the user's native language) from Telegram's language_code. */
export function pickTranslateTo(code) {
  const c = String(code || '').toLowerCase().slice(0, 2);
  if (!/^[a-z]{2}$/.test(c) || c === 'en') return null;
  return c;
}

function ruPlural(n, one, few, many) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

const COUNT = {
  word: {
    en: (n) => `${n} word${n === 1 ? '' : 's'}`,
    ru: (n) => `${n} ${ruPlural(n, 'слово', 'слова', 'слов')}`,
    uz: (n) => `${n} ta soʻz`,
  },
  review: {
    en: (n) => `${n} review${n === 1 ? '' : 's'}`,
    ru: (n) => `${n} ${ruPlural(n, 'повторение', 'повторения', 'повторений')}`,
    uz: (n) => `${n} ta takrorlash`,
  },
  day: {
    en: (n) => `${n} day${n === 1 ? '' : 's'}`,
    ru: (n) => `${n} ${ruPlural(n, 'день', 'дня', 'дней')}`,
    uz: (n) => `${n} kun`,
  },
};
export const count = (lang, what, n) => COUNT[what][lang](n);

const UNITS = {
  en: { m: 'm', h: 'h', d: 'd', mo: 'mo', y: 'y' },
  ru: { m: ' мин', h: ' ч', d: ' д', mo: ' мес', y: ' г' },
  uz: { m: ' daq', h: ' soat', d: ' kun', mo: ' oy', y: ' yil' },
};

/** "10m" / "10 мин" / "10 daq" */
export function fmtInterval(lang, ms) {
  const s = formatInterval(ms);
  const m = s.match(/^(<?)([\d.]+)(mo|y|d|h|m)$/);
  if (!m || lang === 'en') return s;
  return `${m[1]}${m[2].replace('.', ',')}${UNITS[lang][m[3]]}`;
}

const intervalsLine = (lang) => DEFAULT_INTERVALS.map((ms) => fmtInterval(lang, ms)).join(' → ');

export const MENU = {
  en: { review: '📚 Review', add: '➕ Add words', stats: '📊 Stats', list: '📋 My words', settings: '⚙️ Settings' },
  ru: { review: '📚 Повторить', add: '➕ Добавить слова', stats: '📊 Статистика', list: '📋 Мои слова', settings: '⚙️ Настройки' },
  uz: { review: '📚 Takrorlash', add: '➕ Soʻz qoʻshish', stats: '📊 Statistika', list: '📋 Soʻzlarim', settings: '⚙️ Sozlamalar' },
};

/** All labels of one menu button across languages (old keyboards keep working after a language switch). */
export const menuLabels = (key) => LANGS.map((l) => MENU[l][key]);
export const isMenuLabel = (text) => LANGS.some((l) => Object.values(MENU[l]).includes(text));

const WEEKDAYS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  uz: ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'],
};
export const weekday = (lang, i) => WEEKDAYS[lang][i];

const S = {
  // ---------- general ----------
  greet: {
    en: (name) => `👋 Hi, ${name}! I'll help you learn words with <b>spaced repetition</b>: every word comes back right before you would forget it.`,
    ru: (name) => `👋 Привет, ${name}! Я помогу учить слова методом <b>интервальных повторений</b>: каждое слово возвращается прямо перед тем, как вы его забудете.`,
    uz: (name) => `👋 Salom, ${name}! Men sizga soʻzlarni <b>oraliqli takrorlash</b> usulida yodlashga yordam beraman: har bir soʻz siz uni unutishingizdan oldin qaytadi.`,
  },
  help: {
    en: () => `<b>How it works</b>

1️⃣ Send me words, one per line:
<code>apple - olma</code>
<code>to borrow - qarz olmoq - Can I borrow your pen?</code>
Or send just the word — I'll translate it automatically.

2️⃣ Press <b>${MENU.en.review}</b> and rate how well you remembered each word:
❌ <b>Again</b> – forgot, it comes back in a minute
😐 <b>Hard</b> – the same interval again
✅ <b>Good</b> – next step
🚀 <b>Easy</b> – skip a step

3️⃣ Each word comes back after growing intervals:
${intervalsLine('en')}

🔔 I'll remind you when it's time to repeat.

/list – your words · /find – search &amp; edit · /stats – progress · /settings · /export`,
    ru: () => `<b>Как это работает</b>

1️⃣ Отправьте мне слова, по одному на строке:
<code>apple - яблоко</code>
<code>to borrow - занимать - Can I borrow your pen?</code>
Или отправьте просто слово — я переведу его автоматически.

2️⃣ Нажмите <b>${MENU.ru.review}</b> и оцените, насколько хорошо вы вспомнили слово:
❌ <b>Снова</b> – забыл, слово вернётся через минуту
😐 <b>Трудно</b> – тот же интервал ещё раз
✅ <b>Хорошо</b> – следующий шаг
🚀 <b>Легко</b> – через шаг

3️⃣ Каждое слово возвращается через растущие интервалы:
${intervalsLine('ru')}

🔔 Я напомню, когда пора повторять.

/list – мои слова · /find – поиск и правка · /stats – прогресс · /settings – настройки · /export – экспорт`,
    uz: () => `<b>Bu qanday ishlaydi</b>

1️⃣ Menga soʻzlarni yuboring, har bir qatorda bittadan:
<code>apple - olma</code>
<code>to borrow - qarz olmoq - Can I borrow your pen?</code>
Yoki faqat soʻzning oʻzini yuboring — men uni avtomatik tarjima qilaman.

2️⃣ <b>${MENU.uz.review}</b> tugmasini bosing va soʻzni qanchalik yaxshi eslaganingizni belgilang:
❌ <b>Yana</b> – esdan chiqdi, bir daqiqadan soʻng qaytadi
😐 <b>Qiyin</b> – xuddi shu oraliq yana
✅ <b>Yaxshi</b> – keyingi bosqich
🚀 <b>Oson</b> – bitta bosqichni oʻtkazib yuborish

3️⃣ Har bir soʻz tobora uzayib boruvchi oraliqlardan keyin qaytadi:
${intervalsLine('uz')}

🔔 Takrorlash vaqti kelganda eslatib turaman.

/list – soʻzlarim · /find – qidirish va tahrirlash · /stats – natijalar · /settings – sozlamalar · /export – yuklab olish`,
  },
  first_words: {
    en: 'Send me your first words now, or try some examples 👇',
    ru: 'Отправьте мне первые слова или попробуйте примеры 👇',
    uz: 'Birinchi soʻzlaringizni yuboring yoki namunalarni sinab koʻring 👇',
  },
  btn_samples: { en: '✨ Add sample words', ru: '✨ Добавить примеры слов', uz: '✨ Namuna soʻzlar qoʻshish' },
  choose_samples: { en: 'Which sample words should I add?', ru: 'Какие примеры добавить?', uz: 'Qaysi namuna soʻzlarni qoʻshay?' },
  cancelled: { en: 'OK, cancelled.', ru: 'Хорошо, отменено.', uz: 'Bekor qilindi.' },
  unknown_cmd: { en: 'Unknown command. See /help', ru: 'Неизвестная команда. Смотрите /help', uz: 'Nomaʼlum buyruq. /help ni koʻring' },
  inactive_btn: { en: 'This button is no longer active.', ru: 'Эта кнопка больше не активна.', uz: 'Bu tugma endi faol emas.' },
  private_only: { en: 'Please message me in a private chat 🙂', ru: 'Напишите мне в личные сообщения 🙂', uz: 'Menga shaxsiy xabarda yozing 🙂' },

  // ---------- adding words ----------
  add_help: {
    en: (max) => `Send me words — one per line:

<code>apple - olma
weather - ob-havo - The weather is nice today.</code>

Format: <i>word - translation - example</i> (the example is optional).
Several translations: <code>to borrow - qarz olmoq, qarzga olmoq</code>

✨ Or send just the word — I'll translate it automatically.
You can paste up to ${max} lines at once, e.g. two columns copied from Excel.`,
    ru: (max) => `Отправьте мне слова — по одному на строке:

<code>apple - яблоко
weather - погода - The weather is nice today.</code>

Формат: <i>слово - перевод - пример</i> (пример необязателен).
Несколько переводов: <code>to borrow - занимать, брать взаймы</code>

✨ Или отправьте просто слово — я переведу его автоматически.
Можно вставить до ${max} строк за раз, например два столбца из Excel.`,
    uz: (max) => `Menga soʻzlarni yuboring — har bir qatorda bittadan:

<code>apple - olma
weather - ob-havo - The weather is nice today.</code>

Format: <i>soʻz - tarjima - misol</i> (misol ixtiyoriy).
Bir nechta tarjima: <code>to borrow - qarz olmoq, qarzga olmoq</code>

✨ Yoki faqat soʻzning oʻzini yuboring — men uni avtomatik tarjima qilaman.
Bir martada ${max} tagacha qator yuborish mumkin, masalan Exceldan ikki ustunni nusxalab.`,
  },
  nothing_parsed: {
    en: "I didn't find any words. Use the format <code>word - translation</code>, one per line.\n\nExample:\n<code>apple - olma</code>",
    ru: 'Не нашёл слов. Используйте формат <code>слово - перевод</code>, по одному на строке.\n\nПример:\n<code>apple - яблоко</code>',
    uz: 'Soʻz topilmadi. <code>soʻz - tarjima</code> formatidan foydalaning, har bir qatorda bittadan.\n\nMisol:\n<code>apple - olma</code>',
  },
  too_many: {
    en: (n, max) => `That's ${n} lines — please send at most ${max} at a time.`,
    ru: (n, max) => `Здесь ${n} строк — отправляйте не больше ${max} за раз.`,
    uz: (n, max) => `Bu yerda ${n} ta qator — bir martada ${max} tadan koʻp yubormang.`,
  },
  added_n: {
    en: (n) => `✅ Added ${count('en', 'word', n)}.`,
    ru: (n) => `✅ Добавлено: ${count('ru', 'word', n)}.`,
    uz: (n) => `✅ ${n} ta soʻz qoʻshildi.`,
  },
  // w and t are HTML (use tRaw): the word is already bold and may carry a transcription.
  added_one: {
    en: (w, t) => `✅ Added: ${w} — ${t}`,
    ru: (w, t) => `✅ Добавлено: ${w} — ${t}`,
    uz: (w, t) => `✅ Qoʻshildi: ${w} — ${t}`,
  },
  nothing_new: { en: '🤔 Nothing new added.', ru: '🤔 Ничего нового не добавлено.', uz: '🤔 Yangi hech narsa qoʻshilmadi.' },
  skipped_dups: {
    en: (n) => `Already in your list (skipped): ${n}.`,
    ru: (n) => `Уже есть в вашем списке (пропущено): ${n}.`,
    uz: (n) => `Roʻyxatingizda allaqachon bor (oʻtkazib yuborildi): ${n}.`,
  },
  auto_note: {
    en: '<i>Translated automatically — tap ✏️ if it is wrong.</i>',
    ru: '<i>Переведено автоматически — нажмите ✏️, если перевод неверный.</i>',
    uz: '<i>Avtomatik tarjima qilindi — notoʻgʻri boʻlsa ✏️ ni bosing.</i>',
  },
  auto_note_many: {
    en: '<i>Translated automatically — to fix a translation, use /find word.</i>',
    ru: '<i>Переведено автоматически — исправить перевод можно через /find слово.</i>',
    uz: '<i>Avtomatik tarjima qilindi — tarjimani tuzatish uchun /find soʻz dan foydalaning.</i>',
  },
  not_translated: {
    en: (list) => `Couldn't translate: ${list}.\nSend them as <code>word - translation</code>.`,
    ru: (list) => `Не удалось перевести: ${list}.\nОтправьте их в виде <code>слово - перевод</code>.`,
    uz: (list) => `Tarjima qilib boʻlmadi: ${list}.\nUlarni <code>soʻz - tarjima</code> koʻrinishida yuboring.`,
  },
  translate_off_hint: {
    en: 'To add a word, send it with a translation: <code>word - translation</code>.\nTip: turn on auto-translation in ⚙️ Settings.',
    ru: 'Чтобы добавить слово, отправьте его с переводом: <code>слово - перевод</code>.\nСовет: включите автоперевод в ⚙️ Настройках.',
    uz: 'Soʻz qoʻshish uchun uni tarjimasi bilan yuboring: <code>soʻz - tarjima</code>.\nMaslahat: ⚙️ Sozlamalarda avtotarjimani yoqing.',
  },
  samples_added: {
    en: (n) => `✨ Added ${count('en', 'word', n)}. Let's start!`,
    ru: (n) => `✨ Добавлено: ${count('ru', 'word', n)}. Начнём!`,
    uz: (n) => `✨ ${n} ta namuna soʻz qoʻshildi. Boshladik!`,
  },
  btn_start_learning: { en: '▶️ Start learning', ru: '▶️ Начать учить', uz: '▶️ Oʻrganishni boshlash' },

  // ---------- review ----------
  head_new: { en: '🆕 <b>New word</b>', ru: '🆕 <b>Новое слово</b>', uz: '🆕 <b>Yangi soʻz</b>' },
  head_review: { en: '🔁 <b>Review</b>', ru: '🔁 <b>Повторение</b>', uz: '🔁 <b>Takrorlash</b>' },
  left: { en: (n) => `${n} left`, ru: (n) => `осталось ${n}`, uz: (n) => `${n} ta qoldi` },
  choose_word: { en: 'Choose the word:', ru: 'Выберите слово:', uz: 'Soʻzni tanlang:' },
  choose_translation: { en: 'Choose the translation:', ru: 'Выберите перевод:', uz: 'Tarjimani tanlang:' },
  type_word: { en: '✍️ Type the word:', ru: '✍️ Напишите слово:', uz: '✍️ Soʻzni yozing:' },
  type_translation: { en: '✍️ Type the translation:', ru: '✍️ Напишите перевод:', uz: '✍️ Tarjimasini yozing:' },
  btn_dont_know: { en: "🤷 Don't know", ru: '🤷 Не знаю', uz: '🤷 Bilmayman' },
  btn_show: { en: '👁 Show answer', ru: '👁 Показать ответ', uz: '👁 Javobni koʻrsatish' },
  how_well: { en: 'How well did you remember?', ru: 'Насколько хорошо вы вспомнили?', uz: 'Qanchalik yaxshi esladingiz?' },
  grade_0: { en: 'Again', ru: 'Снова', uz: 'Yana' },
  grade_1: { en: 'Hard', ru: 'Трудно', uz: 'Qiyin' },
  grade_2: { en: 'Good', ru: 'Хорошо', uz: 'Yaxshi' },
  grade_3: { en: 'Easy', ru: 'Легко', uz: 'Oson' },
  next_in: { en: (iv) => `next in ${iv}`, ru: (iv) => `снова через ${iv}`, uz: (iv) => `keyingisi ${iv} oʻtgach` },
  no_words_yet: {
    en: 'You have no words to study yet. Send me some words, e.g.\n<code>apple - olma</code>',
    ru: 'У вас пока нет слов для изучения. Отправьте мне слова, например:\n<code>apple - яблоко</code>',
    uz: 'Hozircha oʻrganish uchun soʻzlaringiz yoʻq. Menga soʻzlar yuboring, masalan:\n<code>apple - olma</code>',
  },
  all_done: { en: '🎉 <b>All done for now!</b>', ru: '🎉 <b>На сейчас всё!</b>', uz: '🎉 <b>Hozircha hammasi bajarildi!</b>' },
  limit_reached: {
    en: (limit, waiting, settings) => `Daily limit of new words (${limit}) reached. ${waiting} more are waiting for tomorrow — you can change the limit in ${settings}.`,
    ru: (limit, waiting, settings) => `Дневной лимит новых слов (${limit}) выполнен. Ещё ${waiting} ждут завтра — лимит можно изменить в разделе «${settings}».`,
    uz: (limit, waiting, settings) => `Kunlik yangi soʻzlar limiti (${limit}) bajarildi. Yana ${waiting} ta soʻz ertani kutmoqda — limitni «${settings}» boʻlimida oʻzgartirish mumkin.`,
  },
  next_review_in: {
    en: (iv) => `⏰ Next review in <b>${iv}</b> — I'll remind you.`,
    ru: (iv) => `⏰ Следующее повторение через <b>${iv}</b> — я напомню.`,
    uz: (iv) => `⏰ Keyingi takrorlash <b>${iv}</b> oʻtgach — eslatib qoʻyaman.`,
  },
  word_deleted: { en: 'This word was deleted.', ru: 'Это слово удалено.', uz: 'Bu soʻz oʻchirilgan.' },
  already_answered: { en: 'Already answered 👍', ru: 'Уже отвечено 👍', uz: 'Javob berilgan 👍' },
  correct_toast: { en: '✅ Correct!', ru: '✅ Верно!', uz: '✅ Toʻgʻri!' },
  wrong_toast: { en: '❌ Wrong', ru: '❌ Неверно', uz: '❌ Notoʻgʻri' },
  verdict_correct: { en: '✅ Correct', ru: '✅ Верно', uz: '✅ Toʻgʻri' },
  verdict_chose: { en: (x) => `❌ You chose: ${x}`, ru: (x) => `❌ Вы выбрали: ${x}`, uz: (x) => `❌ Siz tanladingiz: ${x}` },
  ask_again: { en: "🔁 I'll ask again in a minute.", ru: '🔁 Спрошу ещё раз через минуту.', uz: '🔁 Bir daqiqadan soʻng yana soʻrayman.' },
  typed_correct: { en: '✅ Correct!', ru: '✅ Верно!', uz: '✅ Toʻgʻri!' },
  typed_almost: {
    en: (x) => `😐 Almost! Correct spelling: <b>${x}</b>`,
    ru: (x) => `😐 Почти! Правильно: <b>${x}</b>`,
    uz: (x) => `😐 Deyarli! Toʻgʻri yozilishi: <b>${x}</b>`,
  },
  typed_wrong: {
    en: (x) => `❌ Correct answer: <b>${x}</b>`,
    ru: (x) => `❌ Правильный ответ: <b>${x}</b>`,
    uz: (x) => `❌ Toʻgʻri javob: <b>${x}</b>`,
  },
  next_review_short: {
    en: (iv) => `Next review in ${iv}`,
    ru: (iv) => `Следующее повторение через ${iv}`,
    uz: (iv) => `Keyingi takrorlash ${iv} oʻtgach`,
  },
  no_audio: { en: 'No pronunciation for this word.', ru: 'Для этого слова нет произношения.', uz: 'Bu soʻz uchun talaffuz yoʻq.' },

  // ---------- word list / find / edit ----------
  list_empty: {
    en: 'You have no words yet. Send me words like <code>apple - olma</code>',
    ru: 'У вас пока нет слов. Отправьте мне слова, например <code>apple - яблоко</code>',
    uz: 'Hozircha soʻzlaringiz yoʻq. Menga soʻz yuboring, masalan <code>apple - olma</code>',
  },
  list_head: {
    en: (total, page, pages) => `📋 <b>Your words</b> (${total}) · page ${page}/${pages}`,
    ru: (total, page, pages) => `📋 <b>Мои слова</b> (${total}) · стр. ${page}/${pages}`,
    uz: (total, page, pages) => `📋 <b>Soʻzlarim</b> (${total}) · ${page}/${pages}-sahifa`,
  },
  list_legend: {
    en: '🆕 new · 📖 learning · ✅ known · 🏆 mastered\nTo edit or delete a word: /find word',
    ru: '🆕 новое · 📖 учу · ✅ знаю · 🏆 выучено\nИзменить или удалить слово: /find слово',
    uz: '🆕 yangi · 📖 oʻrganilmoqda · ✅ bilaman · 🏆 yodlangan\nSoʻzni tahrirlash yoki oʻchirish: /find soʻz',
  },
  due_mark: { en: 'due', ru: 'пора', uz: 'vaqti keldi' },
  btn_prev: { en: '⬅️ Prev', ru: '⬅️ Назад', uz: '⬅️ Oldingi' },
  btn_next: { en: 'Next ➡️', ru: 'Далее ➡️', uz: 'Keyingi ➡️' },
  find_usage: { en: 'Usage: <code>/find apple</code>', ru: 'Например: <code>/find apple</code>', uz: 'Masalan: <code>/find apple</code>' },
  find_none: { en: (q) => `Nothing found for “${q}”.`, ru: (q) => `Ничего не найдено по запросу «${q}».`, uz: (q) => `“${q}” boʻyicha hech narsa topilmadi.` },
  find_more: { en: (n) => `…and ${n} more. Try a more specific search.`, ru: (n) => `…и ещё ${n}. Уточните запрос.`, uz: (n) => `…yana ${n} ta. Aniqroq qidiring.` },
  status_new: { en: 'new', ru: 'новое', uz: 'yangi' },
  status_learning: { en: 'learning', ru: 'учу', uz: 'oʻrganilmoqda' },
  status_known: { en: 'known', ru: 'знаю', uz: 'bilaman' },
  status_mastered: { en: 'mastered', ru: 'выучено', uz: 'yodlangan' },
  card_state: {
    en: (status, stage, max, when) => `${status}, step ${stage}/${max}, ${when}`,
    ru: (status, stage, max, when) => `${status}, шаг ${stage}/${max}, ${when}`,
    uz: (status, stage, max, when) => `${status}, ${stage}/${max}-bosqich, ${when}`,
  },
  when_new: { en: 'not studied yet', ru: 'ещё не изучалось', uz: 'hali oʻrganilmagan' },
  when_due: { en: 'due now', ru: 'пора повторить', uz: 'takrorlash vaqti keldi' },
  when_next: { en: (iv) => `next review in ${iv}`, ru: (iv) => `повторение через ${iv}`, uz: (iv) => `keyingi takrorlash ${iv} oʻtgach` },
  btn_delete: { en: '🗑 Delete', ru: '🗑 Удалить', uz: '🗑 Oʻchirish' },
  btn_reset: { en: '🔄 Reset', ru: '🔄 Сбросить', uz: '🔄 Qaytadan' },
  btn_edit: { en: '✏️ Edit', ru: '✏️ Изменить', uz: '✏️ Tahrirlash' },
  deleted_toast: { en: 'Deleted', ru: 'Удалено', uz: 'Oʻchirildi' },
  already_deleted: { en: 'Already deleted', ru: 'Уже удалено', uz: 'Allaqachon oʻchirilgan' },
  deleted_msg: { en: '🗑 Deleted.', ru: '🗑 Удалено.', uz: '🗑 Oʻchirildi.' },
  reset_toast: {
    en: 'Progress reset — it is a new word again',
    ru: 'Прогресс сброшен — слово снова новое',
    uz: 'Natija tozalandi — soʻz yana yangi',
  },
  not_found_toast: { en: 'Word not found', ru: 'Слово не найдено', uz: 'Soʻz topilmadi' },
  edit_prompt: {
    en: (cur) => `✏️ Send the new version in one line:\n<code>word - translation - example</code>\n\nNow:\n<code>${cur}</code>\n\n/cancel – keep it as it is`,
    ru: (cur) => `✏️ Отправьте новый вариант одной строкой:\n<code>слово - перевод - пример</code>\n\nСейчас:\n<code>${cur}</code>\n\n/cancel – оставить как есть`,
    uz: (cur) => `✏️ Yangi variantni bitta qatorda yuboring:\n<code>soʻz - tarjima - misol</code>\n\nHozir:\n<code>${cur}</code>\n\n/cancel – oʻzgartirmaslik`,
  },
  edit_saved: { en: '✅ Saved.', ru: '✅ Сохранено.', uz: '✅ Saqlandi.' },
  edit_duplicate: {
    en: (w) => `You already have the word “${w}”. Send another version or /cancel.`,
    ru: (w) => `Слово «${w}» уже есть в вашем списке. Отправьте другой вариант или /cancel.`,
    uz: (w) => `“${w}” soʻzi roʻyxatingizda allaqachon bor. Boshqa variant yuboring yoki /cancel.`,
  },
  edit_bad: {
    en: 'Please send it as <code>word - translation</code> (the example is optional), or /cancel.',
    ru: 'Отправьте в виде <code>слово - перевод</code> (пример необязателен) или /cancel.',
    uz: '<code>soʻz - tarjima</code> koʻrinishida yuboring (misol ixtiyoriy) yoki /cancel.',
  },

  // ---------- stats ----------
  stats_empty: {
    en: 'No words yet — send me some to get started!',
    ru: 'Слов пока нет — отправьте мне несколько, чтобы начать!',
    uz: 'Hozircha soʻzlar yoʻq — boshlash uchun bir nechta soʻz yuboring!',
  },
  stats: {
    en: (s) => `📊 <b>Your progress</b>

📚 Words: <b>${s.total}</b>
🆕 New: ${s.new}
📖 Learning: ${s.learning}
✅ Known: ${s.known}
🏆 Mastered: ${s.mastered}

⏰ Due now: <b>${s.due}</b>
📅 Today: ${count('en', 'review', s.reviews_today)}, ${s.pct_today} correct, ${s.new_today} new
🔥 Streak: ${count('en', 'day', s.streak)}
🎯 Accuracy (all time): ${s.accuracy}

<b>Upcoming reviews</b>
${s.bars}`,
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
    uz: (s) => `📊 <b>Natijalarim</b>

📚 Soʻzlar: <b>${s.total}</b>
🆕 Yangi: ${s.new}
📖 Oʻrganilmoqda: ${s.learning}
✅ Bilaman: ${s.known}
🏆 Yodlangan: ${s.mastered}

⏰ Takrorlash vaqti kelgan: <b>${s.due}</b>
📅 Bugun: ${count('uz', 'review', s.reviews_today)}, ${s.pct_today} toʻgʻri, ${s.new_today} ta yangi
🔥 Ketma-ket: ${count('uz', 'day', s.streak)}
🎯 Aniqlik (umumiy): ${s.accuracy}

<b>Yaqin takrorlashlar</b>
${s.bars}`,
  },
  today: { en: 'Today', ru: 'Сегодня', uz: 'Bugun' },
  btn_review_now: { en: '▶️ Review now', ru: '▶️ Повторить сейчас', uz: '▶️ Hozir takrorlash' },

  // ---------- settings ----------
  settings: {
    en: (o) => `⚙️ <b>Settings</b>

🎴 Study mode: <b>${o.mode}</b>
🔀 Direction: <b>${o.dir}</b>
🆕 New words per day: <b>${o.perDay}</b>
🔔 Reminders: <b>${o.remind}</b>
🌙 Quiet hours (no reminders): <b>${o.quiet}</b>
🌍 Time zone: <b>${o.tz}</b> (your time now: ${o.time})
🔤 Auto-translate new words into: <b>${o.translate}</b>
🌐 Language: <b>${o.lang}</b>

Exact time zone: <code>/timezone +5:30</code>`,
    ru: (o) => `⚙️ <b>Настройки</b>

🎴 Режим: <b>${o.mode}</b>
🔀 Направление: <b>${o.dir}</b>
🆕 Новых слов в день: <b>${o.perDay}</b>
🔔 Напоминания: <b>${o.remind}</b>
🌙 Тихие часы (без напоминаний): <b>${o.quiet}</b>
🌍 Часовой пояс: <b>${o.tz}</b> (у вас сейчас ${o.time})
🔤 Автоперевод новых слов на: <b>${o.translate}</b>
🌐 Язык: <b>${o.lang}</b>

Точный часовой пояс: <code>/timezone +5:30</code>`,
    uz: (o) => `⚙️ <b>Sozlamalar</b>

🎴 Rejim: <b>${o.mode}</b>
🔀 Yoʻnalish: <b>${o.dir}</b>
🆕 Kuniga yangi soʻzlar: <b>${o.perDay}</b>
🔔 Eslatmalar: <b>${o.remind}</b>
🌙 Tinch soatlar (eslatmasiz): <b>${o.quiet}</b>
🌍 Vaqt mintaqasi: <b>${o.tz}</b> (hozir sizda ${o.time})
🔤 Yangi soʻzlarni avtotarjima tili: <b>${o.translate}</b>
🌐 Til: <b>${o.lang}</b>

Aniq vaqt mintaqasi: <code>/timezone +5:30</code>`,
  },
  mode_flip: { en: 'Flashcards', ru: 'Карточки', uz: 'Kartochkalar' },
  mode_choice: { en: 'Multiple choice', ru: 'Выбор ответа', uz: 'Variant tanlash' },
  mode_type: { en: 'Type the answer', ru: 'Ввод ответа', uz: 'Javobni yozish' },
  dir_forward: { en: 'Word → Translation', ru: 'Слово → Перевод', uz: 'Soʻz → Tarjima' },
  dir_reverse: { en: 'Translation → Word', ru: 'Перевод → Слово', uz: 'Tarjima → Soʻz' },
  dir_mixed: { en: 'Mixed', ru: 'Вперемешку', uz: 'Aralash' },
  on: { en: 'on', ru: 'вкл', uz: 'yoqilgan' },
  off: { en: 'off', ru: 'выкл', uz: 'oʻchiq' },
  per_day: { en: (n) => `${n}/day`, ru: (n) => `${n}/день`, uz: (n) => `kuniga ${n}` },
  btn_reminders_on: { en: '🔔 Reminders: on', ru: '🔔 Напоминания: вкл', uz: '🔔 Eslatmalar: yoqilgan' },
  btn_reminders_off: { en: '🔕 Reminders: off', ru: '🔕 Напоминания: выкл', uz: '🔕 Eslatmalar: oʻchiq' },
  btn_quiet: { en: (q) => `🌙 Quiet: ${q}`, ru: (q) => `🌙 Тишина: ${q}`, uz: (q) => `🌙 Tinch: ${q}` },
  btn_wipe: { en: '🗑 Delete all my words', ru: '🗑 Удалить все мои слова', uz: '🗑 Barcha soʻzlarimni oʻchirish' },
  choose_lang: { en: 'Choose the interface language:', ru: 'Выберите язык интерфейса:', uz: 'Interfeys tilini tanlang:' },
  lang_set: { en: 'Language: English 🇬🇧', ru: 'Язык: Русский 🇷🇺', uz: 'Til: Oʻzbekcha 🇺🇿' },
  choose_translate: {
    en: 'Which language should I translate new words into?',
    ru: 'На какой язык переводить новые слова?',
    uz: 'Yangi soʻzlarni qaysi tilga tarjima qilay?',
  },
  btn_translate_off: { en: '🚫 Do not translate', ru: '🚫 Не переводить', uz: '🚫 Tarjima qilmaslik' },
  btn_back: { en: '⬅️ Back', ru: '⬅️ Назад', uz: '⬅️ Orqaga' },
  tz_usage: {
    en: 'Usage: <code>/timezone +5</code>, <code>/timezone -4</code> or <code>/timezone +5:30</code>',
    ru: 'Например: <code>/timezone +5</code>, <code>/timezone -4</code> или <code>/timezone +5:30</code>',
    uz: 'Masalan: <code>/timezone +5</code>, <code>/timezone -4</code> yoki <code>/timezone +5:30</code>',
  },
  tz_set: {
    en: (tz, time) => `🌍 Time zone set to <b>${tz}</b>. Your time now: ${time}`,
    ru: (tz, time) => `🌍 Часовой пояс: <b>${tz}</b>. У вас сейчас ${time}.`,
    uz: (tz, time) => `🌍 Vaqt mintaqasi: <b>${tz}</b>. Hozir sizda ${time}.`,
  },
  wipe_confirm: {
    en: '⚠️ Delete <b>all</b> your words and progress? This cannot be undone.',
    ru: '⚠️ Удалить <b>все</b> ваши слова и прогресс? Это нельзя отменить.',
    uz: '⚠️ <b>Barcha</b> soʻzlaringiz va natijalaringiz oʻchirilsinmi? Buni qaytarib boʻlmaydi.',
  },
  btn_wipe_yes: { en: 'Yes, delete everything', ru: 'Да, удалить всё', uz: 'Ha, hammasini oʻchirish' },
  btn_cancel: { en: 'Cancel', ru: 'Отмена', uz: 'Bekor qilish' },
  wiped: { en: '🗑 All words deleted.', ru: '🗑 Все слова удалены.', uz: '🗑 Barcha soʻzlar oʻchirildi.' },
  wipe_cancelled: { en: 'OK, nothing was deleted.', ru: 'Хорошо, ничего не удалено.', uz: 'Hech narsa oʻchirilmadi.' },

  // ---------- export ----------
  export_none: { en: 'You have no words to export yet.', ru: 'Пока нечего экспортировать.', uz: 'Hozircha yuklab olish uchun soʻzlar yoʻq.' },
  export_caption: { en: (n) => `📦 ${count('en', 'word', n)}`, ru: (n) => `📦 ${count('ru', 'word', n)}`, uz: (n) => `📦 ${count('uz', 'word', n)}` },

  // ---------- reminders ----------
  reminder: {
    en: (n) => `🔔 Time to repeat! <b>${n}</b> ${n === 1 ? 'word is' : 'words are'} waiting for review.\n\nRepeat them now, before you forget 🧠`,
    ru: (n) => `🔔 Пора повторить! Слов на повторение: <b>${n}</b>.\n\nПовторите их сейчас, пока не забыли 🧠`,
    uz: (n) => `🔔 Takrorlash vaqti keldi! <b>${n}</b> ta soʻz sizni kutmoqda.\n\nUnutib qoʻymasdan hozir takrorlang 🧠`,
  },
  btn_start_review: { en: '▶️ Start review', ru: '▶️ Начать повторение', uz: '▶️ Takrorlashni boshlash' },

  // ---------- bot profile (shown by Telegram) ----------
  description: {
    en: () => `Learn English (or any language) words with spaced repetition 🧠

• Send words — I translate them automatically
• Review with flashcards, quizzes or by typing
• Each word comes back right before you would forget it: ${intervalsLine('en')}
• I remind you when it's time to repeat 🔔`,
    ru: () => `Учите английские (и любые другие) слова методом интервальных повторений 🧠

• Отправьте слова — я переведу их автоматически
• Повторяйте карточками, тестами или вводом ответа
• Каждое слово возвращается прямо перед тем, как вы его забудете: ${intervalsLine('ru')}
• Я напомню, когда пора повторять 🔔`,
    uz: () => `Ingliz tili (yoki istalgan til) soʻzlarini oraliqli takrorlash usulida yodlang 🧠

• Soʻzlarni yuboring — men ularni avtomatik tarjima qilaman
• Kartochkalar, testlar yoki javob yozish orqali takrorlang
• Har bir soʻz siz uni unutishingizdan oldin qaytadi: ${intervalsLine('uz')}
• Takrorlash vaqti kelganda eslatib turaman 🔔`,
  },
  short_description: {
    en: 'Learn words with spaced repetition: auto-translation, flashcards and reminders 🧠',
    ru: 'Учите слова с интервальными повторениями: автоперевод, карточки и напоминания 🧠',
    uz: 'Soʻzlarni oraliqli takrorlash bilan yodlang: avtotarjima, kartochkalar va eslatmalar 🧠',
  },
};

export const COMMANDS = {
  en: [
    ['review', 'Repeat words that are due'],
    ['add', 'How to add words'],
    ['list', 'Your words'],
    ['find', 'Find, edit or delete a word'],
    ['stats', 'Your progress'],
    ['settings', 'Mode, reminders, language'],
    ['export', 'Download your words (CSV)'],
    ['sample', 'Add sample words'],
    ['help', 'How it works'],
  ],
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
  uz: [
    ['review', 'Soʻzlarni takrorlash'],
    ['add', 'Soʻz qanday qoʻshiladi'],
    ['list', 'Soʻzlarim'],
    ['find', 'Soʻzni topish, tahrirlash yoki oʻchirish'],
    ['stats', 'Natijalarim'],
    ['settings', 'Rejim, eslatmalar, til'],
    ['export', 'Soʻzlarni yuklab olish (CSV)'],
    ['sample', 'Namuna soʻzlar qoʻshish'],
    ['help', 'Bu qanday ishlaydi'],
  ],
};

export const STRINGS = S;

function lookup(lang, key) {
  const entry = S[key];
  if (!entry) throw new Error(`Unknown text key: ${key}`);
  return entry[lang] ?? entry.en;
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
