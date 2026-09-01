import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-db";
import { listAllDomains, listDomainsForStore, recordDomainSighting } from "../domains";

describe("domains", () => {
  it("records a new domain sighting with first_seen_at and last_seen_at set", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: "store-1", name: "Beach Footprints" }]);

    await recordDomainSighting(db, "store-1", "https://beachfootprints.com/webhooks/dropship-engine", "webhook_url");

    const rows = db.rows("store_domains");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store_id: "store-1", domain: "beachfootprints.com", source: "webhook_url", is_active: true });
    expect(rows[0].first_seen_at).toBe(rows[0].last_seen_at);
  });

  it("normalizes a bare hostname (no scheme) the same way as a full URL", async () => {
    const db = new FakeSupabase() as any;
    await recordDomainSighting(db, "store-1", "shop.example.com", "manual");
    expect(db.rows("store_domains")[0].domain).toBe("shop.example.com");
  });

  it("bumps last_seen_at on a repeat sighting instead of creating a duplicate row", async () => {
    const db = new FakeSupabase() as any;
    await recordDomainSighting(db, "store-1", "https://beachfootprints.com", "origin_header");
    const firstSeenAt = db.rows("store_domains")[0].first_seen_at;

    await new Promise((r) => setTimeout(r, 5));
    await recordDomainSighting(db, "store-1", "https://beachfootprints.com", "origin_header");

    const rows = db.rows("store_domains");
    expect(rows).toHaveLength(1);
    expect(rows[0].first_seen_at).toBe(firstSeenAt);
    expect(rows[0].last_seen_at).not.toBe(firstSeenAt);
  });

  it("ignores an unparseable domain rather than throwing", async () => {
    const db = new FakeSupabase() as any;
    await expect(recordDomainSighting(db, "store-1", "", "manual")).resolves.toBeUndefined();
    expect(db.rows("store_domains")).toHaveLength(0);
  });

  it("lists domains across every store, newest last_seen_at first, joined with store name", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [
      { id: "store-1", name: "Beach Footprints" },
      { id: "store-2", name: "Trail Trekkers" },
    ]);
    db.seed("store_domains", [
      { id: "d1", store_id: "store-1", domain: "beachfootprints.com", source: "webhook_url", first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-01T00:00:00Z", is_active: true },
      { id: "d2", store_id: "store-2", domain: "trailtrekkers.com", source: "manual", first_seen_at: "2026-02-01T00:00:00Z", last_seen_at: "2026-02-01T00:00:00Z", is_active: true },
    ]);

    const all = await listAllDomains(db);
    expect(all.map((d) => d.domain)).toEqual(["trailtrekkers.com", "beachfootprints.com"]);
    expect(all[0].storeName).toBe("Trail Trekkers");

    const forStore1 = await listDomainsForStore(db, "store-1");
    expect(forStore1).toHaveLength(1);
    expect(forStore1[0].domain).toBe("beachfootprints.com");
  });
});
