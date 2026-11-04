// GENERATED from bot/src/translate.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
// External lookups:
//  - MyMemory (https://mymemory.translated.net) for automatic translation. Free, no key.
//    Anonymous use allows ~5000 characters/day; set MYMEMORY_EMAIL to raise it to ~50000.
//  - Free Dictionary API (https://dictionaryapi.dev) for English transcription and pronunciation audio.
// Both clients take an injectable fetch so tests never touch the network.

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" };
const decodeEntities = (s) =>
  s.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Matches the casing of the input: "Ob-havo" → "ob-havo" when the user typed "weather". */
function matchCase(input, output) {
  if (input === input.toLowerCase() && /^\p{Lu}\p{Ll}/u.test(output)) return output[0].toLowerCase() + output.slice(1);
  return output;
}

/**
 * Returns translate(text, to) → translated string, or null when no useful translation exists.
 * Throws on network/HTTP errors.
 * @param {{ fetch?: typeof globalThis.fetch, email?: string, timeoutMs?: number }} [options]
 */
export function createTranslator({ fetch: f = globalThis.fetch, email, timeoutMs = 5000 } = {}) {
  return async function translate(text, to, from = 'Autodetect') {
    const q = String(text).trim();
    if (!q || !/^[a-z]{2}$/.test(to)) return null;
    let url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent(`${from}|${to}`)}`;
    if (email) url += `&de=${encodeURIComponent(email)}`;
    const res = await f(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
    const data = await res.json();
    if (data.quotaFinished || Number(data.responseStatus) !== 200) return null;
    let out = decodeEntities(String(data.responseData?.translatedText ?? '')).replace(/\s+/g, ' ').trim();
    if (!out || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i.test(out)) return null;
    if (out.toLowerCase() === q.toLowerCase()) return null;
    return matchCase(q, out).slice(0, 300);
  };
}

/** Normalizes an English word/phrase for a dictionary lookup, or returns null if it isn't one. */
export function englishCandidate(word) {
  const w = String(word || '')
    .trim()
    .toLowerCase()
    .replace(/^(to|a|an|the)\s+/, '');
  if (w.length > 40 || !/^[a-z][a-z'-]*(?: [a-z][a-z'-]*){0,2}$/.test(w)) return null;
  return w;
}

/** Picks a transcription and an audio URL (US first, then UK, then any) from a dictionaryapi.dev response. */
export function extractPronunciation(entries) {
  if (!Array.isArray(entries)) return null;
  const phonetics = entries.flatMap((e) => (Array.isArray(e?.phonetics) ? e.phonetics : []));
  const texts = [entries.find((e) => e?.phonetic)?.phonetic, ...phonetics.map((p) => p?.text)].filter(Boolean);
  const audios = phonetics
    .map((p) => String(p?.audio || ''))
    .filter(Boolean)
    .map((a) => (a.startsWith('//') ? 'https:' + a : a))
    .filter((a) => /^https:\/\/[^\s]+$/.test(a) && a.length <= 500);
  const audio = audios.find((a) => /-us\.mp3$/i.test(a)) || audios.find((a) => /-uk\.mp3$/i.test(a)) || audios[0] || '';
  const phonetic = String(texts[0] || '').trim().slice(0, 100);
  if (!phonetic && !audio) return null;
  return { phonetic, audio_url: audio };
}

/**
 * Returns lookup(word) → { phonetic, audio_url } or null when the dictionary has no entry.
 * Throws on network/HTTP errors (so callers can retry later).
 * @param {{ fetch?: typeof globalThis.fetch, timeoutMs?: number }} [options]
 */
export function createDictionary({ fetch: f = globalThis.fetch, timeoutMs = 5000 } = {}) {
  return async function lookup(word) {
    const w = englishCandidate(word);
    if (!w) return null;
    const res = await f(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Dictionary HTTP ${res.status}`);
    return extractPronunciation(await res.json());
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
