// Admin auth is intentionally separate from per-store API keys (src/auth/apiKey.ts)
// — this is the engine operator's own key, not any connected store's, and
// it must never be checked against the stores table. A single shared
// secret is a deliberate v1 choice (see README "What's next, not built
// here"); swap for real per-operator accounts before opening this up to
// more than one person.

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function authenticateAdmin(authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader?.startsWith("Bearer ")) return false;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token.length > 0 && token === requireEnv("ADMIN_API_KEY");
}
