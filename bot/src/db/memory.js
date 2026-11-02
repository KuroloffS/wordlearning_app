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
  pending: null,
  last_active_at: null,
  last_notified_at: null,
};

const localDate = (t, off) => new Date(t + off * MINUTE).toISOString().slice(0, 10);

export function createMemoryDb() {
  const users = new Map();
  let cards = [];
  let log = [];
  const clone = (x) => (x ? structuredClone(x) : null);

  return {
    _state: { users, get cards() { return cards; }, get log() { return log; } },

    async upsertUser(from, now) {
      const prev = users.get(from.id) || { ...USER_DEFAULTS, id: from.id, created_at: now };
      const u = { ...prev, username: from.username ?? null, first_name: from.first_name ?? null, language_code: from.language_code ?? null, last_active_at: now };
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
      let added = 0;
      items.forEach((it, i) => {
        const word = String(it.word || '').trim();
        const translation = String(it.translation || '').trim();
        if (!word || !translation) return;
        if (cards.some((c) => c.user_id === userId && c.word.toLowerCase() === word.toLowerCase())) return;
        cards.push({
          id: randomUUID(), user_id: userId, word, translation, example: String(it.example || '').trim(),
          stage: 0, reps: 0, lapses: 0, due: now, last_reviewed: null, created_at: now + i + 1,
        });
        added++;
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
        return c.filter((x) => x.reps > 0 && (n === 0 ? x.due <= now || localDate(x.due, off) === day : x.due > now && localDate(x.due, off) === day)).length;
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
    async dueUsers(now, gapMin, idleMin) {
      const out = [];
      for (const u of users.values()) {
        if (!u.remind) continue;
        if (u.last_notified_at != null && u.last_notified_at >= now - gapMin * MINUTE) continue;
        if (u.last_active_at != null && u.last_active_at >= now - idleMin * MINUTE) continue;
        const n = cards.filter((c) => c.user_id === u.id && c.reps > 0 && c.due <= now).length;
        if (n) out.push({ user_id: u.id, due_count: n, tz_offset_min: u.tz_offset_min, quiet_start: u.quiet_start, quiet_end: u.quiet_end });
      }
      return out;
    },
  };
}
