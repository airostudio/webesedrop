import Fastify, { type FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateStore, type AuthenticatedStore } from "../auth/apiKey";
import { authenticateAdmin } from "../auth/adminAuth";
import { recordDomainSighting } from "../domain/domains";
import { registerAliExpressRoutes } from "./routes/aliexpress";
import { registerProductRoutes } from "./routes/products";
import { registerOrderRoutes } from "./routes/orders";
import { registerConfigRoutes } from "./routes/config";
import { registerSyncRoutes } from "./routes/sync";
import { registerBillingRoutes } from "./routes/billing";
import { registerAdminRoutes } from "./routes/admin";
import { registerCronRoutes } from "./routes/cron";

declare module "fastify" {
  interface FastifyRequest {
    store: AuthenticatedStore;
    rawBody?: Buffer;
  }
}

// Public — no store or admin auth applies to these, ever.
const PUBLIC_PATHS = new Set(["/v1/health", "/v1/billing/webhook"]);

export function buildServer(db: SupabaseClient): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  // Captures the raw body for Stripe signature verification (POST /v1/billing/webhook)
  // without changing how every other route consumes JSON.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    const buffer = body as Buffer;
    try {
      done(null, buffer.length ? JSON.parse(buffer.toString("utf8")) : undefined);
    } catch (err) {
      done(err as Error, undefined);
      return;
    }
  });
  // Stash the pre-parse bytes for the webhook route (Stripe signs the exact raw
  // body), then hand the same bytes back downstream so JSON parsing still runs.
  app.addHook("preParsing", async (request, _reply, payload) => {
    if (request.url !== "/v1/billing/webhook") return payload;
    const chunks: Buffer[] = [];
    for await (const chunk of payload) chunks.push(chunk as Buffer);
    request.rawBody = Buffer.concat(chunks);
    const { Readable } = await import("node:stream");
    return Readable.from(request.rawBody);
  });

  app.get("/v1/health", async () => ({ status: "ok" }));

  app.addHook("onRequest", async (request, reply) => {
    if (PUBLIC_PATHS.has(request.url) || !request.url.startsWith("/v1/")) return;

    if (request.url.startsWith("/v1/admin/")) {
      if (!authenticateAdmin(request.headers.authorization)) {
        reply.code(401).send({ error: "Missing or invalid admin key. Send `Authorization: Bearer <ADMIN_API_KEY>`." });
        return reply;
      }
      return;
    }

    const store = await authenticateStore(db, request.headers.authorization);
    if (!store) {
      reply.code(401).send({ error: "Missing or invalid API key. Send `Authorization: Bearer <apiKey>`." });
      return reply;
    }
    request.store = store;

    // Best-effort domain capture off Origin/Referer — never blocks the request.
    const originHeader = request.headers.origin ?? request.headers.referer;
    if (originHeader) {
      recordDomainSighting(db, store.id, originHeader, "origin_header").catch(() => {});
    }
  });

  registerAliExpressRoutes(app, db);
  registerProductRoutes(app, db);
  registerOrderRoutes(app, db);
  registerConfigRoutes(app, db);
  registerSyncRoutes(app, db);
  registerBillingRoutes(app, db);
  registerAdminRoutes(app, db);
  registerCronRoutes(app, db);

  return app;
}
