import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry, languageSection, createDictionary, createAudioFetcher, withArticle, USER_AGENT } from '../src/dictionary.js';

// Trimmed copies of real de.wiktionary pages.
const HAUS = `== Haus ({{Sprache|Deutsch}}) ==
=== {{Wortart|Substantiv|Deutsch}}, {{n}} ===
{{Deutsch Substantiv Übersicht|Genus=n|Nominativ Singular=Haus}}
{{Aussprache}}
:{{IPA}} {{Lautschrift|haʊ̯s}}
:{{Hörbeispiele}} {{Audio|De-Haus.ogg}}
{{Bedeutungen}}
:[1] zu einem bestimmten Zweck erbautes [[Gebäude]]
==== {{Übersetzungen}} ====
{{Ü-Tabelle|1|G=Gebäude|Ü-Liste=
*{{en}}: [1] {{Ü|en|house}}
*{{ru}}: {{Üt|ru|дом}} {{m}}
}}
== Haus ({{Sprache|Englisch}}) ==
=== {{Wortart|Substantiv|Englisch}} ===`;

const HAUS_LOWER = `== haus ({{Sprache|Deutsch}}) ==
=== {{Wortart|Konjugierte Form|Deutsch}} ===
{{Aussprache}}
:{{IPA}} {{Lautschrift|haʊ̯s}}
:{{Hörbeispiele}} {{Audio|De-haus.ogg}}`;

const SCHNELL = `== schnell ({{Sprache|Deutsch}}) ==
=== {{Wortart|Adjektiv|Deutsch}} ===
:{{IPA}} {{Lautschrift|ʃnɛl}}
:{{Hörbeispiele}} {{Audio|De-schnell.ogg}}
{{Ü-Tabelle|Ü-Liste=
*{{ru}}: [1] {{Üt|ru|быстрый}}, {{Üt|ru|скорый}}; [2] {{Üt|ru|резвый}}
}}`;

const DOM = `== дом ({{Sprache|Russisch}}) ==
=== {{Wortart|Substantiv|Russisch}}, {{m}} ===
{{Aussprache}}
:{{IPA}} {{Lautschrift|dom}}
:{{Hörbeispiele}} {{Audio|Ru-дом.ogg}}
{{Bedeutungen}}
:[1] [[Haus]], [[Gebäude]]
:[2] [[Heim]]`;

const VELOSIPED = `== велосипед ({{Sprache|Russisch}}) ==
=== {{Wortart|Substantiv|Russisch}}, {{m}} ===
{{Bedeutungen}}
:[1] {{K|Verkehr}} das [[Fahrrad|Fahrrad]]`;

test('parses German entries: article, IPA, audio file, Russian translations of the first meaning', () => {
  const e = parseEntry('Haus', HAUS, 'de');
  assert.equal(e.article, 'das');
  assert.equal(e.headword, 'das Haus');
  assert.equal(e.ipa, '[haʊ̯s]');
  assert.equal(e.audioFile, 'De-Haus.ogg');
  assert.deepEqual(e.translations, ['дом']);
  assert.equal(e.inflected, false);
  assert.deepEqual(parseEntry('schnell', SCHNELL, 'de').translations, ['быстрый', 'скорый']);
  assert.equal(parseEntry('schnell', SCHNELL, 'de').article, '');
  assert.equal(parseEntry('haus', HAUS_LOWER, 'de').inflected, true);
  assert.equal(parseEntry('Haus', HAUS, 'ru'), null); // no Russian section
  assert.ok(languageSection(HAUS, 'Englisch').startsWith('== Haus ({{Sprache|Englisch}})'));
});

test('parses Russian entries: German words of the first meaning, IPA, audio', () => {
  const e = parseEntry('дом', DOM, 'ru');
  assert.deepEqual(e.translations, ['Haus', 'Gebäude']);
  assert.equal(e.ipa, '[dom]');
  assert.equal(e.audioFile, 'Ru-дом.ogg');
  assert.deepEqual(parseEntry('велосипед', VELOSIPED, 'ru').translations, ['Fahrrad']);
});

test('withArticle', () => {
  const e = parseEntry('Haus', HAUS, 'de');
  assert.equal(withArticle('Haus', e), 'das Haus');
  assert.equal(withArticle('haus', e), 'das Haus');
  assert.equal(withArticle('das Haus', e), 'das Haus');
  assert.equal(withArticle('Häuser', e), 'Häuser');
  assert.equal(withArticle('дом', e), 'дом');
  assert.equal(withArticle('Haus', null), 'Haus');
});

function fakeWikimedia(pages, { failCommons = false } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, ua: init?.headers?.['User-Agent'] });
    const u = new URL(url);
    if (u.hostname === 'de.wiktionary.org') {
      const titles = u.searchParams.get('titles').split('|');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: {
            pages: titles.map((t) => (pages[t] ? { title: t, revisions: [{ slots: { main: { content: pages[t] } } }] } : { title: t, missing: true })),
          },
        }),
      };
    }
    if (u.hostname === 'commons.wikimedia.org') {
      if (failCommons) return { ok: false, status: 503, json: async () => ({}) };
      const file = u.searchParams.get('titles').replace('File:', '');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          query: { pages: [{ videoinfo: [{ derivatives: [{ src: `https://upload.wikimedia.org/wikipedia/commons/transcoded/x/xy/${file}/${file}.mp3`, type: 'audio/mpeg' }] }] }] },
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, requests };
}

test('lookup prefers the dictionary form and resolves the MP3 recording', async () => {
  const { fetch, requests } = fakeWikimedia({ Haus: HAUS, haus: HAUS_LOWER, 'дом': DOM });
  const lookup = createDictionary({ fetch });
  const e = await lookup('haus', 'de');
  assert.equal(e.headword, 'das Haus'); // not the conjugated form "haus"
  assert.equal(e.audio_url, 'https://upload.wikimedia.org/wikipedia/commons/transcoded/x/xy/De-Haus.ogg/De-Haus.ogg.mp3');
  assert.equal(requests[0].ua, USER_AGENT);
  assert.deepEqual(new URL(requests[0].url).searchParams.get('titles').split('|'), ['haus', 'Haus']);

  assert.equal((await lookup('der Haus', 'de')).headword, 'das Haus'); // wrong article corrected
  const ru = await lookup('Дом', 'ru');
  assert.deepEqual(ru.translations, ['Haus', 'Gebäude']);
  assert.equal(await lookup('Quatschwort', 'de'), null);
  assert.equal(await lookup('a|b', 'de'), null);

  // Audio is optional: a Commons failure still returns the entry.
  const broken = createDictionary({ fetch: fakeWikimedia({ Haus: HAUS }, { failCommons: true }).fetch });
  const noAudio = await broken('Haus', 'de');
  assert.equal(noAudio.headword, 'das Haus');
  assert.equal(noAudio.audio_url, '');

  const down = createDictionary({ fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(down('Haus', 'de'), /HTTP 503/);
});

test('audio fetcher sends the User-Agent and limits the size', async () => {
  let seen;
  const ok = createAudioFetcher({
    fetch: async (_url, init) => {
      seen = init.headers['User-Agent'];
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    },
  });
  assert.deepEqual([...(await ok('https://upload.wikimedia.org/x.mp3'))], [1, 2, 3]);
  assert.equal(seen, USER_AGENT);
  const big = createAudioFetcher({ maxBytes: 2, fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array(3).buffer }) });
  await assert.rejects(big('https://upload.wikimedia.org/x.mp3'), /size/);
});
