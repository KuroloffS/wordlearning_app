// GENERATED from bot/src/bot.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
import { Bot, InlineKeyboard, Keyboard, InputFile, GrammyError } from 'grammy';
import {
  GRADES,
  DEFAULT_INTERVALS,
  schedule,
  previewIntervals,
  isNew,
  cardStatus,
  gradeTypedAnswer,
  normalizeAnswer,
  parseBulk,
} from './srs.js';
import { startOfLocalDay, localTime, formatOffset, parseOffset, streakFromDays } from './time.js';
import {
  t,
  tRaw,
  esc,
  LANGS,
  LEARN,
  LANG_NAMES,
  LANG_FLAGS,
  MENU,
  menuLabels,
  isMenuLabel,
  pickLang,
  pickLearn,
  fmtInterval,
  weekday,
} from './i18n.js';
import { samplesFor } from './samples.js';
import { mapLimit, langOf, stripArticle } from './translate.js';
import { withArticle } from './dictionary.js';

const INTERVALS = DEFAULT_INTERVALS;
const MAX_STAGE = INTERVALS.length;
const PAGE_SIZE = 20;
export const MAX_IMPORT = 500;
const MAX_AUTO_TRANSLATE = 20; // per message, to stay within the free API quotas
const MAX_SYNC_ENRICH = 3; // look up pronunciation right away for small additions; bigger batches are done in the background
const QUIET_PRESETS = [[23, 8], [22, 8], [0, 9], [21, 7], [0, 0]];
const GRADE_ICONS = ['❌', '😐', '✅', '🚀'];
const MODES = ['flip', 'choice', 'type'];
const DIRS = ['forward', 'reverse', 'mixed'];
const ID = '([0-9a-f-]{36})';

export function mainKeyboard(lang) {
  const m = MENU[lang] ?? MENU.ru;
  return new Keyboard().text(m.review).text(m.add).row().text(m.stats).text(m.list).text(m.settings).resized().persistent();
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const truncate = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
const pad2 = (n) => String(n).padStart(2, '0');
const lineOf = (c) => `${c.word} - ${c.translation}${c.example ? ` - ${c.example}` : ''}`;

/** A line the user sent that could be a word or short phrase to translate automatically. */
export function looksLikeWord(line) {
  return line.length <= 60 && line.split(/\s+/).length <= 6 && /\p{L}/u.test(line) && !/https?:\/\//i.test(line);
}

/** Typed answers: a German noun without (or with the wrong) article counts as "almost". */
export function gradeAnswer(input, expected) {
  const g = gradeTypedAnswer(input, expected);
  if (g !== GRADES.AGAIN) return g;
  const bare = (s) => normalizeAnswer(stripArticle(s));
  const variants = String(expected).split(/[,;/]/).map(bare).filter(Boolean);
  return variants.includes(bare(input)) ? GRADES.HARD : g;
}

/** Puts a manual "word - translation" pair the right way round: the word is in the language being learned. */
export function orient(item, learn) {
  if (langOf(item.word) !== learn && langOf(item.translation) === learn) return { ...item, word: item.translation, translation: item.word };
  return item;
}

/**
 * Builds the bot. `db` is db/supabase.js or db/memory.js.
 * @param {string} token
 * @param {any} db
 * @param {{
 *   clock?: () => number,
 *   botInfo?: any,
 *   random?: () => number,
 *   translator?: ((text: string, to: string, from?: string) => Promise<string | null>) | null,
 *   dictionary?: ((text: string, lang?: string) => Promise<any>) | null,
 *   fetchAudio?: ((url: string) => Promise<Uint8Array>) | null,
 *   onError?: (err: any) => void,
 * }} [options]
 */
export function createBot(
  token,
  db,
  { clock = Date.now, botInfo, random = Math.random, translator = null, dictionary = null, fetchAudio = null, onError } = {},
) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);

  const T = (ctx, key, ...a) => t(ctx.lang, key, ...a);
  const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  const reply = (ctx, text, extra = {}) => ctx.reply(text, { ...HTML, ...extra });
  const learnOf = (ctx) => (ctx.user.learn === 'ru' ? 'ru' : 'de');

  /** Edits the message with the pressed button; if Telegram refuses (e.g. too old), sends a new one. */
  async function safeEdit(ctx, text, extra = {}) {
    try {
      await ctx.editMessageText(text, { ...HTML, ...extra });
    } catch (e) {
      if (e instanceof GrammyError && /not modified/i.test(e.description)) return;
      if (e instanceof GrammyError) return reply(ctx, text, extra);
      throw e;
    }
  }

  // ---------- load the user on every update ----------
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.from.is_bot) return;
    if (ctx.chat && ctx.chat.type !== 'private') {
      if (ctx.message?.text?.startsWith('/start')) await ctx.reply(t(pickLang(ctx.from.language_code), 'private_only'));
      return;
    }
    const lang = pickLang(ctx.from.language_code);
    ctx.user = await db.touchUser(ctx.from, clock(), { lang, learn: pickLearn(lang), tz_offset_min: lang === 'de' ? 60 : 300 });
    ctx.lang = LANGS.includes(ctx.user.lang) ? ctx.user.lang : 'ru';
    // Leaving a question (typed answer / edit) by pressing a menu button or sending a command cancels it.
    const text = ctx.message?.text;
    if (ctx.user.pending && text && (text.startsWith('/') || isMenuLabel(text))) await setPending(ctx, null);
    await next();
  });

  async function setPending(ctx, pending) {
    ctx.user.pending = pending;
    await db.updateUser(ctx.user.id, { pending });
  }

  // ---------- card rendering ----------
  const wordLine = (c) => `<b>${esc(c.word)}</b>${c.phonetic ? ` <i>${esc(c.phonetic)}</i>` : ''}`;
  const front = (c, rev) => (rev ? `<b>${esc(c.translation)}</b>` : wordLine(c));
  function cardText(c, rev) {
    let s = `${front(c, rev)}\n${rev ? wordLine(c) : esc(c.translation)}`;
    if (c.example) s += `\n\n<i>${esc(c.example)}</i>`;
    return s;
  }
  const audioKb = (c) => (c.audio_url ? new InlineKeyboard().text('🔊', `p:${c.id}`) : undefined);

  // ---------- dictionary helpers ----------
  /** Dictionary entry, null when the word isn't in the dictionary, undefined when the lookup failed (retry later). */
  const look = (text, lang) =>
    dictionary
      ? dictionary(text, lang).catch((e) => {
          console.warn('Dictionary lookup failed:', e.message);
          return undefined;
        })
      : Promise.resolve(null);
  const machine = (text, to, from) =>
    translator
      ? translator(text, to, from).catch((e) => {
          console.warn('Translation failed:', e.message);
          return null;
        })
      : Promise.resolve(null);

  /** Builds a card from a single German or Russian word: translation, article, IPA and audio. */
  async function autoCard(text, learn) {
    let de = '';
    let ru = '';
    let deEntry = null;
    let ruEntry = null;
    let ruLooked = false;
    if (langOf(text) === 'de') {
      deEntry = await look(text, 'de');
      de = deEntry?.headword || text.trim();
      ru = deEntry?.translations?.slice(0, 2).join(', ') || (await machine(stripArticle(text), 'ru', 'de')) || '';
    } else {
      ruEntry = await look(text, 'ru');
      ruLooked = true;
      ru = ruEntry?.lemma || text.trim().toLowerCase();
      const deWord = ruEntry?.translations?.[0] || (await machine(text, 'de', 'ru')) || '';
      if (deWord) {
        deEntry = await look(deWord, 'de');
        de = deEntry?.headword || deWord;
      }
    }
    if (!de || !ru || de.toLowerCase() === ru.toLowerCase()) return null;
    if (learn === 'ru') {
      if (!ruLooked) ruEntry = await look(ru.split(',')[0].trim(), 'ru');
      return { word: ru, translation: de, example: '', phonetic: ruEntry?.ipa ?? '', audio_url: ruEntry?.audio_url ?? '', enriched: ruEntry !== undefined };
    }
    return { word: de, translation: ru, example: '', phonetic: deEntry?.ipa ?? '', audio_url: deEntry?.audio_url ?? '', enriched: deEntry !== undefined };
  }

  /** Adds article/IPA/audio to manual items (mutates). Failed lookups leave enriched=false so the background job retries. */
  async function enrichItems(items) {
    await mapLimit(items, 3, async (it) => {
      if (!dictionary) return;
      const e = await look(it.word, langOf(it.word));
      if (e === undefined) return;
      Object.assign(it, { word: withArticle(it.word, e), phonetic: e?.ipa ?? '', audio_url: e?.audio_url ?? '', enriched: true });
    });
  }

  async function enrichCard(card) {
    const it = { word: card.word };
    await enrichItems([it]);
    if (!it.enriched) return null;
    const patch = { phonetic: it.phonetic, audio_url: it.audio_url, ...(it.word !== card.word ? { word: it.word } : {}) };
    await db.saveEnrichment(card.id, patch);
    return db.getCard(card.user_id, card.id);
  }

  // ---------- start / help ----------
  bot.command('start', async (ctx) => {
    await reply(ctx, `${T(ctx, 'greet', ctx.from.first_name || '🙂')}\n\n${T(ctx, 'help')}`, { reply_markup: mainKeyboard(ctx.lang) });
    const { total } = await db.listCards(ctx.user.id, { limit: 1 });
    if (total === 0) {
      await reply(ctx, T(ctx, 'first_words'), { reply_markup: new InlineKeyboard().text(T(ctx, 'btn_samples'), 'sample') });
    }
  });

  bot.command('help', (ctx) => reply(ctx, T(ctx, 'help'), { reply_markup: mainKeyboard(ctx.lang) }));
  bot.command('cancel', (ctx) => reply(ctx, T(ctx, 'cancelled'), { reply_markup: mainKeyboard(ctx.lang) }));

  const addHelp = (ctx) => reply(ctx, T(ctx, 'add_help', MAX_IMPORT));
  bot.command('add', addHelp);
  bot.hears(menuLabels('add'), addHelp);

  // ---------- sample words ----------
  async function addSamples(ctx) {
    const added = await db.addCards(ctx.user.id, samplesFor(learnOf(ctx)), clock());
    return reply(ctx, T(ctx, 'samples_added', added.length), {
      reply_markup: new InlineKeyboard().text(T(ctx, 'btn_start_learning'), 'review'),
    });
  }
  bot.command('sample', addSamples);
  bot.callbackQuery('sample', async (ctx) => {
    await ctx.answerCallbackQuery();
    await addSamples(ctx);
  });

  // ---------- review ----------
  const startReview = (ctx) => sendNextCard(ctx);
  bot.command('review', startReview);
  bot.hears(menuLabels('review'), startReview);
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
      return reply(ctx, await doneText(ctx, now, newLeft), { reply_markup: mainKeyboard(ctx.lang) });
    }

    const rev = pickReverse(user);
    const dueCount = await db.countDue(user.id, now);
    const left = dueCount + (isNew(card) ? Math.min(newLeft, await db.countNew(user.id)) : 0);
    const prompt = `${T(ctx, isNew(card) ? 'head_new' : 'head_review')} · ${T(ctx, 'left', left)}\n\n${front(card, rev)}`;
    const kb = new InlineKeyboard();
    const sound = () => {
      // In "translation → word" direction the sound would give the answer away.
      if (card.audio_url && !rev) kb.text('🔊', `p:${card.id}`);
    };

    let mode = MODES.includes(user.mode) ? user.mode : 'flip';
    let options;
    if (mode === 'choice') {
      const field = rev ? 'word' : 'translation';
      const correct = card[field];
      const others = [...new Set(await db.recentAnswers(user.id, card.id, field))].filter((a) => a !== correct);
      if (others.length < 2) mode = 'flip';
      else options = shuffle([correct, ...shuffle(others, random).slice(0, 3)], random);
    }
    // A question left over from typing mode (or an unfinished edit) must not swallow the next message.
    if (mode !== 'type' && user.pending) await setPending(ctx, null);

    if (mode === 'choice') {
      const correctIdx = options.indexOf(rev ? card.word : card.translation);
      options.forEach((o, i) => kb.text(truncate(o, 60), `c:${card.id}:${card.reps}:${+rev}:${i}:${correctIdx}`).row());
      kb.text(T(ctx, 'btn_dont_know'), `k:${card.id}:${card.reps}:${+rev}`);
      sound();
      return reply(ctx, `${prompt}\n\n${T(ctx, rev ? 'choose_word' : 'choose_translation')}`, { reply_markup: kb });
    }

    if (mode === 'type') {
      await setPending(ctx, { type: 'answer', card_id: card.id, reps: card.reps, rev });
      kb.text(T(ctx, 'btn_dont_know'), `k:${card.id}:${card.reps}:${+rev}`);
      sound();
      return reply(ctx, `${prompt}\n\n${T(ctx, rev ? 'type_word' : 'type_translation')}`, { reply_markup: kb });
    }

    kb.text(T(ctx, 'btn_show'), `s:${card.id}:${card.reps}:${+rev}`);
    sound();
    return reply(ctx, prompt, { reply_markup: kb });
  }

  async function doneText(ctx, now, newLeft) {
    const user = ctx.user;
    const [nextDue, newCount] = await Promise.all([db.nextDueAt(user.id, now), db.countNew(user.id)]);
    if (!nextDue && newCount === 0) return T(ctx, 'no_words_yet');
    const lines = [T(ctx, 'all_done')];
    if (newCount > 0 && newLeft === 0) lines.push(T(ctx, 'limit_reached', user.new_per_day, newCount, MENU[ctx.lang].settings));
    if (nextDue) lines.push(T(ctx, 'next_review_in', fmtInterval(ctx.lang, nextDue - now)));
    return lines.join('\n\n');
  }

  /** Loads the card from callback data and checks that the button is not stale. */
  async function cardFromCallback(ctx, id, reps) {
    const card = await db.getCard(ctx.user.id, id);
    if (!card) {
      await ctx.answerCallbackQuery({ text: T(ctx, 'word_deleted') });
      return null;
    }
    if (card.reps !== Number(reps)) {
      await ctx.answerCallbackQuery({ text: T(ctx, 'already_answered') });
      return null;
    }
    return card;
  }

  /** Saves a review; returns the updated card plus the exact `interval` until the next review, or null if it was already answered. */
  async function applyGrade(card, grade) {
    const now = clock();
    const updated = { ...schedule(card, grade, now, INTERVALS), last_reviewed: now };
    const saved = await db.saveReview(updated, card.reps, grade, isNew(card), now);
    return saved ? { ...updated, interval: updated.due - now } : null;
  }

  const resultLine = (ctx, g, interval) => `${GRADE_ICONS[g]} ${T(ctx, `grade_${g}`)} · ${T(ctx, 'next_in', fmtInterval(ctx.lang, interval))}`;

  // Show answer (flashcards)
  bot.callbackQuery(new RegExp(`^s:${ID}:(\\d+):([01])$`), async (ctx) => {
    const [, id, reps, rev] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    await ctx.answerCallbackQuery();
    const previews = previewIntervals(card, INTERVALS);
    const kb = new InlineKeyboard();
    [GRADES.AGAIN, GRADES.HARD, GRADES.GOOD, GRADES.EASY].forEach((g, i) => {
      kb.text(`${GRADE_ICONS[g]} ${T(ctx, `grade_${g}`)} · ${fmtInterval(ctx.lang, previews[g])}`, `g:${card.id}:${card.reps}:${rev}:${g}`);
      if (i % 2 === 1) kb.row();
    });
    if (card.audio_url) kb.text('🔊', `p:${card.id}`);
    await safeEdit(ctx, `${isNew(card) ? '🆕' : '🔁'} ${cardText(card, rev === '1')}\n\n${T(ctx, 'how_well')}`, { reply_markup: kb });
  });

  // Grade (flashcards)
  bot.callbackQuery(new RegExp(`^g:${ID}:(\\d+):([01]):([0-3])$`), async (ctx) => {
    const [, id, reps, rev, g] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    await ctx.answerCallbackQuery();
    const result = await applyGrade(card, Number(g));
    if (!result) return;
    await safeEdit(ctx, `${cardText(card, rev === '1')}\n\n${resultLine(ctx, Number(g), result.interval)}`, { reply_markup: audioKb(card) });
    await sendNextCard(ctx);
  });

  // Multiple choice answer
  bot.callbackQuery(new RegExp(`^c:${ID}:(\\d+):([01]):(\\d):(\\d)$`), async (ctx) => {
    const [, id, reps, rev, chosen, correct] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    const ok = chosen === correct;
    await ctx.answerCallbackQuery({ text: T(ctx, ok ? 'correct_toast' : 'wrong_toast') });
    const g = ok ? GRADES.GOOD : GRADES.AGAIN;
    const result = await applyGrade(card, g);
    if (!result) return;
    const picked = ctx.callbackQuery.message?.reply_markup?.inline_keyboard?.[Number(chosen)]?.[0]?.text ?? '?';
    const verdict = ok ? T(ctx, 'verdict_correct') : T(ctx, 'verdict_chose', picked);
    await safeEdit(ctx, `${cardText(card, rev === '1')}\n\n${verdict} · ${T(ctx, 'next_in', fmtInterval(ctx.lang, result.interval))}`, {
      reply_markup: audioKb(card),
    });
    await sendNextCard(ctx);
  });

  // "Don't know" (choice / typing)
  bot.callbackQuery(new RegExp(`^k:${ID}:(\\d+):([01])$`), async (ctx) => {
    const [, id, reps, rev] = ctx.match;
    const card = await cardFromCallback(ctx, id, reps);
    if (!card) return;
    await ctx.answerCallbackQuery();
    if (ctx.user.pending) await setPending(ctx, null);
    const result = await applyGrade(card, GRADES.AGAIN);
    if (!result) return;
    await safeEdit(ctx, `${cardText(card, rev === '1')}\n\n${T(ctx, 'ask_again')}`, { reply_markup: audioKb(card) });
    await sendNextCard(ctx);
  });

  // Pronunciation: reuse Telegram's copy if we have one, otherwise download the recording and upload it.
  bot.callbackQuery(new RegExp(`^p:${ID}$`), async (ctx) => {
    const card = await db.getCard(ctx.user.id, ctx.match[1]);
    if (!card?.audio_url) return ctx.answerCallbackQuery({ text: T(ctx, 'no_audio') });
    await ctx.answerCallbackQuery();
    if (card.audio_file_id) {
      try {
        await ctx.replyWithVoice(card.audio_file_id);
        return;
      } catch {
        // stale file id: upload again below
      }
    }
    try {
      const bytes = fetchAudio ? await fetchAudio(card.audio_url) : null;
      const file = bytes ? new InputFile(bytes, 'pronunciation.mp3') : card.audio_url;
      try {
        const msg = await ctx.replyWithVoice(file);
        const fileId = msg?.voice?.file_id;
        if (fileId) await db.saveAudioFileId(card.id, fileId);
      } catch {
        await ctx.replyWithAudio(bytes ? new InputFile(bytes, `${card.word}.mp3`) : card.audio_url, { title: card.word });
      }
    } catch (e) {
      console.warn('Pronunciation failed:', e.description ?? e.message);
      await reply(ctx, T(ctx, 'no_audio'));
    }
  });

  // ---------- word list / find / edit / delete ----------
  async function sendList(ctx, page, edit = false) {
    const { cards, total } = await db.listCards(ctx.user.id, { offset: page * PAGE_SIZE, limit: PAGE_SIZE });
    if (total === 0) return reply(ctx, T(ctx, 'list_empty'));
    const pages = Math.ceil(total / PAGE_SIZE);
    const now = clock();
    const icon = { new: '🆕', learning: '📖', known: '✅', mastered: '🏆' };
    const lines = cards.map((c) => {
      const s = cardStatus(c, INTERVALS);
      const when = isNew(c) ? '' : c.due <= now ? ` · <b>${T(ctx, 'due_mark')}</b>` : ` · ${fmtInterval(ctx.lang, c.due - now)}`;
      return `${icon[s]} <b>${esc(truncate(c.word, 40))}</b> — ${esc(truncate(c.translation, 60))}${when ? `<i>${when}</i>` : ''}`;
    });
    const text = `${T(ctx, 'list_head', total, page + 1, pages)}\n\n${lines.join('\n')}\n\n${T(ctx, 'list_legend')}`;
    const kb = new InlineKeyboard();
    if (page > 0) kb.text(T(ctx, 'btn_prev'), `l:${page - 1}`);
    if (page < pages - 1) kb.text(T(ctx, 'btn_next'), `l:${page + 1}`);
    return edit ? safeEdit(ctx, text, { reply_markup: kb }) : reply(ctx, text, { reply_markup: kb });
  }
  bot.command('list', (ctx) => sendList(ctx, 0));
  bot.hears(menuLabels('list'), (ctx) => sendList(ctx, 0));
  bot.callbackQuery(/^l:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendList(ctx, Number(ctx.match[1]), true);
  });

  function cardButtons(ctx, c) {
    const kb = new InlineKeyboard().text(T(ctx, 'btn_edit'), `e:${c.id}`).text(T(ctx, 'btn_reset'), `z:${c.id}`).text(T(ctx, 'btn_delete'), `d:${c.id}`);
    if (c.audio_url) kb.row().text('🔊', `p:${c.id}`);
    return kb;
  }

  function cardState(ctx, c) {
    const now = clock();
    const when = isNew(c) ? T(ctx, 'when_new') : c.due <= now ? T(ctx, 'when_due') : T(ctx, 'when_next', fmtInterval(ctx.lang, c.due - now));
    return T(ctx, 'card_state', T(ctx, `status_${cardStatus(c, INTERVALS)}`), c.stage, MAX_STAGE, when);
  }

  bot.command('find', async (ctx) => {
    const q = ctx.match.trim();
    if (!q) return reply(ctx, T(ctx, 'find_usage'));
    const { cards, total } = await db.listCards(ctx.user.id, { search: q, limit: 5 });
    if (!total) return reply(ctx, T(ctx, 'find_none', q));
    for (const c of cards) {
      await reply(ctx, `${cardText(c, false)}\n\n<i>${cardState(ctx, c)}</i>`, { reply_markup: cardButtons(ctx, c) });
    }
    if (total > cards.length) await reply(ctx, T(ctx, 'find_more', total - cards.length));
  });

  bot.callbackQuery(new RegExp(`^d:${ID}$`), async (ctx) => {
    const ok = await db.deleteCard(ctx.user.id, ctx.match[1]);
    await ctx.answerCallbackQuery({ text: T(ctx, ok ? 'deleted_toast' : 'already_deleted') });
    if (ok) await safeEdit(ctx, T(ctx, 'deleted_msg'));
  });

  bot.callbackQuery(new RegExp(`^z:${ID}$`), async (ctx) => {
    const ok = await db.resetCard(ctx.user.id, ctx.match[1], clock());
    await ctx.answerCallbackQuery({ text: T(ctx, ok ? 'reset_toast' : 'not_found_toast') });
    if (!ok) return;
    const card = await db.getCard(ctx.user.id, ctx.match[1]);
    if (card) await safeEdit(ctx, `${cardText(card, false)}\n\n<i>${cardState(ctx, card)}</i>`, { reply_markup: cardButtons(ctx, card) });
  });

  bot.callbackQuery(new RegExp(`^e:${ID}$`), async (ctx) => {
    const card = await db.getCard(ctx.user.id, ctx.match[1]);
    if (!card) return ctx.answerCallbackQuery({ text: T(ctx, 'not_found_toast') });
    await ctx.answerCallbackQuery();
    await setPending(ctx, { type: 'edit', card_id: card.id });
    await reply(ctx, T(ctx, 'edit_prompt', lineOf(card)));
  });

  async function handleEdit(ctx, pending, text) {
    const [parsed] = parseBulk(text.split(/\r?\n/)[0]);
    if (!parsed) return reply(ctx, T(ctx, 'edit_bad'));
    const item = orient(parsed, learnOf(ctx));
    const res = await db.updateCardText(ctx.user.id, pending.card_id, item);
    if (res === 'duplicate') return reply(ctx, T(ctx, 'edit_duplicate', item.word));
    await setPending(ctx, null);
    if (res === 'missing') return reply(ctx, T(ctx, 'word_deleted'));
    let card = await db.getCard(ctx.user.id, pending.card_id);
    if (card && !card.enriched) card = (await enrichCard(card)) ?? card;
    return reply(ctx, `${T(ctx, 'edit_saved')}\n\n${cardText(card, false)}`, { reply_markup: cardButtons(ctx, card) });
  }

  // ---------- stats ----------
  async function sendStats(ctx) {
    const u = ctx.user;
    const now = clock();
    const s = await db.stats(u.id, now, u.tz_offset_min, MAX_STAGE);
    if (!s.total) return reply(ctx, T(ctx, 'stats_empty'));
    const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
    const max = Math.max(1, ...s.forecast);
    const label = (n) => (n === 0 ? T(ctx, 'today') : weekday(ctx.lang, new Date(now + u.tz_offset_min * 60000 + n * 86400000).getUTCDay()));
    const width = Math.max(...s.forecast.map((_, n) => label(n).length));
    const bars = s.forecast
      .map((v, n) => `<code>${esc(label(n).padEnd(width))} ${'▇'.repeat(Math.round((v / max) * 10)).padEnd(10, ' ')} ${v}</code>`)
      .join('\n');
    const text = tRaw(ctx.lang, 'stats', {
      total: s.total,
      new: s.new,
      learning: s.learning,
      known: s.known,
      mastered: s.mastered,
      due: s.due,
      reviews_today: s.reviews_today,
      pct_today: pct(s.correct_today, s.reviews_today),
      new_today: s.new_today,
      streak: streakFromDays(s.days, now, u.tz_offset_min),
      accuracy: pct(s.correct_total, s.reviews_total),
      bars,
    });
    return reply(ctx, text, { reply_markup: s.due ? new InlineKeyboard().text(T(ctx, 'btn_review_now'), 'review') : undefined });
  }
  bot.command('stats', sendStats);
  bot.hears(menuLabels('stats'), sendStats);

  // ---------- settings ----------
  function settingsView(ctx) {
    const u = ctx.user;
    const L = ctx.lang;
    const quiet = u.quiet_start === u.quiet_end ? t(L, 'off') : `${pad2(u.quiet_start)}:00–${pad2(u.quiet_end)}:00`;
    const mode = t(L, `mode_${MODES.includes(u.mode) ? u.mode : 'flip'}`);
    const dir = t(L, `dir_${DIRS.includes(u.direction) ? u.direction : 'forward'}`);
    const learn = t(L, `learn_${learnOf(ctx)}`);
    const text = tRaw(L, 'settings', {
      learn,
      mode,
      dir,
      perDay: u.new_per_day,
      remind: t(L, u.remind ? 'on' : 'off'),
      quiet,
      tz: formatOffset(u.tz_offset_min),
      time: localTime(clock(), u.tz_offset_min),
      translate: t(L, u.auto_translate ? 'on' : 'off'),
      lang: LANG_NAMES[L],
    });
    const kb = new InlineKeyboard()
      .text(`🎓 ${learn}`, 'set:learn')
      .text(t(L, u.auto_translate ? 'btn_translate_on' : 'btn_translate_off'), 'set:tr')
      .row()
      .text(`🎴 ${mode}`, 'set:mode')
      .text(`🔀 ${dir}`, 'set:dir')
      .row()
      .text('➖5', 'set:new:-5')
      .text(`🆕 ${t(L, 'per_day', u.new_per_day)}`, 'set:noop')
      .text('➕5', 'set:new:5')
      .row()
      .text(t(L, u.remind ? 'btn_reminders_on' : 'btn_reminders_off'), 'set:remind')
      .text(t(L, 'btn_quiet', quiet), 'set:quiet')
      .row()
      .text('➖1h', 'set:tz:-60')
      .text(`🌍 ${formatOffset(u.tz_offset_min)}`, 'set:noop')
      .text('➕1h', 'set:tz:60')
      .row()
      .text(`🌐 ${LANG_FLAGS[L]} ${LANG_NAMES[L]}`, 'set:lang')
      .row()
      .text(t(L, 'btn_wipe'), 'wipe');
    return { text, kb };
  }

  async function sendSettings(ctx) {
    const { text, kb } = settingsView(ctx);
    return reply(ctx, text, { reply_markup: kb });
  }
  async function showSettings(ctx) {
    const { text, kb } = settingsView(ctx);
    return safeEdit(ctx, text, { reply_markup: kb });
  }
  bot.command('settings', sendSettings);
  bot.hears(menuLabels('settings'), sendSettings);

  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

  bot.callbackQuery(/^set:(learn|tr|mode|dir|new|remind|tz|quiet|noop)(?::(-?\d+))?$/, async (ctx) => {
    const u = ctx.user;
    const [, key, arg] = ctx.match;
    const patch = {};
    if (key === 'learn') patch.learn = cycle(LEARN, learnOf(ctx));
    else if (key === 'tr') patch.auto_translate = !u.auto_translate;
    else if (key === 'mode') patch.mode = cycle(MODES, u.mode);
    else if (key === 'dir') patch.direction = cycle(DIRS, u.direction);
    else if (key === 'new') patch.new_per_day = Math.max(0, Math.min(500, u.new_per_day + Number(arg)));
    else if (key === 'remind') patch.remind = !u.remind;
    else if (key === 'tz') patch.tz_offset_min = Math.max(-720, Math.min(840, u.tz_offset_min + Number(arg)));
    else if (key === 'quiet') {
      const i = QUIET_PRESETS.findIndex(([a, b]) => a === u.quiet_start && b === u.quiet_end);
      [patch.quiet_start, patch.quiet_end] = QUIET_PRESETS[(i + 1) % QUIET_PRESETS.length];
    }
    await ctx.answerCallbackQuery();
    if (!Object.keys(patch).length) return;
    await db.updateUser(u.id, patch);
    Object.assign(u, patch);
    await showSettings(ctx);
  });

  bot.callbackQuery('set:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showSettings(ctx);
  });

  bot.callbackQuery('set:lang', async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard();
    for (const l of LANGS) kb.text(`${l === ctx.lang ? '✓ ' : ''}${LANG_FLAGS[l]} ${LANG_NAMES[l]}`, `lang:${l}`).row();
    kb.text(T(ctx, 'btn_back'), 'set:back');
    await safeEdit(ctx, T(ctx, 'choose_lang'), { reply_markup: kb });
  });

  bot.callbackQuery(/^lang:(ru|de)$/, async (ctx) => {
    const lang = ctx.match[1];
    await db.updateUser(ctx.user.id, { lang });
    ctx.user.lang = lang;
    ctx.lang = lang;
    await ctx.answerCallbackQuery();
    await showSettings(ctx);
    await reply(ctx, T(ctx, 'lang_set'), { reply_markup: mainKeyboard(lang) });
  });

  bot.command('timezone', async (ctx) => {
    const off = parseOffset(ctx.match);
    if (off === null) return reply(ctx, T(ctx, 'tz_usage'));
    await db.updateUser(ctx.user.id, { tz_offset_min: off });
    await reply(ctx, T(ctx, 'tz_set', formatOffset(off), localTime(clock(), off)));
  });

  bot.callbackQuery('wipe', async (ctx) => {
    await ctx.answerCallbackQuery();
    await reply(ctx, T(ctx, 'wipe_confirm'), {
      reply_markup: new InlineKeyboard().text(T(ctx, 'btn_wipe_yes'), 'wipe:yes').text(T(ctx, 'btn_cancel'), 'wipe:no'),
    });
  });
  bot.callbackQuery('wipe:yes', async (ctx) => {
    await db.deleteAllCards(ctx.user.id);
    await ctx.answerCallbackQuery({ text: T(ctx, 'deleted_toast') });
    await safeEdit(ctx, T(ctx, 'wiped'));
  });
  bot.callbackQuery('wipe:no', async (ctx) => {
    await ctx.answerCallbackQuery();
    await safeEdit(ctx, T(ctx, 'wipe_cancelled'));
  });

  // ---------- export ----------
  bot.command('export', async (ctx) => {
    const cards = await db.allCards(ctx.user.id);
    if (!cards.length) return reply(ctx, T(ctx, 'export_none'));
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['word', 'translation', 'example', 'transcription', 'status', 'step', 'next_review'].join(',')];
    for (const c of cards) {
      rows.push(
        [c.word, c.translation, c.example, c.phonetic, cardStatus(c, INTERVALS), c.stage, isNew(c) ? '' : new Date(c.due).toISOString()]
          .map(q)
          .join(','),
      );
    }
    // The BOM makes Excel open UTF-8 (Cyrillic, umlauts) correctly.
    const bytes = new TextEncoder().encode('﻿' + rows.join('\n'));
    await ctx.replyWithDocument(new InputFile(bytes, 'my-words.csv'), { caption: T(ctx, 'export_caption', cards.length) });
  });

  // ---------- free text: typed answers, edits, new words ----------
  async function handleTypedAnswer(ctx, pending, text) {
    await setPending(ctx, null);
    const card = await db.getCard(ctx.user.id, pending.card_id);
    if (card && card.reps === pending.reps) {
      const expected = pending.rev ? card.word : card.translation;
      const g = gradeAnswer(text, expected);
      const result = await applyGrade(card, g);
      if (result) {
        const verdict = g === GRADES.GOOD ? T(ctx, 'typed_correct') : g === GRADES.HARD ? T(ctx, 'typed_almost', expected) : T(ctx, 'typed_wrong', expected);
        const next = T(ctx, 'next_review_short', fmtInterval(ctx.lang, result.interval));
        await reply(ctx, `${verdict}\n\n${cardText(card, pending.rev)}\n\n<i>${next}</i>`, { reply_markup: audioKb(card) });
      }
    }
    return sendNextCard(ctx);
  }

  async function addWordsFromText(ctx, text) {
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'));
    if (lines.length > MAX_IMPORT) return reply(ctx, T(ctx, 'too_many', lines.length, MAX_IMPORT));

    const learn = learnOf(ctx);
    const items = [];
    const bare = [];
    for (const line of lines) {
      const [item] = parseBulk(line);
      if (item) items.push(orient(item, learn));
      else if (looksLikeWord(line)) bare.push(line);
    }
    if (!items.length && !bare.length) return reply(ctx, T(ctx, 'nothing_parsed'));

    const auto = [];
    const failed = [];
    let hint = false;
    if (bare.length) {
      if (!ctx.user.auto_translate || (!dictionary && !translator)) hint = true;
      else {
        const todo = bare.slice(0, MAX_AUTO_TRANSLATE);
        failed.push(...bare.slice(MAX_AUTO_TRANSLATE));
        const results = await mapLimit(todo, 3, (w) => autoCard(w, learn));
        results.forEach((r, i) => (r ? auto.push(r) : failed.push(todo[i])));
      }
    }
    const failedText = failed.length > 10 ? `${failed.slice(0, 10).join(', ')}, …` : failed.join(', ');
    if (!items.length && !auto.length) {
      return reply(ctx, hint ? T(ctx, 'translate_off_hint') : T(ctx, 'not_translated', failedText));
    }

    if (items.length <= MAX_SYNC_ENRICH) await enrichItems(items);
    const all = [...items, ...auto];
    const added = await db.addCards(ctx.user.id, all, clock());
    const autoWords = new Set(auto.map((a) => a.word.toLowerCase()));
    const isAuto = (c) => autoWords.has(c.word.toLowerCase());

    let msg;
    let kb;
    if (added.length === 1) {
      const c = added[0];
      msg = tRaw(ctx.lang, 'added_one', wordLine(c), esc(c.translation));
      if (isAuto(c)) msg += `\n${T(ctx, 'auto_note')}`;
      kb = new InlineKeyboard().text(T(ctx, 'btn_edit'), `e:${c.id}`).text(T(ctx, 'btn_delete'), `d:${c.id}`);
      if (c.audio_url) kb.text('🔊', `p:${c.id}`);
      kb.row().text(T(ctx, 'btn_start_learning'), 'review');
    } else if (added.length > 1) {
      const shown = added.slice(0, 15).map((c) => `• ${wordLine({ ...c, word: truncate(c.word, 40) })} — ${esc(truncate(c.translation, 60))}`);
      if (added.length > 15) shown.push('…');
      msg = `${T(ctx, 'added_n', added.length)}\n\n${shown.join('\n')}`;
      if (added.some(isAuto)) msg += `\n\n${T(ctx, 'auto_note_many')}`;
      kb = new InlineKeyboard().text(T(ctx, 'btn_start_learning'), 'review');
    } else {
      msg = T(ctx, 'nothing_new');
    }
    const skipped = all.length - added.length;
    if (skipped > 0) msg += `\n${T(ctx, 'skipped_dups', skipped)}`;
    if (failed.length) msg += `\n\n${T(ctx, 'not_translated', failedText)}`;
    if (hint) msg += `\n\n${T(ctx, 'translate_off_hint')}`;
    return reply(ctx, msg, { reply_markup: kb });
  }

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return reply(ctx, T(ctx, 'unknown_cmd'));
    const pending = ctx.user.pending;
    if (pending?.type === 'answer') return handleTypedAnswer(ctx, pending, text);
    if (pending?.type === 'edit') return handleEdit(ctx, pending, text);
    return addWordsFromText(ctx, text);
  });

  // Photos, stickers, voice messages…: explain what the bot understands.
  bot.on('message', (ctx) => reply(ctx, T(ctx, 'nothing_parsed')));

  // Any other button (e.g. from an old message after an update).
  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery({ text: T(ctx, 'inactive_btn') }));

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError && /message is not modified/.test(e.description)) return;
    if (onError) onError(err);
    else console.error(`Error while handling update ${err.ctx?.update?.update_id}:`, e);
  });

  return bot;
}
