// Data access on top of Supabase (service_role key, server side only).
// Timestamps go in and come out as milliseconds, so the scheduler in js/srs.js can use them directly.
import { createClient } from '@supabase/supabase-js';

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
const ms = (v) => (v == null ? null : Date.parse(v));
const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));

function toCard(row) {
  if (!row) return null;
  return { ...row, due: ms(row.due), created_at: ms(row.created_at), last_reviewed: ms(row.last_reviewed) };
}

function toUser(row) {
  if (!row) return null;
  return { ...row, last_active_at: ms(row.last_active_at), last_notified_at: ms(row.last_notified_at), created_at: ms(row.created_at) };
}

function check({ data, error, count }) {
  if (error) throw new Error(`Supabase: ${error.message}${error.code ? ` (${error.code})` : ''}`);
  return count ?? data;
}

/** Strips characters that have meaning inside a PostgREST `or=` filter. */
function safePattern(q) {
  return String(q).replace(/[,()%*\\:"'.]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
}

export function createSupabaseDb(url, serviceKey) {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  return {
    /** Creates the user on first contact (with default language settings) or refreshes name/activity. */
    async touchUser(from, now, defaults = {}) {
      const row = check(
        await sb.rpc('touch_user', {
          p_id: from.id,
          p_username: from.username ?? null,
          p_first_name: from.first_name ?? null,
          p_language_code: from.language_code ?? null,
          p_lang: defaults.lang ?? 'ru',
          p_learn: defaults.learn ?? 'de',
          p_tz_offset_min: defaults.tz_offset_min ?? 300,
          p_now: iso(now),
        }),
      );
      return toUser(Array.isArray(row) ? row[0] : row);
    },

    async getUser(id) {
      return toUser(check(await sb.from('users').select().eq('id', id).maybeSingle()));
    },

    async updateUser(id, patch) {
      const p = { ...patch };
      for (const k of ['last_active_at', 'last_notified_at']) if (typeof p[k] === 'number') p[k] = iso(p[k]);
      check(await sb.from('users').update(p).eq('id', id));
    },

    /** Inserts words, skipping ones the user already has. Returns the inserted cards. */
    async addCards(userId, items, now) {
      if (!items.length) return [];
      const payload = items.map(({ word, translation, example, phonetic, audio_url, enriched }) => ({
        word,
        translation,
        example: example ?? '',
        phonetic: phonetic ?? '',
        audio_url: audio_url ?? '',
        enriched: !!enriched,
      }));
      const rows = check(await sb.rpc('add_cards', { p_user: userId, p_items: payload, p_now: iso(now) }));
      return (rows ?? []).map(toCard).sort((a, b) => a.created_at - b.created_at);
    },

    async getCard(userId, id) {
      if (!isUuid(id)) return null;
      return toCard(check(await sb.from('cards').select().eq('user_id', userId).eq('id', id).maybeSingle()));
    },

    async getNextCard(userId, now, allowNew) {
      const due = check(await sb.from('cards').select().eq('user_id', userId).gt('reps', 0).lte('due', iso(now)).order('due').limit(1));
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

    /** Returns 'ok', 'duplicate' (another card has this word) or 'missing'. */
    async updateCardText(userId, id, { word, translation, example }) {
      const card = await this.getCard(userId, id);
      if (!card) return 'missing';
      const patch = { word: word.trim().slice(0, 200), translation: translation.trim().slice(0, 300), example: (example ?? '').trim().slice(0, 500) };
      if (patch.word.toLowerCase() !== card.word.toLowerCase()) Object.assign(patch, { phonetic: '', audio_url: '', audio_file_id: '', enriched: false });
      const { error } = await sb.from('cards').update(patch).eq('user_id', userId).eq('id', id);
      if (error?.code === '23505') return 'duplicate';
      if (error) throw new Error(`Supabase: ${error.message}`);
      return 'ok';
    },

    async countDue(userId, now) {
      return check(await sb.from('cards').select('id', { count: 'exact', head: true }).eq('user_id', userId).gt('reps', 0).lte('due', iso(now)));
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
      const rows = check(await sb.from('cards').select('due').eq('user_id', userId).gt('reps', 0).gt('due', iso(now)).order('due').limit(1));
      return rows.length ? ms(rows[0].due) : null;
    },

    async recentAnswers(userId, excludeId, field) {
      if (field !== 'word' && field !== 'translation') throw new Error('bad field');
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
      if (!isUuid(id)) return false;
      return check(await sb.from('cards').delete().eq('user_id', userId).eq('id', id).select('id')).length > 0;
    },

    async resetCard(userId, id, now) {
      if (!isUuid(id)) return false;
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
      return check(await sb.rpc('user_stats', { p_user: userId, p_now: iso(now), p_tz_offset_min: tzOffsetMin, p_max_stage: maxStage }));
    },

    /**
     * Atomically picks users who should get a reminder now and marks them as notified.
     * `test` selects only the synthetic test users (negative ids) instead of real ones.
     */
    async claimReminders(now, gapMin, idleMin, limit, test = false) {
      const rows = check(
        await sb.rpc('claim_reminders', { p_now: iso(now), p_gap_min: gapMin, p_idle_min: idleMin, p_limit: limit, p_test: test }),
      );
      return (rows ?? []).map((r) => ({ ...r, due_count: Number(r.due_count), prev_notified_at: ms(r.prev_notified_at) }));
    },

    async cardsToEnrich(limit) {
      return check(await sb.from('cards').select('id, word').eq('enriched', false).order('created_at').limit(limit));
    },

    /** Stores pronunciation data; `word` (e.g. with the article added) is skipped if the user already has that word. */
    async saveEnrichment(id, { phonetic = '', audio_url = '', word }) {
      const patch = { phonetic: String(phonetic).slice(0, 100), audio_url: String(audio_url).slice(0, 500), audio_file_id: '', enriched: true };
      if (word) {
        const { error } = await sb.from('cards').update({ ...patch, word: String(word).slice(0, 200) }).eq('id', id);
        if (!error) return;
        if (error.code !== '23505') throw new Error(`Supabase: ${error.message}`);
      }
      check(await sb.from('cards').update(patch).eq('id', id));
    },

    /** Remembers Telegram's file id of an uploaded pronunciation so it is not downloaded again. */
    async saveAudioFileId(id, fileId) {
      check(await sb.from('cards').update({ audio_file_id: String(fileId).slice(0, 200) }).eq('id', id));
    },

    async getAppState(key) {
      const row = check(await sb.from('app_state').select('value').eq('key', key).maybeSingle());
      return row?.value ?? null;
    },

    async setAppState(key, value) {
      check(await sb.from('app_state').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
    },
  };
}
