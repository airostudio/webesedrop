import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildAuthorizeUrl, exchangeAuthorizationCode } from "../../aliexpress/client";

const connectSchema = z.object({ appKey: z.string().min(1), appSecret: z.string().min(1) });
const callbackSchema = z.object({ code: z.string().min(1), redirectUri: z.string().min(1) });

/**
 * A store's own AliExpress Open Platform app (POST /v1/aliexpress/connection), if it registered
 * one — otherwise the engine's own platform app (ALIEXPRESS_APP_KEY/SECRET). Almost every store
 * uses the platform app: the store owner just logs into their own AliExpress account during the
 * OAuth redirect below, no developer-level app registration needed on their end.
 */
async function resolveApp(db: SupabaseClient, storeId: string): Promise<{ appKey: string; appSecret: string } | null> {
  const { data } = await db.from("aliexpress_connections").select("app_key, app_secret").eq("store_id", storeId).maybeSingle();
  if (data?.app_key && data?.app_secret) return { appKey: data.app_key as string, appSecret: data.app_secret as string };

  const { ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET } = process.env;
  if (ALIEXPRESS_APP_KEY && ALIEXPRESS_APP_SECRET) return { appKey: ALIEXPRESS_APP_KEY, appSecret: ALIEXPRESS_APP_SECRET };
  return null;
}

export function registerAliExpressRoutes(app: FastifyInstance, db: SupabaseClient): void {
  /**
   * Optional — only for a store that wants to use its own AliExpress Open Platform app instead
   * of the engine's shared one (e.g. it needs its own approved API rate limits). Most stores skip
   * this and go straight to GET /v1/aliexpress/authorize-url.
   */
  app.post("/v1/aliexpress/connection", async (request, reply) => {
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db
      .from("aliexpress_connections")
      .upsert({ store_id: request.store.id, app_key: parsed.data.appKey, app_secret: parsed.data.appSecret }, { onConflict: "store_id" });
    return { connected: false, message: "App credentials saved. Continue with GET /v1/aliexpress/authorize-url." };
  });

  /** Step 1 — get the AliExpress authorize URL to send the store owner to (they log in with their own AliExpress account). */
  app.get("/v1/aliexpress/authorize-url", async (request, reply) => {
    const redirectUri = (request.query as Record<string, string>).redirectUri;
    if (!redirectUri) return reply.code(400).send({ error: "Missing redirectUri query param" });

    const appCreds = await resolveApp(db, request.store.id);
    if (!appCreds) return reply.code(500).send({ error: "AliExpress is not configured on this engine — set ALIEXPRESS_APP_KEY/ALIEXPRESS_APP_SECRET" });

    return { authorizeUrl: buildAuthorizeUrl({ appKey: appCreds.appKey, redirectUri }) };
  });

  /** Step 2 — exchange the code AliExpress redirected back with for the store's own access/refresh tokens. */
  app.post("/v1/aliexpress/callback", async (request, reply) => {
    const parsed = callbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const appCreds = await resolveApp(db, request.store.id);
    if (!appCreds) return reply.code(500).send({ error: "AliExpress is not configured on this engine — set ALIEXPRESS_APP_KEY/ALIEXPRESS_APP_SECRET" });

    try {
      const tokens = await exchangeAuthorizationCode({
        appKey: appCreds.appKey,
        appSecret: appCreds.appSecret,
        code: parsed.data.code,
        redirectUri: parsed.data.redirectUri,
      });
      await db
        .from("aliexpress_connections")
        .upsert(
          {
            store_id: request.store.id,
            app_key: appCreds.appKey,
            app_secret: appCreds.appSecret,
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            connected_at: new Date().toISOString(),
          },
          { onConflict: "store_id" },
        );
      return { connected: true };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "AliExpress token exchange failed" });
    }
  });

  /** Whether this store currently has a connected AliExpress account — lets an admin UI show status without exposing tokens. */
  app.get("/v1/aliexpress/status", async (request) => {
    const { data } = await db
      .from("aliexpress_connections")
      .select("connected_at")
      .eq("store_id", request.store.id)
      .maybeSingle();
    return { connected: Boolean(data?.connected_at), connectedAt: data?.connected_at ?? null };
  });
}
