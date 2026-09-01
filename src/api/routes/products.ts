import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getClientForStore } from "../../domain/connection";
import { createMapping, importProduct } from "../../domain/products";

const importSchema = z.object({ aliexpressProductId: z.string().min(1), pricingRuleId: z.string().uuid().optional() });
const mappingSchema = z.object({
  externalProductId: z.string().min(1),
  externalVariantId: z.string().min(1),
  aliexpressProductId: z.string().min(1),
  aliexpressSkuId: z.string().min(1),
  pricingRuleId: z.string().uuid().optional(),
  onBrandName: z.string().optional(),
});

export function registerProductRoutes(app: FastifyInstance, db: SupabaseClient): void {
  /** Fetches + prices an AliExpress product for preview. Doesn't create anything the store didn't ask for — call /v1/products/mappings next for whichever SKUs you actually want to sell. */
  app.post("/v1/products/import", async (request, reply) => {
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    try {
      const client = await getClientForStore(db, request.store.id);
      const result = await importProduct(db, client, { storeId: request.store.id, ...parsed.data });
      return result;
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "AliExpress product import failed" });
    }
  });

  /** Links a store's own product/variant id to an AliExpress SKU so catalog sync knows to keep it priced/stocked. */
  app.post("/v1/products/mappings", async (request, reply) => {
    const parsed = mappingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    try {
      const result = await createMapping(db, { storeId: request.store.id, ...parsed.data });
      return result;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : "Could not create mapping" });
    }
  });

  app.get("/v1/products/mappings/:externalProductId", async (request) => {
    const { externalProductId } = request.params as { externalProductId: string };
    const { data } = await db
      .from("product_mappings")
      .select("id, external_variant_id, aliexpress_product_id, aliexpress_sku_id, on_brand_name, supplier_cost_cents, retail_price_cents, is_active, last_synced_at")
      .eq("store_id", request.store.id)
      .eq("external_product_id", externalProductId);
    return { mappings: data ?? [] };
  });
}
