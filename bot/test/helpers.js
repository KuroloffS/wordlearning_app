// Test harness: the real bot with an in-memory database and a fake Telegram API.
import { createBot } from '../src/bot.js';
import { createMemoryDb } from '../src/db/memory.js';

export const BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'WL',
  username: 'wl_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

export const USERS = {
  en: { id: 111, is_bot: false, first_name: 'Ali', username: 'ali', language_code: 'en' },
  uz: { id: 222, is_bot: false, first_name: 'Sardor', language_code: 'uz' },
  ru: { id: 333, is_bot: false, first_name: 'Ольга', language_code: 'ru' },
};

export const AUDIO = 'https://api.dictionaryapi.dev/media/pronunciations/en/apple-us.mp3';

const TRANSLATIONS = {
  'apple|uz': 'olma',
  'weather|uz': 'ob-havo',
  'reliable|uz': 'ishonchli',
  'kitob|en': 'book',
  'apple|ru': 'яблоко',
};

export function fakeTranslator(calls = []) {
  return async (text, to) => {
    calls.push(`${text}|${to}`);
    if (text === 'boom') throw new Error('network down');
    return TRANSLATIONS[`${text.toLowerCase()}|${to}`] ?? null;
  };
}

export function fakeDictionary(calls = []) {
  return async (word) => {
    calls.push(word);
    if (word === 'flaky') throw new Error('HTTP 503');
    if (word === 'apple') return { phonetic: '/ˈæp.əl/', audio_url: AUDIO };
    if (word === 'weather') return { phonetic: '/ˈwɛðə/', audio_url: '' };
    return null;
  };
}

export function harness({ start = Date.UTC(2026, 0, 5, 9, 0), user = USERS.en, failMethods = [], translator, dictionary } = {}) {
  const clock = { now: start };
  const db = createMemoryDb();
  const translatorCalls = [];
  const dictionaryCalls = [];
  const bot = createBot('TEST:TOKEN', db, {
    clock: () => clock.now,
    botInfo: BOT_INFO,
    random: () => 0.9,
    translator: translator === undefined ? fakeTranslator(translatorCalls) : translator,
    dictionary: dictionary === undefined ? fakeDictionary(dictionaryCalls) : dictionary,
    onError: (err) => {
      throw err.error;
    },
  });
  const calls = [];
  let msgId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (failMethods.includes(method)) return { ok: false, error_code: 400, description: `Bad Request: ${method} failed` };
    const result = method.startsWith('send')
      ? { message_id: ++msgId, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text }
      : true;
    return { ok: true, result };
  });
  let updateId = 0;
  let from = user;
  const chat = () => ({ id: from.id, type: 'private', first_name: from.first_name });
  const send = async (text, opts = {}) => {
    const entities = text.startsWith('/') ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] : undefined;
    await bot.handleUpdate({
      update_id: ++updateId,
      message: { message_id: ++msgId, date: 0, chat: opts.chat ?? chat(), from, text, entities },
    });
  };
  const press = async (data, message = { message_id: 1, date: 0, chat: chat(), text: 'x' }) => {
    await bot.handleUpdate({ update_id: ++updateId, callback_query: { id: String(updateId), from, chat_instance: '1', data, message } });
  };
  const last = (method = 'sendMessage') => [...calls].reverse().find((c) => c.method === method)?.payload;
  const all = (method = 'sendMessage') => calls.filter((c) => c.method === method).map((c) => c.payload);
  const buttons = (payload) => (payload?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.callback_data);
  const labels = (payload) => (payload?.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);
  const keyboard = (payload) => (payload?.reply_markup?.keyboard ?? []).flat().map((b) => (typeof b === 'string' ? b : b.text));
  const setUser = (u) => {
    from = u;
  };
  const cardByWord = (w) => db._state.cards.find((c) => c.word === w);
  return { bot, db, calls, send, press, last, all, buttons, labels, keyboard, clock, setUser, cardByWord, translatorCalls, dictionaryCalls };
}
