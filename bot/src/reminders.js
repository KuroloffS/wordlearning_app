// Periodically messages users whose words are due for review.
import { InlineKeyboard, GrammyError } from 'grammy';
import { localHour, inQuietHours } from './time.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One reminder pass. Returns the number of reminders sent.
 * gapMin  – minimum minutes between two reminders to the same user
 * idleMin – don't remind users who used the bot in the last N minutes (they're studying already)
 */
export async function sendReminders(api, db, { now = Date.now(), gapMin = 180, idleMin = 20 } = {}) {
  const rows = await db.dueUsers(now, gapMin, idleMin);
  let sent = 0;
  for (const r of rows) {
    if (inQuietHours(localHour(now, r.tz_offset_min), r.quiet_start, r.quiet_end)) continue;
    const n = Number(r.due_count);
    try {
      await api.sendMessage(
        r.user_id,
        `🔔 Time to repeat! <b>${n}</b> word${n === 1 ? ' is' : 's are'} waiting for review.\n\nRepeat them now, before you forget 🧠`,
        { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('▶️ Start review', 'review') },
      );
      sent++;
      await db.updateUser(r.user_id, { last_notified_at: now });
    } catch (e) {
      if (e instanceof GrammyError && (e.error_code === 403 || e.error_code === 400)) {
        // User blocked the bot or deleted the chat: stop reminding them.
        await db.updateUser(r.user_id, { remind: false });
      } else if (e instanceof GrammyError && e.error_code === 429) {
        await sleep((e.parameters?.retry_after ?? 5) * 1000);
      } else {
        console.error('Reminder failed for', r.user_id, e);
      }
    }
    await sleep(50); // stay well below Telegram's ~30 messages/second limit
  }
  return sent;
}

export function startReminderLoop(api, db, { everySec = 60, gapMin, idleMin } = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await sendReminders(api, db, { now: Date.now(), gapMin, idleMin });
      if (n) console.log(`Sent ${n} reminder(s)`);
    } catch (e) {
      console.error('Reminder pass failed:', e.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everySec * 1000);
  tick();
  return () => clearInterval(timer);
}
