import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADES, DAY, MINUTE, DEFAULT_INTERVALS, AGAIN_DELAY,
  newCard, schedule, previewIntervals, getDueCards, getNewCards, cardStatus,
  formatInterval, parseInterval, parseIntervalList, gradeTypedAnswer, parseBulk, forecast,
} from '../js/srs.js';

const T0 = new Date('2026-01-01T12:00:00').getTime();

test('new card is not due until first learned', () => {
  const c = newCard({ word: 'apple', translation: 'яблоко' }, T0);
  assert.equal(cardStatus(c), 'new');
  assert.deepEqual(getDueCards([c], T0 + DAY), []);
  assert.equal(getNewCards([c]).length, 1);
});

test('Good walks through the interval ladder', () => {
  let c = newCard({ word: 'a', translation: 'b' }, T0);
  let t = T0;
  for (let i = 0; i < DEFAULT_INTERVALS.length; i++) {
    c = schedule(c, GRADES.GOOD, t);
    assert.equal(c.stage, i + 1);
    assert.equal(c.due - t, DEFAULT_INTERVALS[i]);
    t = c.due;
  }
  assert.equal(cardStatus(c), 'mastered');
  // Stays at the longest interval afterwards.
  c = schedule(c, GRADES.GOOD, t);
  assert.equal(c.due - t, DEFAULT_INTERVALS.at(-1));
});

test('Again resets and counts a lapse for learned cards', () => {
  let c = newCard({ word: 'a', translation: 'b' }, T0);
  c = schedule(c, GRADES.GOOD, T0);
  c = schedule(c, GRADES.GOOD, T0);
  c = schedule(c, GRADES.AGAIN, T0);
  assert.equal(c.stage, 0);
  assert.equal(c.lapses, 1);
  assert.equal(c.due, T0 + AGAIN_DELAY);
  assert.equal(cardStatus(c), 'learning');
});

test('Hard repeats the same interval, Easy skips one', () => {
  let c = { ...newCard({ word: 'a', translation: 'b' }, T0), stage: 3, reps: 3 };
  assert.equal(schedule(c, GRADES.HARD, T0).due - T0, DEFAULT_INTERVALS[2]);
  assert.equal(schedule(c, GRADES.EASY, T0).due - T0, DEFAULT_INTERVALS[4]);
  const fresh = newCard({ word: 'a', translation: 'b' }, T0);
  assert.deepEqual(previewIntervals(fresh), [AGAIN_DELAY, 10 * MINUTE, 10 * MINUTE, DAY]);
});

test('due cards sorted by most overdue', () => {
  const a = { ...newCard({ word: 'a', translation: 'x' }, T0), reps: 1, due: T0 - 10 };
  const b = { ...newCard({ word: 'b', translation: 'y' }, T0), reps: 1, due: T0 - 100 };
  const c = { ...newCard({ word: 'c', translation: 'z' }, T0), reps: 1, due: T0 + 100 };
  assert.deepEqual(getDueCards([a, b, c], T0).map((x) => x.word), ['b', 'a']);
});

test('forecast buckets by day', () => {
  const mk = (due) => ({ ...newCard({ word: 'w', translation: 't' }, T0), reps: 1, due });
  const f = forecast([mk(T0 - DAY), mk(T0 + DAY), mk(T0 + 2 * DAY), mk(T0 + 30 * DAY)], T0, 7);
  assert.deepEqual(f, [1, 1, 1, 0, 0, 0, 0]);
});

test('interval parsing and formatting', () => {
  assert.equal(parseInterval('10m'), 10 * MINUTE);
  assert.equal(parseInterval('2w'), 14 * DAY);
  assert.equal(parseInterval('1.5d'), 1.5 * DAY);
  assert.ok(Number.isNaN(parseInterval('abc')));
  assert.deepEqual(parseIntervalList('10m, 1d 3d'), [10 * MINUTE, DAY, 3 * DAY]);
  assert.throws(() => parseIntervalList('1d, 1h'), /increase/);
  assert.throws(() => parseIntervalList('1x'), /Invalid/);
  assert.equal(formatInterval(10 * MINUTE), '10m');
  assert.equal(formatInterval(3 * DAY), '3d');
  assert.equal(formatInterval(60 * DAY), '2mo');
  // Round trip of the defaults.
  assert.deepEqual(parseIntervalList(DEFAULT_INTERVALS.map(formatInterval).join(',')), DEFAULT_INTERVALS);
});

test('typed answers: variants, case, accents, typos', () => {
  assert.equal(gradeTypedAnswer('Яблоко', 'яблоко'), GRADES.GOOD);
  assert.equal(gradeTypedAnswer('brать взаймы', 'занимать, брать взаймы'), GRADES.HARD);
  assert.equal(gradeTypedAnswer('занимать', 'занимать, брать взаймы'), GRADES.GOOD);
  assert.equal(gradeTypedAnswer('cafe', 'café'), GRADES.GOOD);
  assert.equal(gradeTypedAnswer('libary', 'library'), GRADES.HARD);
  assert.equal(gradeTypedAnswer('cat', 'dog'), GRADES.AGAIN);
  assert.equal(gradeTypedAnswer('', 'dog'), GRADES.AGAIN);
  assert.equal(gradeTypedAnswer('ca', 'cat'), GRADES.AGAIN); // short words must be exact
});

test('bulk parsing', () => {
  const r = parseBulk('apple - яблоко - An apple a day\n\n# comment\nhouse\tдом\ncar=машина\nbad line');
  assert.deepEqual(r, [
    { word: 'apple', translation: 'яблоко', example: 'An apple a day' },
    { word: 'house', translation: 'дом', example: '' },
    { word: 'car', translation: 'машина', example: '' },
  ]);
});
