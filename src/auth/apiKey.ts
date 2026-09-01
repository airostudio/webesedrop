import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const API_KEY_PREFIX = "dse_"; // dropship-engine

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString("hex")}`;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export interface AuthenticatedStore {
  id: string;
  name: string;
  slug: string;
}

/** Verifies the `Authorization: Bearer <apiKey>` header against stores.api_key_hash. Returns null on any failure (missing header, unknown key, inactive store) — callers respond 401. */
export async function authenticateStore(db: SupabaseClient, authorizationHeader: string | undefined): Promise<AuthenticatedStore | null> {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const apiKey = authorizationHeader.slice("Bearer ".length).trim();
  if (!apiKey.startsWith(API_KEY_PREFIX)) return null;

  const { data, error } = await db
    .from("stores")
    .select("id, name, slug, is_active")
    .eq("api_key_hash", hashApiKey(apiKey))
    .maybeSingle();

  if (error || !data || !data.is_active) return null;
  return { id: data.id as string, name: data.name as string, slug: data.slug as string };
}
