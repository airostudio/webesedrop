import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let cached: SupabaseClient | undefined;

/**
 * Service-role client — this is the ONLY client the engine ever uses. There
 * is no anon/browser-facing client because nothing outside the engine's own
 * API process ever talks to this database directly (see supabase/schema.sql).
 */
export function getDb(): SupabaseClient {
  if (!cached) {
    cached = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });
  }
  return cached;
}
