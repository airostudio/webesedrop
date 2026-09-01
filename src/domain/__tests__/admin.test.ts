import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./fake-db";
import { getOrdersTimeseries, getOverviewStats, getPlanBreakdown, getRevenueTimeseries, getStoreDetail, listInvoices, listStoresWithBilling } from "../admin";

function seedBaseline(db: FakeSupabase) {
  db.seed("stores", [
    { id: "store-1", name: "Beach Footprints", slug: "beach-footprints", is_active: true, created_at: "2026-01-01T00:00:00Z", webhook_url: "https://beachfootprints.com/hooks" },
    { id: "store-2", name: "Trail Trekkers", slug: "trail-trekkers", is_active: true, created_at: "2026-02-01T00:00:00Z", webhook_url: null },
  ]);
  db.seed("plans", [
    { id: "plan-pro", name: "Pro", slug: "pro", price_cents: 4900, billing_interval: "month", stripe_price_id: "price_pro", features: {}, is_active: true },
    { id: "plan-annual", name: "Annual", slug: "annual", price_cents: 24000, billing_interval: "year", stripe_price_id: "price_annual", features: {}, is_active: true },
  ]);
  db.seed("subscriptions", [
    { id: "sub-1", store_id: "store-1", plan_id: "plan-pro", status: "active", created_at: "2026-01-05T00:00:00Z" },
    { id: "sub-2", store_id: "store-2", plan_id: "plan-annual", status: "past_due", created_at: "2026-02-05T00:00:00Z" },
  ]);
  db.seed("store_domains", [
    { id: "d1", store_id: "store-1", domain: "beachfootprints.com", source: "webhook_url", first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: "2026-01-10T00:00:00Z", is_active: true },
    { id: "d2", store_id: "store-1", domain: "staging.beachfootprints.com", source: "manual", first_seen_at: "2026-01-02T00:00:00Z", last_seen_at: "2026-01-02T00:00:00Z", is_active: true },
  ]);
  db.seed("orders", [
    { id: "o1", store_id: "store-1", fulfillment_status: "delivered", created_at: "2026-01-10T00:00:00Z" },
    { id: "o2", store_id: "store-1", fulfillment_status: "unfulfilled", created_at: "2026-01-11T00:00:00Z" },
    { id: "o3", store_id: "store-2", fulfillment_status: "shipped", created_at: "2026-01-11T00:00:00Z" },
  ]);
  db.seed("invoices", [
    { id: "inv-1", store_id: "store-1", status: "paid", amount_due_cents: 4900, amount_paid_cents: 4900, currency: "usd", created_at: "2026-01-05T00:00:00Z", paid_at: "2026-01-05T00:00:00Z", hosted_invoice_url: null },
    { id: "inv-2", store_id: "store-2", status: "open", amount_due_cents: 24000, amount_paid_cents: 0, currency: "usd", created_at: "2026-02-05T00:00:00Z", paid_at: null, hosted_invoice_url: null },
  ]);
  db.seed("product_mappings", [{ id: "m1", store_id: "store-1" }]);
}

describe("admin: overview", () => {
  it("aggregates store, domain, subscription and invoice data into MRR-normalized stats", async () => {
    const db = new FakeSupabase() as any;
    seedBaseline(db);

    const overview = await getOverviewStats(db);
    expect(overview.totalStores).toBe(2);
    expect(overview.totalDomains).toBe(2);
    expect(overview.activeSubscriptions).toBe(1);
    expect(overview.pastDueSubscriptions).toBe(1);
    // 4900 (monthly) + 24000/12 = 2000 (annual normalized to monthly) = 6900
    expect(overview.mrrCents).toBe(6900);
  });
});

describe("admin: store list + detail", () => {
  it("lists stores with domain count, order count, and billing summary", async () => {
    const db = new FakeSupabase() as any;
    seedBaseline(db);

    const stores = await listStoresWithBilling(db);
    const store1 = stores.find((s) => s.id === "store-1")!;
    expect(store1.domainCount).toBe(2);
    expect(store1.orderCount).toBe(2);
    expect(store1.planName).toBe("Pro");
    expect(store1.mrrContributionCents).toBe(4900);

    const store2 = stores.find((s) => s.id === "store-2")!;
    expect(store2.subscriptionStatus).toBe("past_due");
    expect(store2.mrrContributionCents).toBe(2000);
  });

  it("drills down into a single store's domains, subscription, invoices, and order breakdown", async () => {
    const db = new FakeSupabase() as any;
    seedBaseline(db);

    const detail = await getStoreDetail(db, "store-1");
    expect(detail?.store.name).toBe("Beach Footprints");
    expect(detail?.domains).toHaveLength(2);
    expect(detail?.subscription?.planName).toBe("Pro");
    expect(detail?.invoices).toHaveLength(1);
    expect(detail?.ordersByStatus).toEqual({ delivered: 1, unfulfilled: 1 });
    expect(detail?.productMappingCount).toBe(1);
  });

  it("returns null for an unknown store", async () => {
    const db = new FakeSupabase() as any;
    expect(await getStoreDetail(db, "does-not-exist")).toBeNull();
  });
});

describe("admin: invoices + reports", () => {
  it("lists invoices joined with store name, filterable by status", async () => {
    const db = new FakeSupabase() as any;
    seedBaseline(db);

    expect(await listInvoices(db)).toHaveLength(2);
    const paidOnly = await listInvoices(db, { status: "paid" });
    expect(paidOnly).toHaveLength(1);
    expect(paidOnly[0].storeName).toBe("Beach Footprints");
  });

  it("buckets collected (paid) revenue by month", async () => {
    const db = new FakeSupabase() as any;
    seedBaseline(db);

    const points = await getRevenueTimeseries(db);
    expect(points).toEqual([{ month: "2026-01", collectedCents: 4900 }]);
  });

  it("buckets order counts by day", async () => {
    const db = new FakeSupabase() as any;
    seedBaseline(db);

    const points = await getOrdersTimeseries(db);
    expect(points).toEqual([
      { day: "2026-01-10", count: 1 },
      { day: "2026-01-11", count: 2 },
    ]);
  });

  it("breaks down current MRR by plan", async () => {
    const db = new FakeSupabase() as any;
    seedBaseline(db);

    const breakdown = await getPlanBreakdown(db);
    expect(breakdown).toEqual([
      { planId: "plan-pro", planName: "Pro", subscriberCount: 1, mrrCents: 4900 },
      { planId: "plan-annual", planName: "Annual", subscriberCount: 1, mrrCents: 2000 },
    ]);
  });
});
