import type { SupabaseClient } from "@supabase/supabase-js";
import { AliExpressClient } from "../aliexpress/client";
import { applyPricingRule, DEFAULT_PRICING_RULE, diffPriceChange, type PricingRule } from "../pricing/engine";
import { deliverWebhook } from "./webhooks";
import { getClientForStore } from "./connection";

async function logSyncEvent(db: SupabaseClient, params: { storeId: string; mappingId?: string; event: string; detail?: unknown }): Promise<void> {
  await db.from("sync_logs").insert({ store_id: params.storeId, mapping_id: params.mappingId ?? null, event: params.event, detail: params.detail ?? null });
}

async function notifyStore(db: SupabaseClient, storeId: string, event: Parameters<typeof deliverWebhook>[1]["event"], payload: Record<string, unknown>) {
  const { data: store } = await db.from("stores").select("webhook_url, webhook_secret").eq("id", storeId).single();
  if (!store?.webhook_url || !store?.webhook_secret) return;
  await deliverWebhook(db, { storeId, webhookUrl: store.webhook_url, webhookSecret: store.webhook_secret, event, payload });
}

export interface CatalogSyncSummary {
  storeId: string;
  mappingsChecked: number;
  priceChanges: number;
  markedOutOfStock: number;
  restocked: number;
  errors: Array<{ mappingId: string; message: string }>;
}

/**
 * Re-fetches every AliExpress product this store has mappings for, updates
 * the cached SKU cost/stock, recomputes each mapping's retail price against
 * its pricing rule, logs real changes, and fires a webhook for anything the
 * connected store needs to react to (price moved, sold out, restocked).
 */
export async function runCatalogSync(db: SupabaseClient, client: AliExpressClient, storeId: string): Promise<CatalogSyncSummary> {
  const summary: CatalogSyncSummary = { storeId, mappingsChecked: 0, priceChanges: 0, markedOutOfStock: 0, restocked: 0, errors: [] };

  const { data: mappings } = await db
    .from("product_mappings")
    .select("id, external_product_id, external_variant_id, aliexpress_product_id, aliexpress_sku_id, pricing_rule_id, supplier_cost_cents, retail_price_cents, is_active")
    .eq("store_id", storeId);

  const byProduct = new Map<string, typeof mappings>();
  for (const mapping of mappings ?? []) {
    const list = byProduct.get(mapping.aliexpress_product_id as string) ?? [];
    list.push(mapping);
    byProduct.set(mapping.aliexpress_product_id as string, list);
  }

  for (const [aliexpressProductId, productMappings] of byProduct) {
    let detail;
    try {
      detail = await client.getProductDetail(aliexpressProductId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const mapping of productMappings!) summary.errors.push({ mappingId: mapping.id as string, message });
      continue;
    }

    const skuById = new Map(detail.ae_item_sku_info_dtos.map((sku) => [sku.sku_id, sku]));
    await db.from("ae_product_skus").upsert(
      detail.ae_item_sku_info_dtos.map((sku) => ({
        aliexpress_product_id: detail.product_id,
        aliexpress_sku_id: sku.sku_id,
        supplier_cost_cents: Math.round(parseFloat(sku.sku_price) * 100),
        stock_on_hand: sku.sku_available_stock,
        sku_properties: sku.sku_properties ?? null,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: "aliexpress_product_id,aliexpress_sku_id" },
    );

    for (const mapping of productMappings!) {
      summary.mappingsChecked += 1;
      const sku = skuById.get(mapping.aliexpress_sku_id as string);
      if (!sku) continue; // SKU no longer offered — leave as-is rather than guessing

      const newCostCents = Math.round(parseFloat(sku.sku_price) * 100);
      let rule: PricingRule = DEFAULT_PRICING_RULE;
      if (mapping.pricing_rule_id) {
        const { data: ruleRow } = await db.from("pricing_rules").select("rule").eq("id", mapping.pricing_rule_id).single();
        if (ruleRow?.rule) rule = ruleRow.rule as PricingRule;
      }
      const diff = diffPriceChange({
        variantId: mapping.id as string,
        previousCostCents: mapping.supplier_cost_cents as number,
        previousPriceCents: mapping.retail_price_cents as number,
        newSupplierCostCents: newCostCents,
        rule,
      });

      await db
        .from("product_mappings")
        .update({ supplier_cost_cents: newCostCents, retail_price_cents: diff.newPriceCents, last_synced_at: new Date().toISOString() })
        .eq("id", mapping.id);

      if (diff.changed) {
        summary.priceChanges += 1;
        await db.from("product_price_log").insert({
          mapping_id: mapping.id,
          previous_cost_cents: diff.previousCostCents,
          new_cost_cents: diff.newCostCents,
          previous_price_cents: diff.previousPriceCents,
          new_price_cents: diff.newPriceCents,
          margin_rate: diff.marginRate,
        });
        await notifyStore(db, storeId, "product.price_changed", {
          externalProductId: mapping.external_product_id,
          externalVariantId: mapping.external_variant_id,
          previousPriceCents: diff.previousPriceCents,
          newPriceCents: diff.newPriceCents,
        });
      }

      const wasActive = mapping.is_active as boolean;
      if (wasActive && sku.sku_available_stock === 0) {
        await db.from("product_mappings").update({ is_active: false }).eq("id", mapping.id);
        summary.markedOutOfStock += 1;
        await notifyStore(db, storeId, "product.out_of_stock", { externalProductId: mapping.external_product_id, externalVariantId: mapping.external_variant_id });
      } else if (!wasActive && sku.sku_available_stock > 0) {
        await db.from("product_mappings").update({ is_active: true }).eq("id", mapping.id);
        summary.restocked += 1;
        await notifyStore(db, storeId, "product.restocked", { externalProductId: mapping.external_product_id, externalVariantId: mapping.external_variant_id, stockOnHand: sku.sku_available_stock });
      }
    }
  }

  await logSyncEvent(db, { storeId, event: "catalog_sync_run", detail: summary });
  return summary;
}

export interface TrackingSyncSummary {
  storeId: string;
  polled: number;
  shipped: number;
  delivered: number;
  errors: Array<{ orderId: string; message: string }>;
}

export async function runTrackingSync(db: SupabaseClient, client: AliExpressClient, storeId: string): Promise<TrackingSyncSummary> {
  const summary: TrackingSyncSummary = { storeId, polled: 0, shipped: 0, delivered: 0, errors: [] };

  const { data: orders } = await db
    .from("orders")
    .select("id, external_order_id, aliexpress_order_id")
    .eq("store_id", storeId)
    .eq("fulfillment_status", "fulfillment_in_progress")
    .not("aliexpress_order_id", "is", null);

  for (const order of orders ?? []) {
    summary.polled += 1;
    try {
      const detail = await client.getOrderDetail(order.aliexpress_order_id as string);
      const logistics = detail.logistics_info_list?.[0];

      if (detail.order_status === "FINISH") {
        await db.from("orders").update({ fulfillment_status: "delivered" }).eq("id", order.id);
        summary.delivered += 1;
        await logSyncEvent(db, { storeId, event: "delivered" });
        await notifyStore(db, storeId, "order.delivered", { externalOrderId: order.external_order_id });
      } else if (logistics?.logistics_no) {
        await db
          .from("orders")
          .update({ fulfillment_status: "shipped", tracking_number: logistics.logistics_no, carrier: logistics.logistics_company, shipped_at: new Date().toISOString() })
          .eq("id", order.id);
        summary.shipped += 1;
        await logSyncEvent(db, { storeId, event: "shipped" });
        await notifyStore(db, storeId, "order.shipped", {
          externalOrderId: order.external_order_id,
          trackingNumber: logistics.logistics_no,
          carrier: logistics.logistics_company,
          trackingUrl: logistics.tracking_url,
        });
      }
    } catch (err) {
      summary.errors.push({ orderId: order.id as string, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

/** Runs catalog sync for every active store — the daily scheduled job's entry point. */
export async function runCatalogSyncForAllStores(db: SupabaseClient): Promise<CatalogSyncSummary[]> {
  const { data: stores } = await db.from("stores").select("id").eq("is_active", true);
  const summaries: CatalogSyncSummary[] = [];
  for (const store of stores ?? []) {
    try {
      const client = await getClientForStore(db, store.id as string);
      summaries.push(await runCatalogSync(db, client, store.id as string));
    } catch (err) {
      summaries.push({ storeId: store.id as string, mappingsChecked: 0, priceChanges: 0, markedOutOfStock: 0, restocked: 0, errors: [{ mappingId: "", message: err instanceof Error ? err.message : String(err) }] });
    }
  }
  return summaries;
}

/** Runs tracking sync for every active store — the 4-6-hourly scheduled job's entry point. */
export async function runTrackingSyncForAllStores(db: SupabaseClient): Promise<TrackingSyncSummary[]> {
  const { data: stores } = await db.from("stores").select("id").eq("is_active", true);
  const summaries: TrackingSyncSummary[] = [];
  for (const store of stores ?? []) {
    try {
      const client = await getClientForStore(db, store.id as string);
      summaries.push(await runTrackingSync(db, client, store.id as string));
    } catch (err) {
      summaries.push({ storeId: store.id as string, polled: 0, shipped: 0, delivered: 0, errors: [{ orderId: "", message: err instanceof Error ? err.message : String(err) }] });
    }
  }
  return summaries;
}
