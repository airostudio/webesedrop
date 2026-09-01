-- Makes aliexpress_connections.app_key/app_secret optional: most stores now
-- connect using the engine's own platform AliExpress app (ALIEXPRESS_APP_KEY/
-- ALIEXPRESS_APP_SECRET env vars) and only log into their own AliExpress
-- account during OAuth, instead of every store registering its own app.
-- Safe to run against an existing database that still has the NOT NULL
-- constraint from the original supabase/schema.sql.
alter table aliexpress_connections alter column app_key drop not null;
alter table aliexpress_connections alter column app_secret drop not null;
