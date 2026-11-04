import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, createDictionary, extractPronunciation, englishCandidate, mapLimit } from '../src/translate.js';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('translator parses MyMemory responses', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams.get('q');
    if (q === 'weather') return response(200, { responseStatus: 200, responseData: { translatedText: 'Ob-havo' } });
    if (q === 'Paris') return response(200, { responseStatus: 200, responseData: { translatedText: 'Parij' } });
    if (q === 'same') return response(200, { responseStatus: 200, responseData: { translatedText: 'Same' } });
    if (q === 'quota') return response(200, { responseStatus: 429, quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS' } });
    if (q === 'quote') return response(200, { responseStatus: 200, responseData: { translatedText: 'it&#39;s &amp; ok' } });
    return response(500, {});
  };
  const translate = createTranslator({ fetch, email: 'bot@example.com' });
  assert.equal(await translate('weather', 'uz'), 'ob-havo'); // casing follows the input
  assert.equal(await translate('Paris', 'uz'), 'Parij');
  assert.equal(await translate('same', 'en'), null); // identical → no translation
  assert.equal(await translate('quota', 'uz'), null);
  assert.equal(await translate('quote', 'uz'), "it's & ok");
  assert.equal(await translate('x', 'not-a-lang'), null);
  await assert.rejects(translate('error', 'uz'), /HTTP 500/);
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get('langpair'), 'Autodetect|uz');
  assert.equal(u.searchParams.get('de'), 'bot@example.com');
});

const APPLE = [
  {
    word: 'apple',
    phonetic: '/ˈæp.əl/',
    phonetics: [
      { text: '/ˈæp.əl/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/apple-uk.mp3' },
      { text: '/ˈæp.əl/', audio: 'https://api.dictionaryapi.dev/media/pronunciations/en/apple-us.mp3' },
    ],
  },
];

test('pronunciation extraction prefers US audio', () => {
  assert.deepEqual(extractPronunciation(APPLE), {
    phonetic: '/ˈæp.əl/',
    audio_url: 'https://api.dictionaryapi.dev/media/pronunciations/en/apple-us.mp3',
  });
  assert.deepEqual(extractPronunciation([{ phonetics: [{ text: '/ˈbɒɹəʊ/', audio: '' }, { audio: '//ssl.gstatic.com/x-uk.mp3' }] }]), {
    phonetic: '/ˈbɒɹəʊ/',
    audio_url: 'https://ssl.gstatic.com/x-uk.mp3',
  });
  assert.equal(extractPronunciation([{ phonetics: [] }]), null);
  assert.equal(extractPronunciation({ title: 'No Definitions Found' }), null);
});

test('dictionary client', async () => {
  const seen = [];
  const fetch = async (url) => {
    seen.push(decodeURIComponent(url.split('/').pop()));
    if (url.endsWith('/apple')) return response(200, APPLE);
    if (url.endsWith('/busy')) return response(429, {});
    return response(404, { title: 'No Definitions Found' });
  };
  const lookup = createDictionary({ fetch });
  assert.equal((await lookup('Apple')).phonetic, '/ˈæp.əl/');
  assert.equal(await lookup('qwzx'), null);
  assert.equal(await lookup('яблоко'), null); // not looked up at all
  await assert.rejects(lookup('busy'), /429/);
  assert.deepEqual(seen, ['apple', 'qwzx', 'busy']);
});

test('englishCandidate', () => {
  assert.equal(englishCandidate('to borrow'), 'borrow');
  assert.equal(englishCandidate('The Weather'), 'weather');
  assert.equal(englishCandidate('give up'), 'give up');
  assert.equal(englishCandidate("don't"), "don't");
  assert.equal(englishCandidate('ob-havo'), 'ob-havo');
  assert.equal(englishCandidate('яблоко'), null);
  assert.equal(englishCandidate('a very long phrase here'), null);
  assert.equal(englishCandidate('word123'), null);
});

test('mapLimit keeps order and limits concurrency', async () => {
  let active = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (x) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return x * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.equal(peak, 2);
});
