// GENERATED from bot/src/setup.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
// Connects the bot to Telegram: webhook (for the Supabase deployment), command menu and
// profile texts. Runs from the every-minute background tick, so after the BOT_TOKEN secret is
// added (or the texts change) the bot configures itself without any manual step.
import { t, COMMANDS } from './i18n.js';

/** Bump when commands/descriptions change so they are re-sent to Telegram. */
export const SETUP_VERSION = 2;
const RECHECK_MS = 60 * 60 * 1000; // verify the webhook once an hour

// [Telegram language_code (undefined = everyone else), interface language]
const PROFILES = [
  [undefined, 'ru'],
  ['ru', 'ru'],
  ['de', 'de'],
];
// Language-specific texts left over from earlier versions of the bot.
const LEGACY_CODES = ['uz', 'en'];

/** Sets commands, description and short description for every interface language. */
export async function setupProfile(api) {
  for (const [code, lang] of PROFILES) {
    const other = code ? { language_code: code } : {};
    const commands = COMMANDS[lang].map(([command, description]) => ({ command, description }));
    await api.setMyCommands(commands, other);
    await api.setMyDescription(t(lang, 'description'), other);
    await api.setMyShortDescription(t(lang, 'short_description'), other);
  }
  for (const code of LEGACY_CODES) {
    await api.deleteMyCommands({ language_code: code });
    await api.setMyDescription('', { language_code: code });
    await api.setMyShortDescription('', { language_code: code });
  }
}

/**
 * Makes sure Telegram delivers updates to `url` with our secret token.
 * Cheap when nothing changed: only reads app_state; talks to Telegram at most once an hour.
 * Returns { action: 'none' | 'checked' | 'set', info? }.
 */
export async function ensureWebhook(api, db, { url, secretToken, tokenId, now = Date.now() }) {
  const st = await db.getAppState('webhook');
  const sameToken = st && st.token_id === tokenId && st.url === url;
  const sameSetup = sameToken && st.version === SETUP_VERSION;
  if (sameSetup && now - (st.checked_at ?? 0) < RECHECK_MS) return { action: 'none' };

  const info = await api.getWebhookInfo();
  // A recent 401 means Telegram is sending a different secret than we expect.
  const recentAuthError = /401|403/.test(info.last_error_message ?? '') && now / 1000 - (info.last_error_date ?? 0) < 3600;
  let action = 'checked';
  if (!sameToken || info.url !== url || recentAuthError) {
    await api.setWebhook(url, {
      secret_token: secretToken,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 40,
    });
    action = 'set';
  }
  if (!sameSetup) {
    await setupProfile(api);
    action = 'set';
  }
  await db.setAppState('webhook', {
    token_id: tokenId,
    url,
    version: SETUP_VERSION,
    checked_at: now,
    pending_update_count: info.pending_update_count ?? 0,
    last_error: info.last_error_message ?? null,
  });
  return { action, info };
}
