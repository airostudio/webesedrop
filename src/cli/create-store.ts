// Provisions a new connected store and prints its API key ONCE (only the
// hash is stored — there is no way to recover a lost key, only reissue one).
// Operator action, not something any store's own API key can do — either run
// this locally against the engine's Supabase project, or use the equivalent
// ADMIN_API_KEY-gated POST /v1/admin/stores if you'd rather not run the CLI.
//
//   pnpm create-store -- --name="Beach Footprints" --slug=beach-footprints
import { getDb } from "../db/client";
import { createStore } from "../domain/stores";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    if (value !== undefined) args[key] = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name || !args.slug) {
    console.error('Usage: pnpm create-store -- --name="Store Name" --slug=store-slug');
    process.exit(1);
  }

  const db = getDb();
  const store = await createStore(db, { name: args.name, slug: args.slug });

  console.log(`Store created: ${store.id}`);
  console.log(`\nAPI key (shown once — store it now):\n${store.apiKey}`);
  console.log(`\nUse it as: Authorization: Bearer ${store.apiKey}`);
}

main().catch((err) => {
  console.error("[create-store] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
