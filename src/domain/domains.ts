import type { SupabaseClient } from "@supabase/supabase-js";

export type DomainSource = "manual" | "webhook_url" | "origin_header";

function normalizeDomain(input: string): string | null {
  try {
    const withScheme = input.includes("://") ? input : `https://${input}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Upserts a (store, domain) sighting — first_seen_at is set once on
 * insert, last_seen_at bumps on every call. This is the whole "log of
 * every domain it's installed on": called from the webhook-registration
 * route, an explicit domain-declaration route, and best-effort off the
 * Origin/Referer header on authenticated requests.
 */
export async function recordDomainSighting(db: SupabaseClient, storeId: string, rawDomain: string, source: DomainSource): Promise<void> {
  const domain = normalizeDomain(rawDomain);
  if (!domain) return;

  const now = new Date().toISOString();
  const { data: existing } = await db.from("store_domains").select("id").eq("store_id", storeId).eq("domain", domain).maybeSingle();

  if (existing) {
    await db.from("store_domains").update({ last_seen_at: now, is_active: true }).eq("id", existing.id);
    return;
  }

  await db.from("store_domains").insert({ store_id: storeId, domain, source, first_seen_at: now, last_seen_at: now, is_active: true });
}

export interface DomainLogEntry {
  id: string;
  storeId: string;
  storeName: string;
  domain: string;
  source: DomainSource;
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
}

/** The full cross-store domain log for the admin "every domain it's installed on" view. */
export async function listAllDomains(db: SupabaseClient, filters?: { storeId?: string; domain?: string }): Promise<DomainLogEntry[]> {
  const { data: domains } = await db.from("store_domains").select("id, store_id, domain, source, first_seen_at, last_seen_at, is_active");
  const { data: stores } = await db.from("stores").select("id, name");
  const storeNameById = new Map((stores ?? []).map((s: any) => [s.id, s.name as string]));

  return (domains ?? [])
    .filter((row: any) => (filters?.storeId ? row.store_id === filters.storeId : true))
    .filter((row: any) => (filters?.domain ? (row.domain as string).includes(filters.domain) : true))
    .map((row: any) => ({
      id: row.id,
      storeId: row.store_id,
      storeName: storeNameById.get(row.store_id) ?? "Unknown store",
      domain: row.domain,
      source: row.source,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      isActive: row.is_active,
    }))
    .sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : -1));
}

export async function listDomainsForStore(db: SupabaseClient, storeId: string): Promise<DomainLogEntry[]> {
  return listAllDomains(db, { storeId });
}
