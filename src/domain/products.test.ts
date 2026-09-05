import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "../aliexpress/client";
import { createMapping, importProduct, setMappingActive } from "./products";
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

  it("quotes AliExpress in the store's configured currency and destination", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [
      {
        id: STORE_ID,
        name: "Beach Footprints",
        brand_voice: null,
        settings: { import: { defaultStatus: "draft", targetCurrency: "AUD", shipToCountry: "AU" } },
      },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });

    // The /sync gateway carries params in the form-encoded body, not the URL.
    const body = String(fetchImpl.mock.calls[0][1].body);
    expect(body).toContain("target_currency=AUD");
    expect(body).toContain("ship_to_country=AU");
  });

  it("prices with the store's configured markup rule rather than the engine default", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [
      {
        id: STORE_ID,
        name: "Beach Footprints",
        brand_voice: null,
        settings: { pricing: { rule: { type: "percent_margin", marginRate: 1.0, rounding: "none" } } },
      },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });
    const inStock = result.skus.find((s) => s.aliexpressSkuId === "12000030123456789")!;
    expect(inStock.retailPriceCents).toBe(3200); // 1600 cost at 100% markup, unrounded
  });

  it("returns shipping weight, unit and structured variant options for the store to use", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints", brand_voice: null }]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });

    expect(result.packageWeightGrams).toBe(350); // 0.35 kg in the fixture
    expect(result.productUnit).toBe("piece");
    expect(result.skus[0].options.map((o) => o.value)).toEqual(["Blue", "M"]);
  });

  it("extracts the supplier's specification table, appending units to the value", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints", brand_voice: null }]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });

    expect(result.attributes).toEqual([
      { name: "Material", value: "Rayon" },
      { name: "Style", value: "Bohemian" },
      { name: "Sleeve Length", value: "34 cm" },
    ]);
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

  it("clamps retail price to the store's configured min/max bounds", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints", brand_voice: null, settings: { pricing: { minPriceCents: 3000 } } }]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });
    const inStock = result.skus.find((s) => s.aliexpressSkuId === "12000030123456789")!;
    expect(inStock.retailPriceCents).toBe(3000); // 2195 unclamped, floor raises it to 3000
  });

  it("computes a compare-at price when the store configured a compareAtRule", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [
      {
        id: STORE_ID,
        name: "Beach Footprints",
        brand_voice: null,
        settings: { pricing: { compareAtRule: { type: "percent_margin", marginRate: 0.6, rounding: "up-99" } } },
      },
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });
    const inStock = result.skus.find((s) => s.aliexpressSkuId === "12000030123456789")!;
    expect(inStock.compareAtPriceCents).not.toBeNull();
    expect(inStock.compareAtPriceCents!).toBeGreaterThan(inStock.retailPriceCents);
  });

  it("leaves compareAtPriceCents null when no compareAtRule is configured", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints", brand_voice: null }]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await importProduct(db, client, { storeId: STORE_ID, aliexpressProductId: "1005006123456" });
    expect(result.skus[0].compareAtPriceCents).toBeNull();
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

  it("clamps and applies compare-at pricing from the store's settings", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [
      { id: STORE_ID, name: "Beach Footprints", settings: { pricing: { maxPriceCents: 2000, compareAtRule: { type: "percent_margin", marginRate: 1, rounding: "none" } } } },
    ]);
    db.seed("ae_products", [{ aliexpress_product_id: "1005006123456", subject: "x" }]);
    db.seed("ae_product_skus", [{ aliexpress_product_id: "1005006123456", aliexpress_sku_id: "sku-1", supplier_cost_cents: 1600 }]);

    const result = await createMapping(db, {
      storeId: STORE_ID,
      externalProductId: "prod-1",
      externalVariantId: "var-1",
      aliexpressProductId: "1005006123456",
      aliexpressSkuId: "sku-1",
    });

    expect(result.retailPriceCents).toBe(2000); // 2195 unclamped, ceiling caps it to 2000
    expect(result.compareAtPriceCents).toBe(2000); // 3200 unclamped (100% margin), ceiling caps it too
  });

  it("throws for an unknown SKU rather than creating a mapping to nothing", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, name: "Beach Footprints" }]);

    await expect(
      createMapping(db, { storeId: STORE_ID, externalProductId: "p", externalVariantId: "v", aliexpressProductId: "missing", aliexpressSkuId: "missing" }),
    ).rejects.toThrow(/Unknown AliExpress SKU/);
  });
});

describe("setMappingActive", () => {
  it("deactivates a mapping — removing it from the shop", async () => {
    const db = new FakeSupabase() as any;
    db.seed("product_mappings", [{ id: "mapping-1", store_id: STORE_ID, is_active: true }]);

    const result = await setMappingActive(db, STORE_ID, "mapping-1", false);

    expect(result).toEqual({ id: "mapping-1", isActive: false });
    expect(db.rows("product_mappings")[0].is_active).toBe(false);
  });

  it("reactivates a mapping — adding it back into the shop", async () => {
    const db = new FakeSupabase() as any;
    db.seed("product_mappings", [{ id: "mapping-1", store_id: STORE_ID, is_active: false }]);

    const result = await setMappingActive(db, STORE_ID, "mapping-1", true);
    expect(result.isActive).toBe(true);
  });

  it("throws rather than touching a mapping owned by a different store", async () => {
    const db = new FakeSupabase() as any;
    db.seed("product_mappings", [{ id: "mapping-1", store_id: "other-store", is_active: true }]);

    await expect(setMappingActive(db, STORE_ID, "mapping-1", false)).rejects.toThrow(/not found/i);
    expect(db.rows("product_mappings")[0].is_active).toBe(true);
  });

  it("throws for an unknown mapping id", async () => {
    const db = new FakeSupabase() as any;
    await expect(setMappingActive(db, STORE_ID, "does-not-exist", false)).rejects.toThrow(/not found/i);
  });
});
