import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startOfLocalDay, localHour, inQuietHours, parseOffset, formatOffset, streakFromDays, localDayKey } from '../src/time.js';
import { DAY } from '../../js/srs.js';

test('local day and hour with offsets', () => {
  const t = Date.UTC(2026, 0, 5, 21, 30); // 02:30 next day in UTC+5
  assert.equal(localHour(t, 300), 2);
  assert.equal(localDayKey(t, 300), '2026-01-06');
  assert.equal(startOfLocalDay(t, 300), Date.UTC(2026, 0, 5, 19, 0));
  assert.equal(localHour(t, -240), 17);
});

test('quiet hours', () => {
  assert.equal(inQuietHours(23, 23, 8), true);
  assert.equal(inQuietHours(3, 23, 8), true);
  assert.equal(inQuietHours(8, 23, 8), false);
  assert.equal(inQuietHours(12, 0, 9), false);
  assert.equal(inQuietHours(5, 0, 9), true);
  assert.equal(inQuietHours(5, 0, 0), false);
});

test('offset parsing', () => {
  assert.equal(parseOffset('+5'), 300);
  assert.equal(parseOffset('UTC+5:30'), 330);
  assert.equal(parseOffset('-4'), -240);
  assert.equal(parseOffset('gmt 3'), 180);
  assert.equal(parseOffset('15'), null);
  assert.equal(parseOffset('x'), null);
  assert.equal(formatOffset(330), 'UTC+5:30');
  assert.equal(formatOffset(-240), 'UTC-4');
});

test('streak', () => {
  const now = Date.UTC(2026, 0, 10, 12);
  assert.equal(streakFromDays(['2026-01-10', '2026-01-09', '2026-01-08', '2026-01-06'], now, 0), 3);
  assert.equal(streakFromDays(['2026-01-09', '2026-01-08'], now, 0), 2); // today not studied yet
  assert.equal(streakFromDays(['2026-01-07'], now, 0), 0);
  assert.equal(streakFromDays([], now + DAY, 0), 0);
});
