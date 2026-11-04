import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTranslator, splitArticle, stripArticle, hasArticle, langOf, mapLimit } from '../src/translate.js';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('MyMemory: picks a usable candidate in the target language', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams.get('q');
    if (q === 'Haus') return response(200, { responseStatus: 200, responseData: { translatedText: 'Дом ' } });
    if (q === 'дом')
      return response(200, {
        responseStatus: 200,
        responseData: { translatedText: '   WOHNSITZ' },
        matches: [{ translation: 'WOHNSITZ' }, { translation: 'дом' }, { translation: 'ein Zuhause' }, { translation: 'Haus' }],
      });
    if (q === 'same') return response(200, { responseStatus: 200, responseData: { translatedText: 'Same' } });
    if (q === 'quota') return response(200, { responseStatus: 429, quotaFinished: true, responseData: { translatedText: 'MYMEMORY WARNING' } });
    if (q === 'quote') return response(200, { responseStatus: 200, responseData: { translatedText: 'это &amp; то' } });
    return response(500, {});
  };
  const translate = createTranslator({ fetch, email: 'bot@example.com' });
  assert.equal(await translate('Haus', 'ru', 'de'), 'дом'); // trimmed, lower-cased Russian noun
  assert.equal(await translate('дом', 'de', 'ru'), 'ein Zuhause'); // shouting and wrong-script candidates skipped
  assert.equal(await translate('same', 'de', 'ru'), null);
  assert.equal(await translate('quota', 'ru', 'de'), null);
  assert.equal(await translate('quote', 'ru', 'de'), 'это & то');
  await assert.rejects(translate('error', 'ru', 'de'), /HTTP 500/);
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get('langpair'), 'de|ru');
  assert.equal(u.searchParams.get('de'), 'bot@example.com');
});

test('language and article helpers', () => {
  assert.equal(langOf('Haus'), 'de');
  assert.equal(langOf('дом'), 'ru');
  assert.equal(langOf('ob-havo'), 'de');
  assert.deepEqual(splitArticle('Das Haus'), { article: 'das', rest: 'Haus' });
  assert.deepEqual(splitArticle('Haus'), { article: '', rest: 'Haus' });
  assert.equal(stripArticle('die Katze'), 'Katze');
  assert.equal(stripArticle('Diesel'), 'Diesel');
  assert.equal(hasArticle('der Hund'), true);
  assert.equal(hasArticle('derb'), false);
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
