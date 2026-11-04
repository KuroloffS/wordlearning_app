// Copies the shared bot code into supabase/functions/telegram-bot/lib so the Supabase Edge Function
// is self-contained (the Supabase CLI and the dashboard only upload the function's own folder).
//
//   npm run build:edge          write the files
//   npm run build:edge -- --check   exit 1 if the generated files are out of date
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'supabase', 'functions', 'telegram-bot', 'lib');

// [source (relative to repo root), target (relative to lib/)]
export const EDGE_FILES = [
  ['js/srs.js', 'srs.js'],
  ['bot/src/bot.js', 'bot.js'],
  ['bot/src/i18n.js', 'i18n.js'],
  ['bot/src/time.js', 'time.js'],
  ['bot/src/samples.js', 'samples.js'],
  ['bot/src/reminders.js', 'reminders.js'],
  ['bot/src/setup.js', 'setup.js'],
  ['bot/src/translate.js', 'translate.js'],
  ['bot/src/dictionary.js', 'dictionary.js'],
  ['bot/src/db/supabase.js', 'db/supabase.js'],
];

/** Returns { 'lib-relative path': content } for all generated files. */
export function buildEdgeFiles() {
  const out = {};
  for (const [src, target] of EDGE_FILES) {
    let code = readFileSync(join(ROOT, src), 'utf8');
    // bot/src/* import the scheduler as ../../js/srs.js; in lib/ it sits next to them.
    code = code.replaceAll("'../../js/srs.js'", "'./srs.js'").replaceAll("'../../../js/srs.js'", "'../srs.js'");
    out[target] = `// GENERATED from ${src} by bot/scripts/build-edge.mjs — edit the source file, then run \`npm run build:edge\` in bot/.\n${code}`;
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = buildEdgeFiles();
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [rel, content] of Object.entries(files)) {
    const path = join(OUT, rel);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    stale++;
    if (check) {
      console.error(`out of date: supabase/functions/telegram-bot/lib/${rel}`);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      console.log(`wrote supabase/functions/telegram-bot/lib/${rel}`);
    }
  }
  if (check && stale) {
    console.error('Run `npm run build:edge` in bot/.');
    process.exit(1);
  }
  if (!stale) console.log('Edge Function files are up to date.');
}
