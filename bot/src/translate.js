// Language helpers for the German ↔ Russian pair, and the MyMemory machine-translation client
// (https://mymemory.translated.net — free, no key; ~5000 characters/day anonymously, ~50000 with MYMEMORY_EMAIL).
// MyMemory is only the fallback: dictionary.js (German Wiktionary) is tried first.
// All network clients take an injectable fetch so tests never touch the network.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const decodeEntities = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export const isCyrillic = (s) => /[Ѐ-ӿ]/.test(String(s));
/** 'ru' for Cyrillic text, 'de' otherwise (the bot only works with German and Russian). */
export const langOf = (s) => (isCyrillic(s) ? 'ru' : 'de');

const ARTICLE = /^(der|die|das)\s+(.+)$/i;
/** "das Haus" → { article: 'das', rest: 'Haus' } */
export function splitArticle(s) {
  const text = String(s ?? '').trim();
  const m = text.match(ARTICLE);
  return m ? { article: m[1].toLowerCase(), rest: m[2].trim() } : { article: '', rest: text };
}
export const stripArticle = (s) => splitArticle(s).rest;
export const hasArticle = (s) => ARTICLE.test(String(s ?? '').trim());

function fitsTarget(text, to) {
  if (!text || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i.test(text) || text.length > 100) return false;
  if (/\p{L}{4,}/u.test(text) && text === text.toUpperCase()) return false; // "WOHNSITZ"-style shouting entries
  return to === 'ru' ? isCyrillic(text) : !isCyrillic(text) && /\p{L}/u.test(text);
}

/**
 * Returns translate(text, to, from) → translated string or null ('de' ↔ 'ru').
 * Throws on network/HTTP errors.
 * @param {{ fetch?: typeof globalThis.fetch, email?: string, timeoutMs?: number }} [options]
 */
export function createTranslator({ fetch: f = globalThis.fetch, email, timeoutMs = 5000 } = {}) {
  return async function translate(text, to, from = to === 'ru' ? 'de' : 'ru') {
    const q = String(text).trim();
    if (!q || !/^[a-z]{2}$/.test(to) || !/^[a-z]{2}$/.test(from)) return null;
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(`${from}|${to}`)}`;
    if (email) url += `&de=${encodeURIComponent(email)}`;
    const res = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
    const data = await res.json();
    if (data.quotaFinished || Number(data.responseStatus) !== 200) return null;
    const candidates = [data.responseData?.translatedText, ...(Array.isArray(data.matches) ? data.matches.map((m) => m?.translation) : [])]
      .map((c) => decodeEntities(String(c ?? '')).replace(/\s+/g, ' ').trim())
      .filter((c) => c && c.toLowerCase() !== q.toLowerCase());
    let out = candidates.find((c) => fitsTarget(c, to));
    if (!out) return null;
    // Russian common nouns are lower-case even when the German source noun is capitalised.
    if (to === 'ru' && /^\p{Lu}\p{Ll}/u.test(out)) out = out[0].toLowerCase() + out.slice(1);
    return out.slice(0, 300);
  };
}

/** Runs fn over items with at most `limit` in flight. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
