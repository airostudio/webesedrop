import type { SupabaseClient } from "@supabase/supabase-js";
import { AliExpressClient } from "../aliexpress/client";

/** Builds an AliExpressClient using a store's own connected AliExpress account, persisting rotated tokens back to aliexpress_connections when the client refreshes them. */
export async function getClientForStore(db: SupabaseClient, storeId: string): Promise<AliExpressClient> {
  const { data, error } = await db
    .from("aliexpress_connections")
    .select("app_key, app_secret, access_token, refresh_token")
    .eq("store_id", storeId)
    .single();
  if (error || !data || !data.access_token || !data.refresh_token) {
    throw new Error(`Store ${storeId} has no connected AliExpress account — complete the OAuth flow first`);
  }

  return new AliExpressClient({
    appKey: data.app_key as string,
    appSecret: data.app_secret as string,
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    onTokenRefreshed: async (tokens) => {
      await db
        .from("aliexpress_connections")
        .update({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken })
        .eq("store_id", storeId);
    },
  });
}
