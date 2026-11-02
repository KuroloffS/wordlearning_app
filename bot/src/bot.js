import { Bot, InlineKeyboard, Keyboard, InputFile, GrammyError } from 'grammy';
import {
  GRADES,
  GRADE_NAMES,
  DEFAULT_INTERVALS,
  schedule,
  previewIntervals,
  isNew,
  cardStatus,
  formatInterval,
  gradeTypedAnswer,
  parseBulk,
} from '../../js/srs.js';
import { startOfLocalDay, localTime, formatOffset, parseOffset, streakFromDays } from './time.js';
import { SAMPLE_WORDS } from './samples.js';

const INTERVALS = DEFAULT_INTERVALS;
const MAX_STAGE = INTERVALS.length;
const PAGE_SIZE = 20;
const MAX_IMPORT = 500;

export const MENU = {
  review: '📚 Review',
  add: '➕ Add words',
  stats: '📊 Stats',
  list: '📋 My words',
  settings: '⚙️ Settings',
};

export const COMMANDS = [
  ['review', 'Repeat words that are due'],
  ['add', 'How to add words'],
  ['list', 'Your words'],
  ['find', 'Find a word: /find apple'],
  ['stats', 'Your progress'],
  ['settings', 'Mode, reminders, time zone'],
  ['export', 'Download your words as CSV'],
  ['sample', 'Add sample words'],
  ['help', 'How it works'],
];

const MODE_NAMES = { flip: 'Flashcards', choice: 'Multiple choice', type: 'Type the answer' };
const DIR_NAMES = { forward: 'Word → Translation', reverse: 'Translation → Word', mixed: 'Mixed' };
const QUIET_PRESETS = [[23, 8], [22, 8], [0, 9], [21, 7], [0, 0]];
const GRADE_ICONS = ['❌', '😐', '✅', '🚀'];

export function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const mainKeyboard = new Keyboard()
  .text(MENU.review)
  .text(MENU.add)
  .row()
  .text(MENU.stats)
  .text(MENU.list)
  .text(MENU.settings)
  .resized()
  .persistent();

const HELP = `<b>How it works</b>

1️⃣ Send me words, one per line:
<code>apple - яблоко</code>
<code>to borrow - занимать - Can I borrow your pen?</code>
(word - translation - optional example; tab, "=", ";" also work)

2️⃣ Press <b>${MENU.review}</b>. For every word, say how well you remembered it:
❌ <b>Again</b> – forgot, it comes back in a minute
😐 <b>Hard</b> – same interval again
✅ <b>Good</b> – next step
🚀 <b>Easy</b> – skip a step

3️⃣ Each word comes back after growing intervals:
${INTERVALS.map(formatInterval).join(' → ')}

🔔 I'll message you when words are due for review.

/list – your words · /find – search · /stats – progress · /settings · /export`;

/**
 * Builds the bot. `db` is db/supabase.js or db/memory.js; `clock` returns the current time in ms.
 */
export function createBot(token, db, { clock = Date.now, botInfo, random = Math.random } = {}) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);

  // ---------- load user on every update ----------
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    ctx.user = await db.upsertUser(ctx.from, clock());
    // Leaving a typed-answer question by pressing a menu button or a command cancels it.
    const text = ctx.message?.text;
    if (ctx.user.pending && text && (text.startsWith('/') || Object.values(MENU).includes(text))) {
      await setPending(ctx, null);
    }
    await next();
  });

  async function setPending(ctx, pending) {
    ctx.user.pending = pending;
    await db.updateUser(ctx.user.id, { pending });
  }

  const reply = (ctx, text, extra = {}) => ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

  // ---------- basic commands ----------
  bot.command('start', async (ctx) => {
    const name = esc(ctx.from.first_name || 'there');
    await reply(
      ctx,
      `👋 Hi, ${name}! I'll help you learn words with <b>spaced repetition</b>: every word comes back right before you would forget it.\n\n${HELP}`,
      { reply_markup: mainKeyboard },
    );
    if ((await db.countNew(ctx.user.id)) + (await db.countDue(ctx.user.id, clock())) === 0) {
      await reply(ctx, 'Send me your first words now, or try some examples 👇', {
        reply_markup: new InlineKeyboard().text('✨ Add sample words', 'sample'),
      });
    }
  });

  bot.command('help', (ctx) => reply(ctx, HELP, { reply_markup: mainKeyboard }));

  bot.command('cancel', (ctx) => reply(ctx, 'OK, cancelled.', { reply_markup: mainKeyboard }));

  const addHelp = (ctx) =>
    reply(
      ctx,
      `Send me words — one per line:\n\n<code>apple - яблоко\nweather - погода - The weather is nice today.\nhouse\tдом</code>\n\nFormat: <i>word - translation - example</i> (example is optional).\nSeveral translations: <code>to borrow - занимать, брать взаймы</code>\nYou can paste up to ${MAX_IMPORT} lines at once, e.g. two columns copied from Excel.`,
    );
  bot.command('add', addHelp);
  bot.hears(MENU.add, addHelp);

  // ---------- review ----------
  const startReview = (ctx) => sendNextCard(ctx);
  bot.command('review', startReview);
  bot.hears(MENU.review, startReview);
  bot.callbackQuery('review', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendNextCard(ctx);
  });

  function pickReverse(user) {
    if (user.direction === 'reverse') return true;
    if (user.direction === 'mixed') return random() < 0.5;
    return false;
  }

  async function sendNextCard(ctx) {
    const user = ctx.user;
    const now = clock();
    const learnedToday = await db.countNewLearnedSince(user.id, startOfLocalDay(now, user.tz_offset_min));
    const newLeft = Math.max(0, user.new_per_day - learnedToday);
    const card = await db.getNextCard(user.id, now, newLeft > 0);

    if (!card) {
      if (user.pending) await setPending(ctx, null);
      return reply(ctx, await doneText(user, now, newLeft), { reply_markup: mainKeyboard });
    }

    const rev = pickReverse(user);
    const dueCount = await db.countDue(user.id, now);
    const left = dueCount + (isNew(card) ? Math.min(newLeft, await db.countNew(user.id)) : 0);
    const head = `${isNew(card) ? '🆕 <b>New word</b>' : '🔁 <b>Review</b>'} · ${left} left`;
    const prompt = `${head}\n\n<b>${esc(rev ? card.translation : card.word)}</b>`;

    let mode = user.mode;
    let options;
    if (mode === 'choice') {
      const field = rev ? 'word' : 'translation';
      const correct = rev ? card.word : card.translation;
      const others = [...new Set(await db.recentAnswers(user.id, card.id, field))].filter((a) => a !== correct);
      if (others.length < 2) mode = 'flip';
      else options = shuffle([correct, ...shuffle(others).slice(0, 3)]);
    }

    if (mode === 'choice') {
      const correctIdx = options.indexOf(rev ? card.word : card.translation);
      const kb = new InlineKeyboard();
      options.forEach((o, i) => kb.text(truncate(o, 60), `c:${card.id}:${card.reps}:${+rev}:${i}:${correctIdx}`).row());
      kb.text('🤷 Don\'t know', `k:${card.id}:${card.reps}:${+rev}`);
      return reply(ctx, `${prompt}\n\nChoose the ${rev ? 'word' : 'translation'}:`, { reply_markup: kb });
    }

    if (mode === 'type') {
      await setPending(ctx, { card_id: card.id, reps: card.reps, rev });
      return reply(ctx, `${prompt}\n\n✍️ Type the ${rev ? 'word' : 'translation'}:`, {
        reply_markup: new InlineKeyboard().text('🤷 Don\'t know', `k:${card.id}:${card.reps}:${+rev}`),
      });
    }

    return reply(ctx, prompt, {
      reply_markup: new InlineKeyboard().text('👁 Show answer', `s:${card.id}:${card.reps}:${+rev}`),
    });
  }

  async function doneText(user, now, newLeft) {
    const [nextDue, newCount] = await Promise.all([db.nextDueAt(user.id, now), db.countNew(user.id)]);
    if (!nextDue && newCount === 0) {
      return 'You have no words to study yet. Send me some words, e.g.\n<code>apple - яблоко</code>';
    }
    const lines = ['🎉 <b>All done for now!</b>'];
    if (newCount > 0 && newLeft === 0) {
      lines.push(`You've learned your ${user.new_per_day} new words for today. ${newCount} more are waiting for tomorrow (change the limit in ${MENU.settings}).`);
    }
    if (nextDue) lines.push(`⏰ Next review in <b>${formatInterval(nextDue - now)}</b> — I'll remind you.`);
    return lines.join('\n\n');
  }

  function truncate(s, n) {
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function cardText(card, rev) {
    const q = rev ? card.translation : card.word;
    const a = rev ? card.word : card.translation;
    let t = `<b>${esc(q)}</b>\n${esc(a)}`;
    if (card.example) t += `\n\n<i>${esc(card.example)}</i>`;
    return t;
  }

  /** Loads the card from callback data and checks that the button is not stale. */
  async function cardFromCallback(ctx, id, reps) {
    const card = await db.getCard(ctx.user.id, id);
    if (!card) {
      await ctx.answerCallbackQuery({ text: 'This word was deleted.' });
      return null;
    }
    if (card.reps !== Number(reps)) {
      await ctx.answerCallbackQuery({ text: 'Already answered 👍' });
      return null;
    }
    return card;
  }

  // Show answer (flashcards)
  bot.callbackQuery(/^s:([0-9a-f-]{36}):(\d+):([01])$/, async (ctx) => {
    const [, id, reps, rev] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    await ctx.answerCallbackQuery();
    const previews = previewIntervals(card, INTERVALS);
    const kb = new InlineKeyboard();
    [GRADES.AGAIN, GRADES.HARD, GRADES.GOOD, GRADES.EASY].forEach((g) =>
      kb.text(`${GRADE_ICONS[g]} ${GRADE_NAMES[g]} · ${formatInterval(previews[g])}`, `g:${card.id}:${card.reps}:${rev}:${g}`).row(),
    );
    await ctx.editMessageText(`${isNew(card) ? '🆕' : '🔁'} ${cardText(card, rev === '1')}\n\nHow well did you remember?`, {
      parse_mode: 'HTML',
      reply_markup: kb,
    });
  });

  // Grade (flashcards)
  bot.callbackQuery(/^g:([0-9a-f-]{36}):(\d+):([01]):([0-3])$/, async (ctx) => {
    const [, id, reps, rev, g] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    await ctx.answerCallbackQuery();
    const result = await applyGrade(ctx, card, Number(g));
    if (!result) return;
    await ctx.editMessageText(`${cardText(card, rev === '1')}\n\n${GRADE_ICONS[g]} ${GRADE_NAMES[g]} · next in ${formatInterval(result.due - clock())}`, {
      parse_mode: 'HTML',
    });
    await sendNextCard(ctx);
  });

  // Multiple choice answer
  bot.callbackQuery(/^c:([0-9a-f-]{36}):(\d+):([01]):(\d):(\d)$/, async (ctx) => {
    const [, id, reps, rev, chosen, correct] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    const ok = chosen === correct;
    await ctx.answerCallbackQuery({ text: ok ? '✅ Correct!' : '❌ Wrong' });
    const g = ok ? GRADES.GOOD : GRADES.AGAIN;
    const result = await applyGrade(ctx, card, g);
    if (!result) return;
    const picked = ctx.callbackQuery.message?.reply_markup?.inline_keyboard?.[Number(chosen)]?.[0]?.text;
    const verdict = ok ? '✅ Correct' : `❌ You chose: ${esc(picked ?? '?')}`;
    await ctx.editMessageText(`${cardText(card, rev === '1')}\n\n${verdict} · next in ${formatInterval(result.due - clock())}`, {
      parse_mode: 'HTML',
    });
    await sendNextCard(ctx);
  });

  // "Don't know" (choice / type)
  bot.callbackQuery(/^k:([0-9a-f-]{36}):(\d+):([01])$/, async (ctx) => {
    const [, id, reps, rev] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    await ctx.answerCallbackQuery();
    if (ctx.user.pending) await setPending(ctx, null);
    const result = await applyGrade(ctx, card, GRADES.AGAIN);
    if (!result) return;
    await ctx.editMessageText(`${cardText(card, rev === '1')}\n\n🔁 I'll ask again in a minute.`, { parse_mode: 'HTML' });
    await sendNextCard(ctx);
  });

  async function applyGrade(ctx, card, grade) {
    const now = clock();
    const wasNew = isNew(card);
    const updated = schedule(card, grade, now, INTERVALS);
    const saved = await db.saveReview(updated, card.reps, grade, wasNew, now);
    return saved ? updated : null;
  }

  // ---------- word list ----------
  async function sendList(ctx, page, edit = false) {
    const { cards, total } = await db.listCards(ctx.user.id, { offset: page * PAGE_SIZE, limit: PAGE_SIZE });
    if (total === 0) return reply(ctx, 'You have no words yet. Send me words like <code>apple - яблоко</code>');
    const pages = Math.ceil(total / PAGE_SIZE);
    const now = clock();
    const icon = { new: '🆕', learning: '📖', known: '✅', mastered: '🏆' };
    const lines = cards.map((c) => {
      const s = cardStatus(c, INTERVALS);
      const when = isNew(c) ? '' : c.due <= now ? ' · <b>due</b>' : ` · ${formatInterval(c.due - now)}`;
      return `${icon[s]} <b>${esc(c.word)}</b> — ${esc(c.translation)}<i>${when}</i>`;
    });
    const text = `📋 <b>Your words</b> (${total}) · page ${page + 1}/${pages}\n\n${lines.join('\n')}\n\n🆕 new · 📖 learning · ✅ known · 🏆 mastered\nTo delete or reset a word: /find word`;
    const kb = new InlineKeyboard();
    if (page > 0) kb.text('⬅️ Prev', `l:${page - 1}`);
    if (page < pages - 1) kb.text('Next ➡️', `l:${page + 1}`);
    const extra = { parse_mode: 'HTML', reply_markup: kb };
    return edit ? ctx.editMessageText(text, extra) : ctx.reply(text, extra);
  }
  bot.command('list', (ctx) => sendList(ctx, 0));
  bot.hears(MENU.list, (ctx) => sendList(ctx, 0));
  bot.callbackQuery(/^l:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendList(ctx, Number(ctx.match[1]), true);
  });

  bot.command('find', async (ctx) => {
    const q = ctx.match.trim();
    if (!q) return reply(ctx, 'Usage: <code>/find apple</code>');
    const { cards, total } = await db.listCards(ctx.user.id, { search: q, limit: 5 });
    if (!total) return reply(ctx, `Nothing found for “${esc(q)}”.`);
    const now = clock();
    for (const c of cards) {
      const s = cardStatus(c, INTERVALS);
      const when = isNew(c) ? 'not studied yet' : c.due <= now ? 'due now' : `next review in ${formatInterval(c.due - now)}`;
      await reply(ctx, `${cardText(c, false)}\n\n<i>${s}, step ${c.stage}/${MAX_STAGE}, ${when}</i>`, {
        reply_markup: new InlineKeyboard().text('🗑 Delete', `d:${c.id}`).text('🔄 Reset progress', `z:${c.id}`),
      });
    }
    if (total > cards.length) await reply(ctx, `…and ${total - cards.length} more. Try a more specific search.`);
  });

  bot.callbackQuery(/^d:([0-9a-f-]{36})$/, async (ctx) => {
    const ok = await db.deleteCard(ctx.user.id, ctx.match[1]);
    await ctx.answerCallbackQuery({ text: ok ? 'Deleted' : 'Already deleted' });
    if (ok) await ctx.editMessageText('🗑 Deleted.');
  });

  bot.callbackQuery(/^z:([0-9a-f-]{36})$/, async (ctx) => {
    const ok = await db.resetCard(ctx.user.id, ctx.match[1], clock());
    await ctx.answerCallbackQuery({ text: ok ? 'Progress reset — it is a new word again' : 'Word not found' });
    if (ok) await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text('🗑 Delete', `d:${ctx.match[1]}`) });
  });

  // ---------- stats ----------
  async function sendStats(ctx) {
    const u = ctx.user;
    const now = clock();
    const s = await db.stats(u.id, now, u.tz_offset_min, MAX_STAGE);
    if (!s.total) return reply(ctx, 'No words yet — send me some to get started!');
    const streak = streakFromDays(s.days, now, u.tz_offset_min);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
    const max = Math.max(1, ...s.forecast);
    const dayName = (n) => (n === 0 ? 'Today' : new Date(now + u.tz_offset_min * 60000 + n * 86400000).toUTCString().slice(0, 3));
    const bars = s.forecast
      .map((v, n) => `<code>${dayName(n).padEnd(5)} ${'▇'.repeat(Math.round((v / max) * 12)).padEnd(12, ' ')} ${v}</code>`)
      .join('\n');
    const text = `📊 <b>Your progress</b>

📚 Words: <b>${s.total}</b>
🆕 New: ${s.new}
📖 Learning: ${s.learning}
✅ Known: ${s.known}
🏆 Mastered: ${s.mastered}

⏰ Due now: <b>${s.due}</b>
📅 Today: ${plural(s.reviews_today, 'review')}, ${pct(s.correct_today, s.reviews_today)} correct, ${s.new_today} new
🔥 Streak: ${plural(streak, 'day')}
🎯 Accuracy (all time): ${pct(s.correct_total, s.reviews_total)}

<b>Upcoming reviews</b>
${bars}`;
    const kb = s.due ? new InlineKeyboard().text('▶️ Review now', 'review') : undefined;
    return reply(ctx, text, { reply_markup: kb });
  }
  bot.command('stats', sendStats);
  bot.hears(MENU.stats, sendStats);

  // ---------- settings ----------
  function settingsView(u) {
    const quiet = u.quiet_start === u.quiet_end ? 'off' : `${String(u.quiet_start).padStart(2, '0')}:00–${String(u.quiet_end).padStart(2, '0')}:00`;
    const text = `⚙️ <b>Settings</b>

🎴 Study mode: <b>${MODE_NAMES[u.mode]}</b>
🔀 Direction: <b>${DIR_NAMES[u.direction]}</b>
🆕 New words per day: <b>${u.new_per_day}</b>
🔔 Reminders: <b>${u.remind ? 'on' : 'off'}</b>
🌙 Quiet hours (no reminders): <b>${quiet}</b>
🌍 Time zone: <b>${formatOffset(u.tz_offset_min)}</b> (your time now: ${localTime(clock(), u.tz_offset_min)})

Exact time zone: <code>/timezone +5:30</code>`;
    const kb = new InlineKeyboard()
      .text(`🎴 ${MODE_NAMES[u.mode]}`, 'set:mode')
      .text(`🔀 ${DIR_NAMES[u.direction]}`, 'set:dir')
      .row()
      .text('➖5', 'set:new:-5')
      .text(`🆕 ${u.new_per_day}/day`, 'set:noop')
      .text('➕5', 'set:new:5')
      .row()
      .text(u.remind ? '🔔 Reminders: on' : '🔕 Reminders: off', 'set:remind')
      .text(`🌙 Quiet: ${quiet}`, 'set:quiet')
      .row()
      .text('➖1h', 'set:tz:-60')
      .text(formatOffset(u.tz_offset_min), 'set:noop')
      .text('➕1h', 'set:tz:60')
      .row()
      .text('🗑 Delete all my words', 'wipe');
    return { text, kb };
  }

  async function sendSettings(ctx) {
    const { text, kb } = settingsView(ctx.user);
    return reply(ctx, text, { reply_markup: kb });
  }
  bot.command('settings', sendSettings);
  bot.hears(MENU.settings, sendSettings);

  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

  bot.callbackQuery(/^set:(\w+)(?::(-?\d+))?$/, async (ctx) => {
    const u = ctx.user;
    const [, key, arg] = ctx.match;
    const patch = {};
    if (key === 'mode') patch.mode = cycle(Object.keys(MODE_NAMES), u.mode);
    else if (key === 'dir') patch.direction = cycle(Object.keys(DIR_NAMES), u.direction);
    else if (key === 'new') patch.new_per_day = Math.max(0, Math.min(500, u.new_per_day + Number(arg)));
    else if (key === 'remind') patch.remind = !u.remind;
    else if (key === 'tz') patch.tz_offset_min = Math.max(-720, Math.min(840, u.tz_offset_min + Number(arg)));
    else if (key === 'quiet') {
      const i = QUIET_PRESETS.findIndex(([a, b]) => a === u.quiet_start && b === u.quiet_end);
      const [a, b] = QUIET_PRESETS[(i + 1) % QUIET_PRESETS.length];
      patch.quiet_start = a;
      patch.quiet_end = b;
    }
    await ctx.answerCallbackQuery();
    if (!Object.keys(patch).length) return;
    await db.updateUser(u.id, patch);
    Object.assign(u, patch);
    const { text, kb } = settingsView(u);
    await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: kb });
  });

  bot.command('timezone', async (ctx) => {
    const off = parseOffset(ctx.match);
    if (off === null) return reply(ctx, 'Usage: <code>/timezone +5</code>, <code>/timezone -4</code> or <code>/timezone +5:30</code>');
    await db.updateUser(ctx.user.id, { tz_offset_min: off });
    await reply(ctx, `🌍 Time zone set to <b>${formatOffset(off)}</b>. Your time now: ${localTime(clock(), off)}`);
  });

  bot.callbackQuery('wipe', async (ctx) => {
    await ctx.answerCallbackQuery();
    await reply(ctx, '⚠️ Delete <b>all</b> your words and progress? This cannot be undone.', {
      reply_markup: new InlineKeyboard().text('Yes, delete everything', 'wipe:yes').text('Cancel', 'wipe:no'),
    });
  });
  bot.callbackQuery('wipe:yes', async (ctx) => {
    await db.deleteAllCards(ctx.user.id);
    await ctx.answerCallbackQuery({ text: 'Deleted' });
    await ctx.editMessageText('🗑 All words deleted.');
  });
  bot.callbackQuery('wipe:no', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('OK, nothing was deleted.');
  });

  // ---------- export / samples ----------
  bot.command('export', async (ctx) => {
    const cards = await db.allCards(ctx.user.id);
    if (!cards.length) return reply(ctx, 'You have no words to export yet.');
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['word', 'translation', 'example', 'status', 'step', 'next_review'].join(',')];
    for (const c of cards) {
      rows.push([c.word, c.translation, c.example, cardStatus(c, INTERVALS), c.stage, isNew(c) ? '' : new Date(c.due).toISOString()].map(q).join(','));
    }
    // BOM so Excel opens UTF-8 (Cyrillic etc.) correctly.
    const file = new InputFile(Buffer.from('﻿' + rows.join('\n'), 'utf8'), 'my-words.csv');
    await ctx.replyWithDocument(file, { caption: `📦 ${plural(cards.length, 'word')}` });
  });

  async function addSamples(ctx) {
    const added = await db.addCards(ctx.user.id, parseBulk(SAMPLE_WORDS), clock());
    await reply(ctx, `✨ Added ${plural(added, 'sample word')}. Let's start!`, {
      reply_markup: new InlineKeyboard().text('▶️ Start learning', 'review'),
    });
  }
  bot.command('sample', addSamples);
  bot.callbackQuery('sample', async (ctx) => {
    await ctx.answerCallbackQuery();
    await addSamples(ctx);
  });

  // ---------- free text: typed answers or new words ----------
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return reply(ctx, 'Unknown command. See /help');

    const pending = ctx.user.pending;
    if (pending?.card_id) {
      await setPending(ctx, null);
      const card = await db.getCard(ctx.user.id, pending.card_id);
      if (card && card.reps === pending.reps) {
        const expected = pending.rev ? card.word : card.translation;
        const g = gradeTypedAnswer(text, expected);
        const result = await applyGrade(ctx, card, g);
        if (result) {
          const verdict =
            g === GRADES.GOOD ? '✅ Correct!' : g === GRADES.HARD ? `😐 Almost! Correct spelling: <b>${esc(expected)}</b>` : `❌ Correct answer: <b>${esc(expected)}</b>`;
          await reply(ctx, `${verdict}\n\n${cardText(card, pending.rev)}\n\n<i>Next review in ${formatInterval(result.due - clock())}</i>`);
        }
        return sendNextCard(ctx);
      }
    }

    const items = parseBulk(text);
    if (!items.length) {
      return reply(
        ctx,
        `I didn't find any words. Use the format <code>word - translation</code>, one per line.\n\nExample:\n<code>apple - яблоко</code>`,
      );
    }
    if (items.length > MAX_IMPORT) return reply(ctx, `That's ${items.length} lines — please send at most ${MAX_IMPORT} at a time.`);
    const added = await db.addCards(ctx.user.id, items, clock());
    const skipped = items.length - added;
    let msg = added
      ? `✅ Added ${plural(added, 'word')}${added === 1 ? `: <b>${esc(items[0].word)}</b> — ${esc(items[0].translation)}` : ''}.`
      : '🤔 Nothing new added.';
    if (skipped) msg += `\n${plural(skipped, 'word')} you already have ${skipped === 1 ? 'was' : 'were'} skipped.`;
    await reply(ctx, msg, { reply_markup: added ? new InlineKeyboard().text('▶️ Start learning', 'review') : undefined });
  });

  // Any other callback (old buttons after a bot update, etc.)
  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery({ text: 'This button is no longer active.' }));

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError && /message is not modified/.test(e.description)) return;
    console.error(`Error while handling update ${err.ctx?.update?.update_id}:`, e);
  });

  return bot;
}
