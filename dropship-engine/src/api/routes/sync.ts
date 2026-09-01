import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getClientForStore } from "../../domain/connection";
import { runCatalogSync, runTrackingSync } from "../../domain/sync";

/** On-demand versions of the scheduled jobs (see src/worker/index.ts for the daily/every-5h cadence) — for an admin "sync now" button, run synchronously and return the summary. */
export function registerSyncRoutes(app: FastifyInstance, db: SupabaseClient): void {
  app.post("/v1/sync/catalog", async (request, reply) => {
    try {
      const client = await getClientForStore(db, request.store.id);
      return await runCatalogSync(db, client, request.store.id);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Catalog sync failed" });
    }
  });

  app.post("/v1/sync/tracking", async (request, reply) => {
    try {
      const client = await getClientForStore(db, request.store.id);
      return await runTrackingSync(db, client, request.store.id);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Tracking sync failed" });
    }
  });
}
