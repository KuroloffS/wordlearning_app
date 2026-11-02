// Persistence in localStorage. All data stays on the user's device.
import { DEFAULT_INTERVALS } from './srs.js';

const KEY = 'wordlearning:v1';

export const DEFAULT_SETTINGS = {
  intervals: DEFAULT_INTERVALS,
  newPerDay: 20,
  mode: 'flip', // flip | type | choice
  direction: 'forward', // forward | reverse | mixed
  speakLang: 'en-US',
  autoSpeak: false,
  notifications: false,
  theme: 'auto',
};

function emptyState() {
  return {
    version: 1,
    decks: [{ id: 'default', name: 'My words' }],
    cards: [],
    settings: { ...DEFAULT_SETTINGS },
    log: {}, // 'YYYY-MM-DD' -> { reviews, correct, learned }
  };
}

export function todayKey(now = Date.now()) {
  const d = new Date(now);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function normalizeState(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const state = {
    ...base,
    ...raw,
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
    log: raw.log && typeof raw.log === 'object' ? raw.log : {},
  };
  if (!Array.isArray(state.decks) || state.decks.length === 0) state.decks = base.decks;
  if (!Array.isArray(state.cards)) state.cards = [];
  state.cards = state.cards.filter((c) => c && c.id && c.word);
  if (!Array.isArray(state.settings.intervals) || state.settings.intervals.length === 0) {
    state.settings.intervals = DEFAULT_INTERVALS;
  }
  return state;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.warn('Could not load saved data', e);
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Could not save data', e);
    return false;
  }
}

export function logReview(state, { correct, learnedNew }, now = Date.now()) {
  const k = todayKey(now);
  const entry = state.log[k] || { reviews: 0, correct: 0, learned: 0 };
  entry.reviews++;
  if (correct) entry.correct++;
  if (learnedNew) entry.learned++;
  state.log[k] = entry;
}

export function streak(log, now = Date.now()) {
  let count = 0;
  const d = new Date(now);
  // Today not studied yet doesn't break the streak.
  if (!log[todayKey(d.getTime())]) d.setDate(d.getDate() - 1);
  while (log[todayKey(d.getTime())]) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}
