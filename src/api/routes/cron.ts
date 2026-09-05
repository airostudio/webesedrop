import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runCatalogSyncForAllStores, runTrackingSyncForAllStores } from "../../domain/sync";

/**
 * Cron-triggered versions of the scheduled jobs, for deployments where
 * there's no long-lived process to run src/worker/index.ts's BullMQ
 * scheduler (e.g. Vercel — see vercel.json's "crons"). Protected by
 * CRON_SECRET, not a store API key: these run for every active store, not
 * one authenticated caller's store, the same as the worker does.
 *
 * On Vercel, requests to a configured cron path are automatically sent with
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set — these
 * routes just verify that header matches.
 */
export function registerCronRoutes(app: FastifyInstance, db: SupabaseClient): void {
  function verifyCronSecret(authorizationHeader: string | undefined): boolean {
    const secret = process.env.CRON_SECRET;
    return Boolean(secret) && authorizationHeader === `Bearer ${secret}`;
  }

  app.get("/internal/cron/catalog-sync", async (request, reply) => {
    if (!verifyCronSecret(request.headers.authorization)) return reply.code(401).send({ error: "Invalid or missing CRON_SECRET" });
    return runCatalogSyncForAllStores(db);
  });

  app.get("/internal/cron/tracking-sync", async (request, reply) => {
    if (!verifyCronSecret(request.headers.authorization)) return reply.code(401).send({ error: "Invalid or missing CRON_SECRET" });
    return runTrackingSyncForAllStores(db);
  });
}
