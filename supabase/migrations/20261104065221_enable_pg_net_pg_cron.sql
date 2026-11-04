-- HTTP requests from Postgres (used by the scheduled job to call the bot's Edge Function)
create extension if not exists pg_net with schema extensions;
-- Job scheduler (runs the reminder check every minute)
create extension if not exists pg_cron;
