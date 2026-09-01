import { describe, expect, it, vi } from "vitest";
import { fulfillOrder } from "./orders";
import { FakeSupabase } from "./__tests__/fake-db";
import orderCreateFixture from "../aliexpress/__fixtures__/order-create.json";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const STORE_ID = "store-1";

function seedStore(db: FakeSupabase) {
  db.seed("aliexpress_connections", [{ store_id: STORE_ID, app_key: "k", app_secret: "s", access_token: "a", refresh_token: "r" }]);
  db.seed("product_mappings", [{ id: "mapping-1", store_id: STORE_ID, external_variant_id: "variant-1", aliexpress_product_id: "1005006123456", aliexpress_sku_id: "sku-1" }]);
}

const ADDRESS = { fullName: "Jamie Rivera", line1: "1 Ocean Ave", city: "Santa Cruz", region: "CA", postalCode: "95060", country: "US", phone: "+14085551234" };

describe("fulfillOrder", () => {
  it("places the order and stores the AliExpress order id", async () => {
    const db = new FakeSupabase() as any;
    seedStore(db);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(orderCreateFixture));
    // Patch global fetch since getClientForStore builds its own AliExpressClient internally.
    vi.stubGlobal("fetch", fetchImpl);

    const result = await fulfillOrder(db, {
      storeId: STORE_ID,
      externalOrderId: "order-1",
      shippingAddress: ADDRESS,
      lineItems: [{ externalVariantId: "variant-1", quantity: 2 }],
    });

    expect(result.skipped).toBe(false);
    expect(result.aliexpressOrderId).toBe("8123456789012345");
    expect(db.rows("orders")[0].fulfillment_status).toBe("fulfillment_in_progress");
    expect(db.rows("sync_logs").some((l: any) => l.event === "order_placed")).toBe(true);

    vi.unstubAllGlobals();
  });

  it("is idempotent — a second call for the same externalOrderId does not place a duplicate order", async () => {
    const db = new FakeSupabase() as any;
    seedStore(db);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(orderCreateFixture));
    vi.stubGlobal("fetch", fetchImpl);

    await fulfillOrder(db, { storeId: STORE_ID, externalOrderId: "order-1", shippingAddress: ADDRESS, lineItems: [{ externalVariantId: "variant-1", quantity: 1 }] });
    const second = await fulfillOrder(db, { storeId: STORE_ID, externalOrderId: "order-1", shippingAddress: ADDRESS, lineItems: [{ externalVariantId: "variant-1", quantity: 1 }] });

    expect(second.skipped).toBe(true);
    expect(second.aliexpressOrderId).toBe("8123456789012345");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
