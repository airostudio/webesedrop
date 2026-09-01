import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/**
 * Browser/anon client — safe to use in client components. Subject to the
 * RLS policies in supabase/schema.sql (a signed-in customer can only see
 * their own rows; storefront reads are limited to published/active rows).
 */
export function createBrowserSupabaseClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}

/**
 * Service-role client — server-only, NEVER import this from a client
 * component or expose the key to the browser. Bypasses RLS entirely, so use
 * it only for trusted server-side writes: guest checkout, webhook handlers,
 * admin actions gated by your own auth checks.
 */
export function createServiceRoleSupabaseClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error("createServiceRoleSupabaseClient must only be called on the server");
  }
  return createClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}
