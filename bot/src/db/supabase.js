// Data access on top of Supabase (service_role key, server side only).
// Every function takes timestamps as milliseconds and returns cards with `due`
// etc. converted to milliseconds, so the scheduler in js/srs.js can use them directly.
import { createClient } from '@supabase/supabase-js';

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const ms = (v) => (v == null ? null : Date.parse(v));

function toCard(row) {
  if (!row) return null;
  return { ...row, due: ms(row.due), created_at: ms(row.created_at), last_reviewed: ms(row.last_reviewed) };
}

function check({ data, error, count }) {
  if (error) throw new Error(`Supabase: ${error.message}`);
  return count ?? data;
}

/** Strips characters that have meaning inside a PostgREST `or=` filter. */
function safePattern(q) {
  return String(q).replace(/[,()%*\\:"]/g, ' ').trim().slice(0, 50);
}

export function createSupabaseDb(url, serviceKey) {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    async upsertUser(from, now) {
      const row = {
        id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        language_code: from.language_code ?? null,
        last_active_at: iso(now),
      };
      return check(await sb.from('users').upsert(row, { onConflict: 'id' }).select().single());
    },

    async getUser(id) {
      return check(await sb.from('users').select().eq('id', id).maybeSingle());
    },

    async updateUser(id, patch) {
      const p = { ...patch };
      for (const k of ['last_active_at', 'last_notified_at']) if (typeof p[k] === 'number') p[k] = iso(p[k]);
      check(await sb.from('users').update(p).eq('id', id));
    },

    async addCards(userId, items, now) {
      if (!items.length) return 0;
      return check(await sb.rpc('add_cards', { p_user: userId, p_items: items, p_now: iso(now) }));
    },

    async getCard(userId, id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
      return toCard(check(await sb.from('cards').select().eq('user_id', userId).eq('id', id).maybeSingle()));
    },

    async getNextCard(userId, now, allowNew) {
      const due = check(
        await sb.from('cards').select().eq('user_id', userId).gt('reps', 0).lte('due', iso(now)).order('due').limit(1),
      );
      if (due.length) return toCard(due[0]);
      if (!allowNew) return null;
      const fresh = check(await sb.from('cards').select().eq('user_id', userId).eq('reps', 0).order('created_at').limit(1));
      return toCard(fresh[0]);
    },

    /** Saves a reviewed card only if nobody reviewed it in the meantime. Returns true on success. */
    async saveReview(card, prevReps, grade, wasNew, now) {
      const rows = check(
        await sb
          .from('cards')
          .update({ stage: card.stage, reps: card.reps, lapses: card.lapses, due: iso(card.due), last_reviewed: iso(card.last_reviewed) })
          .eq('id', card.id)
          .eq('user_id', card.user_id)
          .eq('reps', prevReps)
          .select('id'),
      );
      if (!rows.length) return false;
      check(await sb.from('review_log').insert({ user_id: card.user_id, card_id: card.id, grade, was_new: wasNew, reviewed_at: iso(now) }));
      return true;
    },

    async countDue(userId, now) {
      return check(
        await sb.from('cards').select('id', { count: 'exact', head: true }).eq('user_id', userId).gt('reps', 0).lte('due', iso(now)),
      );
    },

    async countNew(userId) {
      return check(await sb.from('cards').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('reps', 0));
    },

    async countNewLearnedSince(userId, since) {
      return check(
        await sb
          .from('review_log')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('was_new', true)
          .gte('reviewed_at', iso(since)),
      );
    },

    async nextDueAt(userId, now) {
      const rows = check(
        await sb.from('cards').select('due').eq('user_id', userId).gt('reps', 0).gt('due', iso(now)).order('due').limit(1),
      );
      return rows.length ? ms(rows[0].due) : null;
    },

    async recentAnswers(userId, excludeId, field) {
      const rows = check(
        await sb.from('cards').select(field).eq('user_id', userId).neq('id', excludeId).order('created_at', { ascending: false }).limit(60),
      );
      return rows.map((r) => r[field]);
    },

    async listCards(userId, { offset = 0, limit = 20, search = '' } = {}) {
      let q = sb.from('cards').select('*', { count: 'exact' }).eq('user_id', userId);
      const s = safePattern(search);
      if (s) q = q.or(`word.ilike.*${s}*,translation.ilike.*${s}*`);
      const { data, error, count } = await q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return { cards: data.map(toCard), total: count ?? 0 };
    },

    async allCards(userId) {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const rows = check(await sb.from('cards').select().eq('user_id', userId).order('created_at').range(from, from + 999));
        out.push(...rows.map(toCard));
        if (rows.length < 1000) return out;
      }
    },

    async deleteCard(userId, id) {
      return check(await sb.from('cards').delete().eq('user_id', userId).eq('id', id).select('id')).length > 0;
    },

    async resetCard(userId, id, now) {
      const rows = check(
        await sb
          .from('cards')
          .update({ stage: 0, reps: 0, lapses: 0, due: iso(now), last_reviewed: null })
          .eq('user_id', userId)
          .eq('id', id)
          .select('id'),
      );
      return rows.length > 0;
    },

    async deleteAllCards(userId) {
      check(await sb.from('cards').delete().eq('user_id', userId));
    },

    async stats(userId, now, tzOffsetMin, maxStage) {
      return check(
        await sb.rpc('user_stats', { p_user: userId, p_now: iso(now), p_tz_offset_min: tzOffsetMin, p_max_stage: maxStage }),
      );
    },

    async dueUsers(now, gapMin, idleMin) {
      return check(await sb.rpc('due_users', { p_now: iso(now), p_gap_min: gapMin, p_idle_min: idleMin }));
    },
  };
}
