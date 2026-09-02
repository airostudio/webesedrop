import type { SupabaseClient } from "@supabase/supabase-js";
import { generateApiKey, hashApiKey } from "../auth/apiKey";

export interface CreateStoreResult {
  id: string;
  name: string;
  slug: string;
  /** Shown once — only the hash is persisted, there is no way to recover a lost key, only reissue one. */
  apiKey: string;
}

/** Provisions a new connected store. Shared by the CLI (pnpm create-store) and POST /v1/admin/stores. */
export async function createStore(db: SupabaseClient, params: { name: string; slug: string }): Promise<CreateStoreResult> {
  const apiKey = generateApiKey();
  const { data, error } = await db
    .from("stores")
    .insert({ name: params.name, slug: params.slug, api_key_hash: hashApiKey(apiKey) })
    .select("id, name, slug")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create store");

  return { id: data.id as string, name: data.name as string, slug: data.slug as string, apiKey };
}
