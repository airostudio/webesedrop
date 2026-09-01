import type { SupabaseClient } from "@supabase/supabase-js";
import { AliExpressApiError } from "../aliexpress/client";
import { toAliExpressAddress } from "../aliexpress/address";
import { getClientForStore } from "./connection";
import type { Address } from "../types";

const DEFAULT_LOGISTICS_SERVICE = "CAINIAO_STANDARD";

async function logSyncEvent(
  db: SupabaseClient,
  params: { storeId: string; orderId?: string; mappingId?: string; event: string; detail?: unknown },
): Promise<void> {
  await db.from("sync_logs").insert({
    store_id: params.storeId,
    order_id: params.orderId ?? null,
    mapping_id: params.mappingId ?? null,
    event: params.event,
    detail: params.detail ?? null,
  });
}

export interface FulfillOrderParams {
  storeId: string;
  externalOrderId: string;
  shippingAddress: Address;
  /** externalVariantId — the store's own variant/SKU id, the same one it passed to createMapping. Never the engine's internal mapping id, so a store never has to track anything engine-internal. */
  lineItems: Array<{ externalVariantId: string; quantity: number }>;
  logisticsServiceName?: string;
}

export interface FulfillOrderResult {
  orderId: string;
  externalOrderId: string;
  skipped: boolean;
  aliexpressOrderId: string | null;
  fulfillmentStatus: string | null;
}

/**
 * Idempotent order placement. First call creates (or reuses) the `orders`
 * row and atomically claims it — a row is only returned from the claim
 * update if it was still `unfulfilled`, so a retried or duplicated request
 * for the same externalOrderId can never place the AliExpress order twice.
 */
export async function fulfillOrder(db: SupabaseClient, params: FulfillOrderParams): Promise<FulfillOrderResult> {
  const { data: existingOrRow } = await db
    .from("orders")
    .select("id, fulfillment_status, aliexpress_order_id")
    .eq("store_id", params.storeId)
    .eq("external_order_id", params.externalOrderId)
    .maybeSingle();

  let orderId = existingOrRow?.id as string | undefined;
  if (!orderId) {
    const { data: inserted, error } = await db
      .from("orders")
      .insert({
        store_id: params.storeId,
        external_order_id: params.externalOrderId,
        fulfillment_status: "unfulfilled",
        shipping_address: params.shippingAddress,
        line_items: params.lineItems,
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(`Could not create order: ${error?.message}`);
    orderId = inserted.id as string;
  }

  const { data: claimed } = await db
    .from("orders")
    .update({ fulfillment_status: "fulfillment_in_progress" })
    .eq("id", orderId)
    .eq("fulfillment_status", "unfulfilled")
    .is("aliexpress_order_id", null)
    .select("id")
    .maybeSingle();

  if (!claimed) {
    const { data: current } = await db.from("orders").select("aliexpress_order_id, fulfillment_status").eq("id", orderId).single();
    return {
      orderId,
      externalOrderId: params.externalOrderId,
      skipped: true,
      aliexpressOrderId: current?.aliexpress_order_id ?? null,
      fulfillmentStatus: current?.fulfillment_status ?? null,
    };
  }

  await logSyncEvent(db, { storeId: params.storeId, orderId, event: "order_place_attempt" });

  try {
    const { data: mappings, error: mappingsError } = await db
      .from("product_mappings")
      .select("id, external_variant_id, aliexpress_product_id, aliexpress_sku_id")
      .eq("store_id", params.storeId)
      .in("external_variant_id", params.lineItems.map((li) => li.externalVariantId));
    if (mappingsError) throw new Error(mappingsError.message);
    if (!mappings || mappings.length === 0) throw new Error("No product mappings found for this order's line items");

    const client = await getClientForStore(db, params.storeId);
    const result = await client.createOrder({
      outOrderId: orderId,
      logisticsAddress: toAliExpressAddress(params.shippingAddress),
      items: params.lineItems.map((li) => {
        const mapping = mappings.find((m) => m.external_variant_id === li.externalVariantId);
        if (!mapping) throw new Error(`Line item references a variant with no mapping: ${li.externalVariantId}`);
        return {
          productId: mapping.aliexpress_product_id as string,
          skuId: mapping.aliexpress_sku_id as string,
          quantity: li.quantity,
          logisticsServiceName: params.logisticsServiceName ?? DEFAULT_LOGISTICS_SERVICE,
        };
      }),
    });

    await db
      .from("orders")
      .update({ aliexpress_order_id: result.orderId, fulfillment_status: "fulfillment_in_progress", fulfilled_at: new Date().toISOString() })
      .eq("id", orderId);
    await logSyncEvent(db, { storeId: params.storeId, orderId, event: "order_placed", detail: { aliexpressOrderId: result.orderId } });

    return { orderId, externalOrderId: params.externalOrderId, skipped: false, aliexpressOrderId: result.orderId, fulfillmentStatus: "fulfillment_in_progress" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from("orders").update({ fulfillment_status: "unfulfilled" }).eq("id", orderId);
    await logSyncEvent(db, {
      storeId: params.storeId,
      orderId,
      event: "order_place_failed",
      detail: { message, code: err instanceof AliExpressApiError ? err.code : undefined },
    });
    throw err;
  }
}

export interface OrderStatusResult {
  externalOrderId: string;
  fulfillmentStatus: string;
  aliexpressOrderId: string | null;
  trackingNumber: string | null;
  carrier: string | null;
}

export async function getOrderStatus(db: SupabaseClient, params: { storeId: string; externalOrderId: string }): Promise<OrderStatusResult | null> {
  const { data } = await db
    .from("orders")
    .select("external_order_id, fulfillment_status, aliexpress_order_id, tracking_number, carrier")
    .eq("store_id", params.storeId)
    .eq("external_order_id", params.externalOrderId)
    .maybeSingle();
  if (!data) return null;
  return {
    externalOrderId: data.external_order_id as string,
    fulfillmentStatus: data.fulfillment_status as string,
    aliexpressOrderId: data.aliexpress_order_id as string | null,
    trackingNumber: data.tracking_number as string | null,
    carrier: data.carrier as string | null,
  };
}
