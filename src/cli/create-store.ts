// Provisions a new connected store and prints its API key ONCE (only the
// hash is stored — there is no way to recover a lost key, only reissue one).
// Not a public API endpoint on purpose: store creation is an operator
// action, not something any caller with an API key should be able to do.
//
//   pnpm create-store -- --name="Beach Footprints" --slug=beach-footprints
import { getDb } from "../db/client";
import { generateApiKey, hashApiKey } from "../auth/apiKey";

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
  const apiKey = generateApiKey();
  const { data, error } = await db
    .from("stores")
    .insert({ name: args.name, slug: args.slug, api_key_hash: hashApiKey(apiKey) })
    .select("id")
    .single();
  if (error || !data) {
    console.error("Could not create store:", error?.message);
    process.exit(1);
  }

  console.log(`Store created: ${data.id}`);
  console.log(`\nAPI key (shown once — store it now):\n${apiKey}`);
  console.log(`\nUse it as: Authorization: Bearer ${apiKey}`);
}

main().catch((err) => {
  console.error("[create-store] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
