import http from 'node:http';
import { createBot, COMMANDS } from './bot.js';
import { createSupabaseDb } from './db/supabase.js';
import { createMemoryDb } from './db/memory.js';
import { startReminderLoop } from './reminders.js';

try {
  process.loadEnvFile(); // reads .env if present (Node >= 20.12)
} catch {}

const env = process.env;
function required(name) {
  if (!env[name]) {
    console.error(`Missing environment variable ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return env[name];
}

const token = required('BOT_TOKEN');
let db;
if (env.DB === 'memory') {
  console.warn('⚠️  DB=memory: data is kept in RAM and lost on restart (for local testing only).');
  db = createMemoryDb();
} else {
  db = createSupabaseDb(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'));
}

const bot = createBot(token, db);
await bot.api.setMyCommands(COMMANDS.map(([command, description]) => ({ command, description })));

const stopReminders = startReminderLoop(bot.api, db, {
  everySec: Number(env.REMINDER_CHECK_SECONDS || 60),
  gapMin: Number(env.REMINDER_GAP_MINUTES || 180),
  idleMin: Number(env.REMINDER_IDLE_MINUTES || 20),
});

// Optional health-check endpoint for hosts that expect a web port (Render, Railway, Fly.io…).
let server;
if (env.PORT) {
  server = http.createServer((_req, res) => res.end('ok')).listen(Number(env.PORT));
}

const shutdown = async () => {
  stopReminders();
  server?.close();
  await bot.stop();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

await bot.start({
  allowed_updates: ['message', 'callback_query'],
  onStart: (me) => console.log(`✅ Bot @${me.username} is running`),
});
