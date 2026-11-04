// German Wiktionary (de.wiktionary.org) as the dictionary for the German ↔ Russian pair.
// One request gives, for a German word: the article (der/die/das), IPA, a pronunciation recording
// and the Russian translation; for a Russian word: its German meaning, IPA and recording.
// Recordings are Wikimedia Commons files; Commons serves MP3 versions that Telegram can play.
import { splitArticle, hasArticle, langOf } from './translate.js';

export const USER_AGENT = 'WordLearningBot/1.0 (https://github.com/KuroloffS/wordlearning_app)';
const GENDER_ARTICLE = { m: 'der', f: 'die', n: 'das' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The "== Wort ({{Sprache|Deutsch}}) ==" section of a page, or null. */
export function languageSection(content, sprache) {
  const parts = String(content ?? '').split(/^(?=== [^=])/m);
  return parts.find((p) => p.startsWith('== ') && p.split('\n', 1)[0].includes(`{{Sprache|${sprache}}}`)) ?? null;
}

/** Parses one de.wiktionary page for the German ('de') or Russian ('ru') entry. */
export function parseEntry(title, content, lang) {
  const sec = languageSection(content, lang === 'de' ? 'Deutsch' : 'Russisch');
  if (!sec) return null;
  const wortart = sec.match(/\{\{Wortart\|([^|}]+)\|(?:Deutsch|Russisch)\}\}([^\n]*)/);
  const pos = wortart?.[1]?.trim() ?? '';
  let article = '';
  if (lang === 'de' && pos === 'Substantiv') {
    const genders = [...new Set([...(wortart?.[2] ?? '').matchAll(/\{\{([mfn])\}\}/g)].map((m) => m[1]))];
    if (genders.length === 1) article = GENDER_ARTICLE[genders[0]];
  }
  const ipa = sec.match(/\{\{Lautschrift\|([^}|]+)\}\}/)?.[1]?.trim() ?? '';
  const audioFile = sec.match(/\{\{Audio\|([^}|]+?\.(?:ogg|oga|opus|wav|mp3|flac))\s*[|}]/i)?.[1]?.trim() ?? '';
  let translations = [];
  if (lang === 'de') {
    // *{{ru}}: [1] {{Üt|ru|дом}} {{m}}; [2] …  → first meaning only
    const line = sec.match(/^\*\{\{ru\}\}:([^\n]*)/m)?.[1] ?? '';
    translations = [...line.split(/\[2\]/)[0].matchAll(/\{\{Üt?\|ru\|([^}|]+)/g)].map((m) => m[1].trim());
  } else {
    // {{Bedeutungen}}\n:[1] [[Haus]], [[Gebäude]]  → German words of the first meaning
    const first = sec.match(/\{\{Bedeutungen\}\}[^\n]*\n:\s*(?:\[1\])?([^\n]*)/)?.[1] ?? '';
    translations = [...first.replace(/\{\{[^}]*\}\}/g, ' ').matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
  }
  return {
    lang,
    lemma: title,
    pos,
    article,
    headword: article ? `${article} ${title}` : title,
    ipa: ipa ? `[${ipa}]`.slice(0, 100) : '',
    audioFile,
    translations: [...new Set(translations.filter(Boolean))].slice(0, 3),
    inflected: /Form\b|Komparativ|Superlativ|Partizip/.test(pos),
  };
}

/** "Haus" + entry(das Haus) → "das Haus"; leaves words that already have an article (or are not that noun) alone. */
export function withArticle(word, entry) {
  if (!entry?.article || hasArticle(word) || langOf(word) !== 'de') return word;
  return entry.lemma.toLowerCase() === String(word).trim().toLowerCase() ? entry.headword : word;
}

/**
 * Returns lookup(text, lang) → entry or null (no German/Russian entry). Throws on network/HTTP errors
 * so callers can retry later. Entry: { lang, lemma, article, headword, ipa, audio_url, translations, pos }.
 * @param {{ fetch?: typeof globalThis.fetch, timeoutMs?: number }} [options]
 */
export function createDictionary({ fetch: f = globalThis.fetch, timeoutMs = 6000 } = {}) {
  const headers = { 'User-Agent': USER_AGENT, 'Api-User-Agent': USER_AGENT };
  async function getJson(url) {
    const res = await f(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Wiktionary HTTP ${res.status}`);
    return res.json();
  }

  /** MP3 version of a Commons recording (Telegram can't play the original Ogg Vorbis files). */
  async function audioUrl(file) {
    if (!file) return '';
    const data = await getJson(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=videoinfo&viprop=derivatives&titles=${encodeURIComponent(`File:${file}`)}`,
    );
    const derivatives = data?.query?.pages?.[0]?.videoinfo?.[0]?.derivatives ?? [];
    const src = String(derivatives.find((d) => d?.type === 'audio/mpeg' || /\.mp3$/i.test(d?.src ?? ''))?.src ?? '');
    return /^https:\/\/upload\.wikimedia\.org\//.test(src) && src.length <= 500 ? src : '';
  }

  return async function lookup(text, lang = langOf(text)) {
    const base = (lang === 'de' ? splitArticle(text).rest : String(text ?? '')).trim();
    if (!base || base.length > 60 || /[|#[\]{}<>]/.test(base)) return null;
    const variants = lang === 'de' ? [...new Set([base, cap(base), base.toLowerCase()])] : [...new Set([base.toLowerCase(), base])];
    const data = await getJson(
      `https://de.wiktionary.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=content&rvslots=main&titles=${encodeURIComponent(variants.join('|'))}`,
    );
    const q = data?.query ?? {};
    const resolve = (v) => {
      let title = v;
      for (const n of q.normalized ?? []) if (n.from === title) title = n.to;
      for (const r of q.redirects ?? []) if (r.from === title) title = r.to;
      return title;
    };
    const entries = [];
    for (const v of variants) {
      const page = (q.pages ?? []).find((p) => p.title === resolve(v) && !p.missing && !p.invalid);
      const content = page?.revisions?.[0]?.slots?.main?.content;
      const e = content ? parseEntry(page.title, content, lang) : null;
      if (e && !entries.some((x) => x.lemma === e.lemma)) entries.push(e);
    }
    // Prefer a dictionary form ("Haus") over an inflected form ("haus", a form of "hausen").
    const entry = entries.find((e) => !e.inflected) ?? entries[0];
    if (!entry) return null;
    let audio_url = '';
    try {
      audio_url = await audioUrl(entry.audioFile);
    } catch (e) {
      console.warn('Commons audio lookup failed:', e.message);
    }
    return { ...entry, audio_url };
  };
}

/** Downloads a pronunciation recording (sent to Telegram as a voice message). */
export function createAudioFetcher({ fetch: f = globalThis.fetch, timeoutMs = 8000, maxBytes = 2_000_000 } = {}) {
  return async function fetchAudio(url) {
    const res = await f(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Audio HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) throw new Error(`Audio size ${bytes.length}`);
    return bytes;
  };
}
