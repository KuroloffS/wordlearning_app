import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS, LANGS, MENU, COMMANDS, t, fmtInterval, pickLang, pickLearn, count } from '../src/i18n.js';
import { samplesFor, SAMPLE_PAIRS } from '../src/samples.js';
import { buildEdgeFiles } from '../scripts/build-edge.mjs';

test('the interface languages are Russian and German', () => {
  assert.deepEqual(LANGS, ['ru', 'de']);
});

test('every text exists in both languages with the same parameters', () => {
  for (const [key, entry] of Object.entries(STRINGS)) {
    assert.deepEqual(Object.keys(entry).sort(), ['de', 'ru'], `${key} must have exactly ru and de`);
    assert.equal(typeof entry.de, typeof entry.ru, `${key}: type differs`);
    if (typeof entry.ru === 'function') assert.equal(entry.de.length, entry.ru.length, `${key}: arity differs`);
  }
  assert.deepEqual(Object.keys(MENU.de), Object.keys(MENU.ru));
  assert.deepEqual(COMMANDS.de.map((c) => c[0]), COMMANDS.ru.map((c) => c[0]));
});

test('Telegram limits for commands and profile texts', () => {
  for (const lang of LANGS) {
    for (const [cmd, desc] of COMMANDS[lang]) {
      assert.match(cmd, /^[a-z0-9_]{1,32}$/);
      assert.ok(desc.length >= 1 && desc.length <= 256);
    }
    assert.ok(t(lang, 'description').length <= 512, `description too long for ${lang}`);
    assert.ok(t(lang, 'short_description').length <= 120, `short description too long for ${lang}`);
  }
});

test('menu labels never mean different things in different languages', () => {
  const seen = new Map();
  for (const lang of LANGS) {
    for (const [key, label] of Object.entries(MENU[lang])) {
      if (seen.has(label)) assert.equal(seen.get(label), key);
      seen.set(label, key);
    }
  }
});

test('language detection, plurals, intervals', () => {
  assert.equal(pickLang('de'), 'de');
  assert.equal(pickLang('de-AT'), 'de');
  assert.equal(pickLang('ru'), 'ru');
  assert.equal(pickLang('uz'), 'ru');
  assert.equal(pickLang(undefined), 'ru');
  assert.equal(pickLearn('ru'), 'de');
  assert.equal(pickLearn('de'), 'ru');
  assert.equal(count('ru', 'word', 1), '1 слово');
  assert.equal(count('ru', 'word', 4), '4 слова');
  assert.equal(count('ru', 'word', 12), '12 слов');
  assert.equal(count('de', 'word', 1), '1 Wort');
  assert.equal(count('de', 'word', 3), '3 Wörter');
  assert.equal(count('de', 'day', 2), '2 Tage');
  assert.equal(fmtInterval('ru', 36 * 3600 * 1000), '1,5 д');
  assert.equal(fmtInterval('de', 600000), '10 Min.');
  assert.equal(fmtInterval('de', 3 * 86400000), '3 Tg.');
});

test('sample words are German ↔ Russian in both directions', () => {
  assert.equal(SAMPLE_PAIRS.length, 12);
  assert.deepEqual(samplesFor('de')[0], { word: 'das Haus', translation: 'дом', example: 'Das Haus ist groß.' });
  assert.deepEqual(samplesFor('ru')[0], { word: 'дом', translation: 'das Haus', example: 'Дом большой.' });
});

test('user input is HTML-escaped', () => {
  assert.match(t('ru', 'greet', '<script>'), /&lt;script&gt;/);
  assert.match(t('de', 'find_none', 'a & b'), /a &amp; b/);
});

test('the Edge Function copy of the bot code is up to date (run `npm run build:edge`)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'functions', 'telegram-bot', 'lib');
  for (const [rel, content] of Object.entries(buildEdgeFiles())) {
    assert.equal(readFileSync(join(root, rel), 'utf8'), content, `lib/${rel} is out of date`);
  }
});
