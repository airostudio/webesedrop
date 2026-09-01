import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "../aliexpress/client";
import { createMapping, importProduct } from "./products";
import { FakeSupabase } from "./__tests__/fake-db";
import productGetFixture from "../aliexpress/__fixtures__/product-get.json";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const CREDENTIALS = { appKey: "k", appSecret: "s", accessToken: "a", refreshToken: "r" };
const STORE_ID = "store-1";

describe("importProduct", () => {
  it("caches the AliExpress product/SKUs and returns on-brand, priced preview data", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints", brand_voice: null }]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });

    expect(result.skus).toHaveLength(2);
    const inStock = result.skus.find((s) => s.aliexpressSkuId === "12000030123456789")!;
    expect(inStock.supplierCostCents).toBe(1600);
    expect(inStock.retailPriceCents).toBe(2195); // default 35% margin, rounded to .95

    expect(db.rows("ae_products")).toHaveLength(1);
    expect(db.rows("ae_product_skus")).toHaveLength(2);
  });

  it("applies a neutral name when the store has no brand voice configured", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Generic Store", brand_voice: null }]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });
    expect(result.onBrandName.toLowerCase()).not.toContain("hot sale");
    expect(result.onBrandName.toLowerCase()).not.toContain("dropship");
  });
});

describe("createMapping", () => {
  it("prices a mapping from the cached SKU cost using the store's default rule", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints", brand_voice: null }]);
    db.seed("ae_products", [{ aliexpress_product_id: "1005006123456", subject: "x" }]);
    db.seed("ae_product_skus", [{ aliexpress_product_id: "1005006123456", aliexpress_sku_id: "sku-1", supplier_cost_cents: 1600 }]);

    const result = await createMapping(db, {
      storeId: STORE_ID,
      externalProductId: "prod-1",
      externalVariantId: "var-1",
      aliexpressProductId: "1005006123456",
      aliexpressSkuId: "sku-1",
    });

    expect(result.supplierCostCents).toBe(1600);
    expect(result.retailPriceCents).toBe(2195);
    expect(db.rows("product_mappings")).toHaveLength(1);
  });

  it("throws for an unknown SKU rather than creating a mapping to nothing", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints" }]);

    await expect(
      createMapping(db, { storeId: STORE_ID, externalProductId: "p", externalVariantId: "v", aliexpressProductId: "missing", aliexpressSkuId: "missing" }),
    ).rejects.toThrow(/Unknown AliExpress SKU/);
  });
});
