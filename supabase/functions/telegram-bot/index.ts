// WordLearning Telegram bot — Supabase Edge Function.
//
//   POST /functions/v1/telegram-bot                 Telegram webhook (checked with a secret token)
//   POST /functions/v1/telegram-bot?action=tick     every minute from pg_cron: sets up the webhook once
//                                                   BOT_TOKEN exists, sends reminders, looks up pronunciations
//   POST /functions/v1/telegram-bot?action=simulate self-test with fake Telegram + test users (negative ids)
//   GET  /functions/v1/telegram-bot                 health check
//
// tick/simulate require the x-cron-secret header (stored in public.app_state, readable only by the database owner
// and the service role). The only secret you have to add is BOT_TOKEN (Dashboard → Edge Functions → Secrets).
//
// The code in ./lib is generated from bot/src and js/srs.js by `npm run build:edge` (in bot/).
// deno-lint-ignore-file no-explicit-any
import { webhookCallback } from 'grammy';
import { createBot } from './lib/bot.js';
import { createSupabaseDb } from './lib/db/supabase.js';
import { enrichCards, sendReminders } from './lib/reminders.js';
import { ensureWebhook } from './lib/setup.js';
import { createDictionary, createTranslator } from './lib/translate.js';

const VERSION = '2026-11-04.2';
const FUNCTION_NAME = 'telegram-bot';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '');
const WEBHOOK_URL = Deno.env.get('WEBHOOK_URL') ?? `${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`;

function numberEnv(name: string, fallback: number): number {
  const v = Number(Deno.env.get(name));
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const GAP_MIN = numberEnv('REMINDER_GAP_MINUTES', 180);
const IDLE_MIN = numberEnv('REMINDER_IDLE_MINUTES', 20);

/** New-style secret key (sb_secret_…) if the project has one, otherwise the legacy service_role key. */
function serviceKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const key = keys.default ?? Object.values(keys)[0];
    if (typeof key === 'string' && key) return key;
  } catch {
    // fall through
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const db = createSupabaseDb(SUPABASE_URL, serviceKey());
const translator = createTranslator({ email: Deno.env.get('MYMEMORY_EMAIL') });
const dictionary = createDictionary();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

type Live = { token: string; bot: any; handle: (req: Request) => Promise<Response>; secret: string; tokenId: string };
let live: Live | null = null;

/** The bot for the current BOT_TOKEN (rebuilt automatically if the token changes). */
async function getLive(): Promise<Live | null> {
  const token = (Deno.env.get('BOT_TOKEN') ?? '').trim();
  if (!token) return null;
  if (live?.token === token) return live;
  const secret = await sha256Hex(`webhook:${token}`);
  const tokenId = (await sha256Hex(`id:${token}`)).slice(0, 16);
  const bot = createBot(token, db, { translator, dictionary });
  const handle = webhookCallback(bot, 'std/http', { secretToken: secret, timeoutMilliseconds: 50_000 }) as any;
  live = { token, bot, handle, secret, tokenId };
  return live;
}

async function cronAuthorized(req: Request): Promise<boolean> {
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!given) return false;
  const state = await db.getAppState('cron');
  return typeof state?.secret === 'string' && safeEqual(given, state.secret);
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function tick() {
  const out: Record<string, unknown> = { ok: true, configured: false };
  try {
    out.enrich = await enrichCards(db, dictionary, { limit: 25 });
  } catch (e) {
    out.enrich_error = errorText(e);
  }
  const l = await getLive();
  if (l) {
    out.configured = true;
    try {
      const r = await ensureWebhook(l.bot.api, db, { url: WEBHOOK_URL, secretToken: l.secret, tokenId: l.tokenId });
      out.webhook = r.action;
    } catch (e) {
      out.ok = false;
      out.webhook_error = errorText(e);
      console.error('Webhook setup failed:', e);
    }
    try {
      out.reminders = await sendReminders(l.bot.api, db, { now: Date.now(), gapMin: GAP_MIN, idleMin: IDLE_MIN });
    } catch (e) {
      out.ok = false;
      out.reminders_error = errorText(e);
      console.error('Reminders failed:', e);
    }
  }
  // Last result, readable with: select value from app_state where key = 'tick_status';
  try {
    await db.setAppState('tick_status', { at: new Date().toISOString(), ...out });
  } catch (e) {
    console.error('Could not save tick status:', e);
  }
  return out;
}

const TEST_BOT_INFO = {
  id: 1,
  is_bot: true,
  first_name: 'WordLearning (simulation)',
  username: 'wordlearning_simulation_bot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
};

/** Runs updates through the real bot code and database with a fake Telegram API. Test users only. */
async function simulate(body: any) {
  const updates: any[] = Array.isArray(body?.updates) ? body.updates : [];
  for (const u of updates) {
    const from = u?.message?.from ?? u?.callback_query?.from;
    if (!from || !(Number(from.id) < 0)) throw new Error('simulate accepts only test users (negative ids)');
  }
  const calls: any[] = [];
  const errors: string[] = [];
  const bot = createBot('0:SIMULATION', db, {
    translator,
    dictionary,
    botInfo: TEST_BOT_INFO,
    onError: (err: any) => errors.push(String(err?.error?.stack ?? err?.error ?? err)),
  });
  let messageId = 1000;
  bot.api.config.use((async (_prev: unknown, method: string, payload: any) => {
    calls.push({ method, payload });
    const result = method.startsWith('send')
      ? { message_id: ++messageId, date: Math.floor(Date.now() / 1000), chat: { id: payload.chat_id, type: 'private' }, text: payload.text }
      : true;
    return { ok: true, result };
  }) as any);
  for (const u of updates) await bot.handleUpdate(u);
  const reminders = body?.reminders
    ? await sendReminders(bot.api, db, { now: Date.now(), gapMin: Number(body.gapMin ?? 0), idleMin: Number(body.idleMin ?? 0), test: true, pauseMs: 0 })
    : null;
  const enrich = body?.enrich ? await enrichCards(db, dictionary, { limit: 25 }) : null;
  return { ok: errors.length === 0, calls, errors, reminders, enrich };
}

Deno.serve(async (req: Request) => {
  const action = new URL(req.url).searchParams.get('action');
  try {
    if (action === 'tick' || action === 'simulate') {
      if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
      if (!(await cronAuthorized(req))) return json({ ok: false, error: 'unauthorized' }, 401);
      return json(action === 'tick' ? await tick() : await simulate(await req.json()));
    }
    if (req.method === 'POST') {
      const l = await getLive();
      if (!l) return json({ ok: false, error: 'BOT_TOKEN is not set' }, 503);
      return await l.handle(req);
    }
    return json({ ok: true, service: 'wordlearning-bot', version: VERSION, configured: Boolean(Deno.env.get('BOT_TOKEN')) });
  } catch (e) {
    console.error('Request failed:', e);
    return json({ ok: false, error: errorText(e) }, 500);
  }
});
