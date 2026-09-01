import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { getDb } from "../db/client";
import { runCatalogSyncForAllStores, runTrackingSyncForAllStores } from "../domain/sync";

const CATALOG_SYNC_QUEUE = "dropship-catalog-sync";
const TRACKING_SYNC_QUEUE = "dropship-tracking-sync";

function connectionFromEnv(): ConnectionOptions {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required to run the scheduled sync workers");
  return { url } as unknown as ConnectionOptions;
}

async function main() {
  if (!process.env.REDIS_URL) {
    console.log("dropship-engine worker: REDIS_URL not set — scheduled catalog/tracking sync is not starting. Run pnpm run sync:catalog / sync:tracking for a one-off run instead.");
    return;
  }

  const connection = connectionFromEnv();
  const db = getDb();

  const catalogSyncQueue = new Queue(CATALOG_SYNC_QUEUE, { connection });
  const trackingSyncQueue = new Queue(TRACKING_SYNC_QUEUE, { connection });

  // Daily at 02:00 UTC, tracking every 5 hours (inside the usual 4-6 hour window).
  await catalogSyncQueue.add("daily-sync", {}, { repeat: { pattern: "0 2 * * *" }, removeOnComplete: 20, removeOnFail: 50 });
  await trackingSyncQueue.add("poll-tracking", {}, { repeat: { pattern: "0 */5 * * *" }, removeOnComplete: 20, removeOnFail: 50 });

  const catalogSyncWorker = new Worker(CATALOG_SYNC_QUEUE, () => runCatalogSyncForAllStores(db), { connection });
  const trackingSyncWorker = new Worker(TRACKING_SYNC_QUEUE, () => runTrackingSyncForAllStores(db), { connection });
  catalogSyncWorker.on("failed", (job, err) => console.error(`[catalog-sync] job ${job?.id} failed:`, err));
  trackingSyncWorker.on("failed", (job, err) => console.error(`[tracking-sync] job ${job?.id} failed:`, err));

  console.log("dropship-engine worker running: catalog sync daily @ 02:00 UTC, tracking sync every 5h.");

  const stop = async () => {
    await Promise.all([catalogSyncWorker.close(), trackingSyncWorker.close(), catalogSyncQueue.close(), trackingSyncQueue.close()]);
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
