// GENERATED from js/srs.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
// Spaced-repetition scheduler. Pure functions only (no DOM, no storage),
// so it can be unit-tested with `node --test`.
//
// Model: every card has a `stage` = number of successful repetitions in a row.
// After a successful review the card is shown again after intervals[stage - 1].
//   Again -> stage 0, shown again in ~1 minute (relearn in the same session)
//   Hard  -> keep stage (at least 1), repeat the same interval
//   Good  -> stage + 1
//   Easy  -> stage + 2
// A card that reached the last stage is "mastered" but still gets reviewed
// at the longest interval so it is never forgotten.

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export const DEFAULT_INTERVALS = [
  10 * MINUTE,
  1 * DAY,
  3 * DAY,
  7 * DAY,
  14 * DAY,
  30 * DAY,
  60 * DAY,
  120 * DAY,
  240 * DAY,
];

export const AGAIN_DELAY = 1 * MINUTE;

export const GRADES = Object.freeze({ AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 });
export const GRADE_NAMES = ['Again', 'Hard', 'Good', 'Easy'];

let idCounter = 0;
export function makeId() {
  idCounter = (idCounter + 1) % 1e6;
  return Date.now().toString(36) + '-' + idCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function newCard({ word, translation, example = '', deckId = 'default' }, now = Date.now()) {
  return {
    id: makeId(),
    word: String(word).trim(),
    translation: String(translation).trim(),
    example: String(example || '').trim(),
    deckId,
    stage: 0,
    reps: 0,
    lapses: 0,
    due: now,
    createdAt: now,
    lastReviewed: null,
  };
}

/** Returns the next interval in ms and the new stage, without mutating. */
export function nextState(card, grade, intervals = DEFAULT_INTERVALS) {
  const max = intervals.length;
  const stage = card.stage || 0;
  let newStage;
  switch (grade) {
    case GRADES.AGAIN:
      return { stage: 0, interval: AGAIN_DELAY };
    case GRADES.HARD:
      newStage = Math.max(stage, 1);
      break;
    case GRADES.GOOD:
      newStage = stage + 1;
      break;
    case GRADES.EASY:
      newStage = stage + 2;
      break;
    default:
      throw new Error('Unknown grade: ' + grade);
  }
  newStage = Math.min(newStage, max);
  return { stage: newStage, interval: intervals[newStage - 1] };
}

/** Applies a review and returns an updated copy of the card. */
export function schedule(card, grade, now = Date.now(), intervals = DEFAULT_INTERVALS) {
  const { stage, interval } = nextState(card, grade, intervals);
  const lapsed = grade === GRADES.AGAIN && (card.stage || 0) >= 2;
  return {
    ...card,
    stage,
    reps: (card.reps || 0) + 1,
    lapses: (card.lapses || 0) + (lapsed ? 1 : 0),
    due: now + interval,
    lastReviewed: now,
  };
}

/** Interval each grade button would produce, for button labels. */
export function previewIntervals(card, intervals = DEFAULT_INTERVALS) {
  return [GRADES.AGAIN, GRADES.HARD, GRADES.GOOD, GRADES.EASY].map(
    (g) => nextState(card, g, intervals).interval,
  );
}

export function isNew(card) {
  return (card.reps || 0) === 0;
}

export function isDue(card, now = Date.now()) {
  return !isNew(card) && card.due <= now;
}

export function cardStatus(card, intervals = DEFAULT_INTERVALS) {
  if (isNew(card)) return 'new';
  if (card.stage >= intervals.length) return 'mastered';
  if (card.stage >= 4) return 'known';
  return 'learning';
}

/** Due cards (already learned once) sorted by how overdue they are. */
export function getDueCards(cards, now = Date.now()) {
  return cards.filter((c) => isDue(c, now)).sort((a, b) => a.due - b.due);
}

export function getNewCards(cards, limit = Infinity) {
  return cards
    .filter(isNew)
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, Math.max(0, limit));
}

/** Counts of cards that become due on each of the next `days` days (day 0 = today incl. overdue). */
export function forecast(cards, now = Date.now(), days = 7) {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const base = startOfToday.getTime();
  const out = new Array(days).fill(0);
  for (const c of cards) {
    if (isNew(c)) continue;
    const idx = c.due <= now ? 0 : Math.floor((c.due - base) / DAY);
    if (idx >= 0 && idx < days) out[idx]++;
  }
  return out;
}

const UNITS = [
  ['y', 365 * DAY],
  ['mo', 30 * DAY],
  ['w', 7 * DAY],
  ['d', DAY],
  ['h', HOUR],
  ['m', MINUTE],
];

export function formatInterval(ms) {
  if (ms < MINUTE) return '<1m';
  for (const [unit, size] of UNITS) {
    if (unit === 'w') continue; // keep days for readability ("14d" rather than "2w")
    if (ms >= size) {
      const v = ms / size;
      const rounded = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
      return rounded + unit;
    }
  }
  return '<1m';
}

/** Parses "10m", "1d", "1.5h", "2w", "3mo", "1y". Returns ms or NaN. */
export function parseInterval(str) {
  const m = String(str).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(mo|y|w|d|h|m)$/);
  if (!m) return NaN;
  const size = UNITS.find(([u]) => u === m[2])[1];
  return Math.round(parseFloat(m[1]) * size);
}

/** Parses a comma-separated list of intervals; throws on invalid or non-increasing input. */
export function parseIntervalList(str) {
  const parts = String(str).split(/[,\s]+/).filter(Boolean);
  if (parts.length === 0) throw new Error('Enter at least one interval');
  const list = parts.map((p) => {
    const v = parseInterval(p);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid interval "${p}" (use e.g. 10m, 1d, 2w, 3mo)`);
    return v;
  });
  for (let i = 1; i < list.length; i++) {
    if (list[i] <= list[i - 1]) throw new Error('Intervals must increase');
  }
  return list;
}

/** Edit distance, used to accept small typos in typing mode. */
export function levenshtein(a, b) {
  a = a || '';
  b = b || '';
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function normalizeAnswer(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grades a typed answer. `expected` may hold several variants separated
 * by "," ";" or "/" — matching any of them counts.
 * Returns GOOD (exact), HARD (small typo) or AGAIN (wrong).
 */
export function gradeTypedAnswer(input, expected) {
  const given = normalizeAnswer(input);
  if (!given) return GRADES.AGAIN;
  const variants = String(expected)
    .split(/[,;/]/)
    .map(normalizeAnswer)
    .filter(Boolean);
  if (variants.includes(given)) return GRADES.GOOD;
  for (const v of variants) {
    const allowed = v.length <= 4 ? 0 : v.length <= 8 ? 1 : 2;
    if (allowed > 0 && levenshtein(given, v) <= allowed) return GRADES.HARD;
  }
  return GRADES.AGAIN;
}

/**
 * Parses bulk text: one word per line, "word - translation - example".
 * Separators: tab, " - ", " — ", "=", ";" or ",".
 */
export function parseBulk(text) {
  const result = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let parts;
    for (const sep of ['\t', ' — ', ' – ', ' - ', '=', ';', ',']) {
      if (line.includes(sep)) {
        parts = line.split(sep).map((s) => s.trim());
        break;
      }
    }
    if (!parts || parts.length < 2 || !parts[0] || !parts[1]) continue;
    result.push({ word: parts[0], translation: parts[1], example: parts.slice(2).join(' ').trim() });
  }
  return result;
}
