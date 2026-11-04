import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS, LANGS, MENU, COMMANDS, t, fmtInterval, pickLang, pickTranslateTo, count } from '../src/i18n.js';
import { buildEdgeFiles } from '../scripts/build-edge.mjs';

test('every text exists in every language with the same parameters', () => {
  for (const [key, entry] of Object.entries(STRINGS)) {
    for (const lang of LANGS) {
      assert.ok(entry[lang] !== undefined, `${key} missing for ${lang}`);
      assert.equal(typeof entry[lang], typeof entry.en, `${key}: type differs for ${lang}`);
      if (typeof entry.en === 'function') assert.equal(entry[lang].length, entry.en.length, `${key}: arity differs for ${lang}`);
    }
  }
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(MENU[lang]), Object.keys(MENU.en));
    assert.deepEqual(COMMANDS[lang].map((c) => c[0]), COMMANDS.en.map((c) => c[0]));
  }
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

test('button labels are unique across languages where they must be', () => {
  // A menu label must not mean different things in different languages.
  const seen = new Map();
  for (const lang of LANGS) {
    for (const [key, label] of Object.entries(MENU[lang])) {
      if (seen.has(label)) assert.equal(seen.get(label), key);
      seen.set(label, key);
    }
  }
});

test('language detection and plurals', () => {
  assert.equal(pickLang('uz'), 'uz');
  assert.equal(pickLang('ru-RU'), 'ru');
  assert.equal(pickLang('kk'), 'ru');
  assert.equal(pickLang('de'), 'en');
  assert.equal(pickLang(undefined), 'en');
  assert.equal(pickTranslateTo('uz'), 'uz');
  assert.equal(pickTranslateTo('en-GB'), null);
  assert.equal(pickTranslateTo(''), null);
  assert.equal(count('ru', 'word', 1), '1 слово');
  assert.equal(count('ru', 'word', 4), '4 слова');
  assert.equal(count('ru', 'word', 12), '12 слов');
  assert.equal(count('ru', 'day', 22), '22 дня');
  assert.equal(count('en', 'day', 1), '1 day');
  assert.equal(count('uz', 'word', 5), '5 ta soʻz');
  assert.equal(fmtInterval('ru', 36 * 3600 * 1000), '1,5 д');
  assert.equal(fmtInterval('uz', 600000), '10 daq');
  assert.equal(fmtInterval('en', 600000), '10m');
});

test('user input is HTML-escaped', () => {
  assert.match(t('en', 'greet', '<script>'), /&lt;script&gt;/);
  assert.match(t('ru', 'find_none', 'a & b'), /a &amp; b/);
});

test('the Edge Function copy of the bot code is up to date (run `npm run build:edge`)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'functions', 'telegram-bot', 'lib');
  for (const [rel, content] of Object.entries(buildEdgeFiles())) {
    assert.equal(readFileSync(join(root, rel), 'utf8'), content, `lib/${rel} is out of date`);
  }
});
