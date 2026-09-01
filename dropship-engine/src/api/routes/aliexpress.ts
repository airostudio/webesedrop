import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { buildAuthorizeUrl, exchangeAuthorizationCode } from "../../aliexpress/client";

const connectSchema = z.object({ appKey: z.string().min(1), appSecret: z.string().min(1) });
const callbackSchema = z.object({ code: z.string().min(1), redirectUri: z.string().min(1) });

export function registerAliExpressRoutes(app: FastifyInstance, db: SupabaseClient): void {
  /** Step 0 — register this store's AliExpress Open Platform app credentials (from open.aliexpress.com) before the OAuth flow below. */
  app.post("/v1/aliexpress/connection", async (request, reply) => {
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db
      .from("aliexpress_connections")
      .upsert({ store_id: request.store.id, app_key: parsed.data.appKey, app_secret: parsed.data.appSecret }, { onConflict: "store_id" });
    return { connected: false, message: "App credentials saved. Continue with GET /v1/aliexpress/authorize-url." };
  });

  /** Step 1 — get the AliExpress authorize URL to send the store owner to. */
  app.get("/v1/aliexpress/authorize-url", async (request, reply) => {
    const redirectUri = (request.query as Record<string, string>).redirectUri;
    if (!redirectUri) return reply.code(400).send({ error: "Missing redirectUri query param" });

    const { data } = await db.from("aliexpress_connections").select("app_key").eq("store_id", request.store.id).maybeSingle();
    if (!data?.app_key) return reply.code(400).send({ error: "No AliExpress app credentials on file — POST /v1/aliexpress/connection first" });

    return { authorizeUrl: buildAuthorizeUrl({ appKey: data.app_key as string, redirectUri }) };
  });

  /** Step 2 — exchange the code AliExpress redirected back with for the store's access/refresh tokens. */
  app.post("/v1/aliexpress/callback", async (request, reply) => {
    const parsed = callbackSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { data } = await db.from("aliexpress_connections").select("app_key, app_secret").eq("store_id", request.store.id).maybeSingle();
    if (!data?.app_key || !data?.app_secret) return reply.code(400).send({ error: "No AliExpress app credentials on file — POST /v1/aliexpress/connection first" });

    try {
      const tokens = await exchangeAuthorizationCode({
        appKey: data.app_key as string,
        appSecret: data.app_secret as string,
        code: parsed.data.code,
        redirectUri: parsed.data.redirectUri,
      });
      await db
        .from("aliexpress_connections")
        .update({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken, connected_at: new Date().toISOString() })
        .eq("store_id", request.store.id);
      return { connected: true };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "AliExpress token exchange failed" });
    }
  });
}
