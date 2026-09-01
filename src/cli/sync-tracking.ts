// One-off run of tracking sync for every active store. pnpm sync:tracking
import { getDb } from "../db/client";
import { runTrackingSyncForAllStores } from "../domain/sync";

async function main() {
  const summaries = await runTrackingSyncForAllStores(getDb());
  for (const s of summaries) console.log(JSON.stringify(s));
  process.exit(summaries.some((s) => s.errors.length > 0) ? 1 : 0);
}

main().catch((err) => {
  console.error("[sync:tracking] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
