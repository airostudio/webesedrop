import { describe, expect, it, vi } from "vitest";
import { AliExpressClient } from "../aliexpress/client";
import { runCatalogSync } from "./sync";
import { FakeSupabase } from "./__tests__/fake-db";
import productGetFixture from "../aliexpress/__fixtures__/product-get.json";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const CREDENTIALS = { appKey: "k", appSecret: "s", accessToken: "a", refreshToken: "r" };
const STORE_ID = "store-1";

describe("runCatalogSync", () => {
  it("logs a price change and fires a webhook when supplier cost shifts", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, webhook_url: "https://store.example.com/webhooks/dropship", webhook_secret: "a-very-long-webhook-secret" }]);
    db.seed("product_mappings", [
      { id: "mapping-1", store_id: STORE_ID, external_product_id: "product-1", external_variant_id: "variant-1", aliexpress_product_id: "1005006123456", aliexpress_sku_id: "12000030123456789", pricing_rule_id: null, supplier_cost_cents: 1600, retail_price_cents: 2195, is_active: true },
    ]);

    const raised = JSON.parse(JSON.stringify(productGetFixture));
    raised.aliexpress_ds_product_get_response.result.ae_item_sku_info_dtos.ae_item_sku_info_d_t_o[0].sku_price = "18.00";

    const aliexpressFetch = vi.fn().mockResolvedValue(jsonResponse(raised));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl: aliexpressFetch });
    const webhookFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", webhookFetch); // deliverWebhook uses the global fetch

    const summary = await runCatalogSync(db, client, STORE_ID);

    expect(summary.priceChanges).toBe(1);
    expect(db.rows("product_price_log")).toHaveLength(1);
    expect(db.rows("product_price_log")[0].new_cost_cents).toBe(1800);
    expect(webhookFetch).toHaveBeenCalledTimes(1);
    const [url, init] = webhookFetch.mock.calls[0];
    expect(url).toBe("https://store.example.com/webhooks/dropship");
    expect(init.headers["X-Dropship-Event"]).toBe("product.price_changed");
    const payload = JSON.parse(init.body);
    expect(payload.data.externalVariantId).toBe("variant-1");
    expect(payload.data.externalProductId).toBe("product-1");
    expect(payload.data.mappingId).toBeUndefined(); // never leak the engine's internal id to a store

    vi.unstubAllGlobals();
  });

  it("marks a mapping out of stock and fires that webhook when supplier stock drops to zero", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, webhook_url: "https://store.example.com/webhooks/dropship", webhook_secret: "a-very-long-webhook-secret" }]);
    db.seed("product_mappings", [
      { id: "mapping-1", store_id: STORE_ID, external_product_id: "product-1", external_variant_id: "variant-1", aliexpress_product_id: "1005006123456", aliexpress_sku_id: "12000030123456789", pricing_rule_id: null, supplier_cost_cents: 1600, retail_price_cents: 2195, is_active: true },
    ]);

    const soldOut = JSON.parse(JSON.stringify(productGetFixture));
    soldOut.aliexpress_ds_product_get_response.result.ae_item_sku_info_dtos.ae_item_sku_info_d_t_o[0].sku_available_stock = 0;

    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl: vi.fn().mockResolvedValue(jsonResponse(soldOut)) });
    const webhookFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", webhookFetch);

    const summary = await runCatalogSync(db, client, STORE_ID);

    expect(summary.markedOutOfStock).toBe(1);
    expect(db.rows("product_mappings")[0].is_active).toBe(false);
    const outOfStockCall = webhookFetch.mock.calls.find(([, init]: any) => init.headers["X-Dropship-Event"] === "product.out_of_stock");
    expect(outOfStockCall).toBeDefined();
    const payload = JSON.parse(outOfStockCall![1].body);
    expect(payload.data.externalVariantId).toBe("variant-1");
    expect(payload.data.mappingId).toBeUndefined();

    vi.unstubAllGlobals();
  });
});
