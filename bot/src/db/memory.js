// In-memory implementation of the same interface as db/supabase.js.
// Used by the tests, and handy for trying the bot locally without a database (DB=memory).
import { randomUUID } from 'node:crypto';
import { DAY, MINUTE } from '../../../js/srs.js';

const USER_DEFAULTS = {
  mode: 'flip',
  direction: 'forward',
  new_per_day: 20,
  remind: true,
  tz_offset_min: 300,
  quiet_start: 23,
  quiet_end: 8,
  lang: 'ru',
  learn: 'de',
  auto_translate: true,
  pending: null,
  last_active_at: null,
  last_notified_at: null,
};

const localDate = (t, off) => new Date(t + off * MINUTE).toISOString().slice(0, 10);
const localHour = (t, off) => new Date(t + off * MINUTE).getUTCHours();
const isQuiet = (h, s, e) => s !== e && (s < e ? h >= s && h < e : h >= s || h < e);

export function createMemoryDb() {
  const users = new Map();
  const appState = new Map();
  let cards = [];
  let log = [];
  const clone = (x) => (x ? structuredClone(x) : null);

  return {
    _state: {
      users,
      appState,
      get cards() {
        return cards;
      },
      get log() {
        return log;
      },
    },

    async touchUser(from, now, defaults = {}) {
      const prev = users.get(from.id) || {
        ...USER_DEFAULTS,
        id: from.id,
        lang: defaults.lang ?? 'ru',
        learn: defaults.learn ?? 'de',
        tz_offset_min: defaults.tz_offset_min ?? 300,
        created_at: now,
      };
      const u = {
        ...prev,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        language_code: from.language_code ?? null,
        last_active_at: now,
      };
      users.set(from.id, u);
      return clone(u);
    },
    async getUser(id) {
      return clone(users.get(id));
    },
    async updateUser(id, patch) {
      const u = users.get(id);
      if (u) users.set(id, { ...u, ...structuredClone(patch) });
    },
    async addCards(userId, items, now) {
      const added = [];
      items.forEach((it, i) => {
        const word = String(it.word || '').trim().slice(0, 200);
        const translation = String(it.translation || '').trim().slice(0, 300);
        if (!word || !translation) return;
        if (cards.some((c) => c.user_id === userId && c.word.toLowerCase() === word.toLowerCase())) return;
        const card = {
          id: randomUUID(),
          user_id: userId,
          word,
          translation,
          example: String(it.example || '').trim().slice(0, 500),
          phonetic: String(it.phonetic || '').slice(0, 100),
          audio_url: String(it.audio_url || '').slice(0, 500),
          audio_file_id: '',
          enriched: !!it.enriched,
          stage: 0,
          reps: 0,
          lapses: 0,
          due: now,
          last_reviewed: null,
          created_at: now + i + 1,
        };
        cards.push(card);
        added.push(clone(card));
      });
      return added;
    },
    async getCard(userId, id) {
      return clone(cards.find((c) => c.user_id === userId && c.id === id));
    },
    async getNextCard(userId, now, allowNew) {
      const mine = cards.filter((c) => c.user_id === userId);
      const due = mine.filter((c) => c.reps > 0 && c.due <= now).sort((a, b) => a.due - b.due)[0];
      if (due) return clone(due);
      if (!allowNew) return null;
      return clone(mine.filter((c) => c.reps === 0).sort((a, b) => a.created_at - b.created_at)[0]);
    },
    async saveReview(card, prevReps, grade, wasNew, now) {
      const i = cards.findIndex((c) => c.id === card.id && c.user_id === card.user_id && c.reps === prevReps);
      if (i < 0) return false;
      cards[i] = { ...cards[i], stage: card.stage, reps: card.reps, lapses: card.lapses, due: card.due, last_reviewed: card.last_reviewed };
      log.push({ user_id: card.user_id, card_id: card.id, grade, was_new: wasNew, reviewed_at: now });
      return true;
    },
    async updateCardText(userId, id, { word, translation, example }) {
      const c = cards.find((x) => x.user_id === userId && x.id === id);
      if (!c) return 'missing';
      const w = word.trim().slice(0, 200);
      if (cards.some((x) => x.user_id === userId && x.id !== id && x.word.toLowerCase() === w.toLowerCase())) return 'duplicate';
      if (w.toLowerCase() !== c.word.toLowerCase()) Object.assign(c, { phonetic: '', audio_url: '', audio_file_id: '', enriched: false });
      Object.assign(c, { word: w, translation: translation.trim().slice(0, 300), example: (example ?? '').trim().slice(0, 500) });
      return 'ok';
    },
    async countDue(userId, now) {
      return cards.filter((c) => c.user_id === userId && c.reps > 0 && c.due <= now).length;
    },
    async countNew(userId) {
      return cards.filter((c) => c.user_id === userId && c.reps === 0).length;
    },
    async countNewLearnedSince(userId, since) {
      return log.filter((l) => l.user_id === userId && l.was_new && l.reviewed_at >= since).length;
    },
    async nextDueAt(userId, now) {
      const d = cards.filter((c) => c.user_id === userId && c.reps > 0 && c.due > now).map((c) => c.due);
      return d.length ? Math.min(...d) : null;
    },
    async recentAnswers(userId, excludeId, field) {
      return cards
        .filter((c) => c.user_id === userId && c.id !== excludeId)
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, 60)
        .map((c) => c[field]);
    },
    async listCards(userId, { offset = 0, limit = 20, search = '' } = {}) {
      const s = search.toLowerCase();
      const all = cards
        .filter((c) => c.user_id === userId)
        .filter((c) => !s || c.word.toLowerCase().includes(s) || c.translation.toLowerCase().includes(s))
        .sort((a, b) => b.created_at - a.created_at);
      return { cards: clone(all.slice(offset, offset + limit)), total: all.length };
    },
    async allCards(userId) {
      return clone(cards.filter((c) => c.user_id === userId).sort((a, b) => a.created_at - b.created_at));
    },
    async deleteCard(userId, id) {
      const before = cards.length;
      cards = cards.filter((c) => !(c.user_id === userId && c.id === id));
      return cards.length < before;
    },
    async resetCard(userId, id, now) {
      const c = cards.find((x) => x.user_id === userId && x.id === id);
      if (!c) return false;
      Object.assign(c, { stage: 0, reps: 0, lapses: 0, due: now, last_reviewed: null });
      return true;
    },
    async deleteAllCards(userId) {
      cards = cards.filter((c) => c.user_id !== userId);
    },
    async stats(userId, now, off, maxStage) {
      const c = cards.filter((x) => x.user_id === userId);
      const l = log.filter((x) => x.user_id === userId);
      const today = localDate(now, off);
      const lt = l.filter((x) => localDate(x.reviewed_at, off) === today);
      const forecast = Array.from({ length: 7 }, (_, n) => {
        const day = localDate(now + n * DAY, off);
        return c.filter(
          (x) => x.reps > 0 && (n === 0 ? x.due <= now || localDate(x.due, off) === day : x.due > now && localDate(x.due, off) === day),
        ).length;
      });
      return {
        total: c.length,
        new: c.filter((x) => x.reps === 0).length,
        learning: c.filter((x) => x.reps > 0 && x.stage < 4).length,
        known: c.filter((x) => x.reps > 0 && x.stage >= 4 && x.stage < maxStage).length,
        mastered: c.filter((x) => x.reps > 0 && x.stage >= maxStage).length,
        due: c.filter((x) => x.reps > 0 && x.due <= now).length,
        reviews_today: lt.length,
        correct_today: lt.filter((x) => x.grade >= 1).length,
        new_today: lt.filter((x) => x.was_new).length,
        reviews_total: l.length,
        correct_total: l.filter((x) => x.grade >= 1).length,
        days: [...new Set(l.map((x) => localDate(x.reviewed_at, off)))].sort().reverse(),
        forecast,
      };
    },
    async claimReminders(now, gapMin, idleMin, limit, test = false) {
      const out = [];
      for (const u of users.values()) {
        if (out.length >= limit) break;
        if (!u.remind || (test ? u.id >= 0 : u.id <= 0)) continue;
        if (u.last_notified_at != null) {
          // Same rule as public.reminder_gap_passed(): ignored reminders back off to 4× the gap.
          const ignored = !(u.last_active_at > u.last_notified_at);
          if (u.last_notified_at >= now - gapMin * MINUTE * (ignored ? 4 : 1)) continue;
        }
        if (u.last_active_at != null && u.last_active_at >= now - idleMin * MINUTE) continue;
        if (isQuiet(localHour(now, u.tz_offset_min), u.quiet_start, u.quiet_end)) continue;
        const n = cards.filter((c) => c.user_id === u.id && c.reps > 0 && c.due <= now).length;
        if (!n) continue;
        out.push({ user_id: u.id, due_count: n, lang: u.lang, prev_notified_at: u.last_notified_at });
        u.last_notified_at = now;
      }
      return out;
    },
    async cardsToEnrich(limit) {
      return cards
        .filter((c) => !c.enriched)
        .sort((a, b) => a.created_at - b.created_at)
        .slice(0, limit)
        .map((c) => ({ id: c.id, word: c.word }));
    },
    async saveEnrichment(id, { phonetic = '', audio_url = '', word }) {
      const c = cards.find((x) => x.id === id);
      if (!c) return;
      Object.assign(c, { phonetic, audio_url, audio_file_id: '', enriched: true });
      const taken = word && cards.some((x) => x.user_id === c.user_id && x.id !== id && x.word.toLowerCase() === word.toLowerCase());
      if (word && !taken) c.word = word;
    },
    async saveAudioFileId(id, fileId) {
      const c = cards.find((x) => x.id === id);
      if (c) c.audio_file_id = fileId;
    },
    async getAppState(key) {
      return clone(appState.get(key) ?? null);
    },
    async setAppState(key, value) {
      appState.set(key, structuredClone(value));
    },
  };
}
