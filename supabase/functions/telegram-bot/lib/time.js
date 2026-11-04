// GENERATED from bot/src/time.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
// Time helpers that work with a fixed UTC offset (in minutes) per user.
import { DAY, HOUR, MINUTE } from './srs.js';

/** Timestamp (ms) of local midnight for the day containing `now`. */
export function startOfLocalDay(now, offsetMin) {
  const off = offsetMin * MINUTE;
  return Math.floor((now + off) / DAY) * DAY - off;
}

export function localHour(now, offsetMin) {
  return Math.floor(((now + offsetMin * MINUTE) % DAY + DAY) % DAY / HOUR);
}

export function localDayKey(now, offsetMin) {
  return new Date(now + offsetMin * MINUTE).toISOString().slice(0, 10);
}

export function localTime(now, offsetMin) {
  return new Date(now + offsetMin * MINUTE).toISOString().slice(11, 16);
}

/** Quiet hours [start, end) in local hours; start === end means "off". Wraps past midnight. */
export function inQuietHours(hour, start, end) {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function formatOffset(offsetMin) {
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

/** Parses "+5", "-3", "5:30", "UTC+5:30", "GMT-4". Returns minutes or null. */
export function parseOffset(text) {
  const m = String(text).trim().toUpperCase().replace(/^(UTC|GMT)\s*/, '').match(/^([+-]?)(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const minutes = Number(m[2]) * 60 + Number(m[3] || 0);
  const value = m[1] === '-' ? -minutes : minutes;
  if (value < -720 || value > 840 || Number(m[3] || 0) >= 60) return null;
  return value;
}

/** Consecutive days (ending today, or yesterday if today has no reviews yet) present in `dayKeys`. */
export function streakFromDays(dayKeys, now, offsetMin) {
  const set = new Set(dayKeys);
  let t = now;
  if (!set.has(localDayKey(t, offsetMin))) t -= DAY;
  let count = 0;
  while (set.has(localDayKey(t, offsetMin))) {
    count++;
    t -= DAY;
  }
  return count;
}
