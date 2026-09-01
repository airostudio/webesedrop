import Fastify, { type FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateStore, type AuthenticatedStore } from "../auth/apiKey";
import { registerAliExpressRoutes } from "./routes/aliexpress";
import { registerProductRoutes } from "./routes/products";
import { registerOrderRoutes } from "./routes/orders";
import { registerConfigRoutes } from "./routes/config";
import { registerSyncRoutes } from "./routes/sync";

declare module "fastify" {
  interface FastifyRequest {
    store: AuthenticatedStore;
  }
}

export function buildServer(db: SupabaseClient): FastifyInstance {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });

  app.get("/v1/health", async () => ({ status: "ok" }));

  // Every /v1/* route except /v1/health requires a store API key.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/v1/health" || !request.url.startsWith("/v1/")) return;
    const store = await authenticateStore(db, request.headers.authorization);
    if (!store) {
      reply.code(401).send({ error: "Missing or invalid API key. Send `Authorization: Bearer <apiKey>`." });
      return reply;
    }
    request.store = store;
  });

  registerAliExpressRoutes(app, db);
  registerProductRoutes(app, db);
  registerOrderRoutes(app, db);
  registerConfigRoutes(app, db);
  registerSyncRoutes(app, db);

  return app;
}
