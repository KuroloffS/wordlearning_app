// Test harness: the real bot with an in-memory database, a fake Telegram API and a fake dictionary.
import { createBot } from '../src/bot.js';
import { createMemoryDb } from '../src/db/memory.js';
import { stripArticle } from '../src/translate.js';

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
  ru: { id: 111, is_bot: false, first_name: 'Ольга', username: 'olga', language_code: 'ru' },
  de: { id: 222, is_bot: false, first_name: 'Hans', language_code: 'de' },
  uz: { id: 333, is_bot: false, first_name: 'Sardor', language_code: 'uz' }, // gets the Russian interface
};

export const AUDIO = {
  haus: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7e/De-Haus.ogg/De-Haus.ogg.mp3',
  katze: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a1/De-Katze.ogg/De-Katze.ogg.mp3',
  dom: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/1/12/Ru-дом.ogg/Ru-дом.ogg.mp3',
  koshka: 'https://upload.wikimedia.org/wikipedia/commons/transcoded/b/b2/Ru-кошка.ogg/Ru-кошка.ogg.mp3',
};

const entry = (lang, lemma, article, ipa, audio_url, translations) => ({
  lang,
  lemma,
  article,
  headword: article ? `${article} ${lemma}` : lemma,
  ipa,
  audio_url,
  translations,
  pos: article ? 'Substantiv' : '',
});

const DICT = {
  de: {
    haus: entry('de', 'Haus', 'das', '[haʊ̯s]', AUDIO.haus, ['дом']),
    katze: entry('de', 'Katze', 'die', '[ˈkat͡sə]', AUDIO.katze, ['кошка']),
    lernen: entry('de', 'lernen', '', '[ˈlɛʁnən]', '', ['учить']),
  },
  ru: {
    'дом': entry('ru', 'дом', '', '[dom]', AUDIO.dom, ['Haus', 'Gebäude']),
    'кошка': entry('ru', 'кошка', '', '[ˈkoʂkə]', AUDIO.koshka, ['Katze']),
  },
};

export function fakeDictionary(calls = []) {
  return async (text, lang) => {
    calls.push(`${text}|${lang}`);
    if (/flaky/i.test(text)) throw new Error('HTTP 503');
    const key = (lang === 'de' ? stripArticle(text) : String(text)).toLowerCase();
    return DICT[lang]?.[key] ?? null;
  };
}

const TRANSLATIONS = { 'fahrrad|ru': 'велосипед', 'велосипед|de': 'Fahrrad' };

export function fakeTranslator(calls = []) {
  return async (text, to, from) => {
    calls.push(`${text}|${from}>${to}`);
    if (text === 'boom') throw new Error('network down');
    return TRANSLATIONS[`${text.toLowerCase()}|${to}`] ?? null;
  };
}

export function harness({ start = Date.UTC(2026, 0, 5, 9, 0), user = USERS.ru, failMethods = [], translator, dictionary } = {}) {
  const clock = { now: start };
  const db = createMemoryDb();
  const translatorCalls = [];
  const dictionaryCalls = [];
  const audioDownloads = [];
  const bot = createBot('TEST:TOKEN', db, {
    clock: () => clock.now,
    botInfo: BOT_INFO,
    random: () => 0.9,
    translator: translator === undefined ? fakeTranslator(translatorCalls) : translator,
    dictionary: dictionary === undefined ? fakeDictionary(dictionaryCalls) : dictionary,
    fetchAudio: async (url) => {
      audioDownloads.push(url);
      return new Uint8Array([73, 68, 51]); // "ID3"
    },
    onError: (err) => {
      throw err.error;
    },
  });
  const calls = [];
  let msgId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload });
    if (failMethods.includes(method)) return { ok: false, error_code: 400, description: `Bad Request: ${method} failed` };
    let result = true;
    if (method.startsWith('send')) {
      result = { message_id: ++msgId, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text };
      if (method === 'sendVoice') result.voice = { file_id: `VOICE-${msgId}`, file_unique_id: `u${msgId}`, duration: 1 };
    }
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
  const userState = (u = from) => db._state.users.get(u.id);
  return { bot, db, calls, send, press, last, all, buttons, labels, keyboard, clock, setUser, cardByWord, userState, translatorCalls, dictionaryCalls, audioDownloads };
}
