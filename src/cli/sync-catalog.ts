// One-off run of the catalog sync for every active store (the same work the
// scheduled worker does daily). pnpm sync:catalog
import { getDb } from "../db/client";
import { runCatalogSyncForAllStores } from "../domain/sync";

async function main() {
  const summaries = await runCatalogSyncForAllStores(getDb());
  for (const s of summaries) console.log(JSON.stringify(s));
  process.exit(summaries.some((s) => s.errors.length > 0) ? 1 : 0);
}

main().catch((err) => {
  console.error("[sync:catalog] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
