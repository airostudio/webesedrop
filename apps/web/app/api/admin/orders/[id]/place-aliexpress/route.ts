import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@trend/db";
import { fulfillOrder, type EngineAddress } from "@/lib/dropshipEngine";

export const runtime = "nodejs";

/**
 * Places the AliExpress dropshipping order for a paid local order, via the
 * dropship-engine. Idempotency is the engine's job (an atomic claim on its
 * own orders table, keyed by this store's order id) — this route just
 * forwards the request and mirrors the result into Beach Footprints' own
 * `orders` row.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createServiceRoleSupabaseClient();

  try {
    const { data: order, error: orderError } = await supabase.from("orders").select("id, tenant_id, shipping_address").eq("id", params.id).single();
    if (orderError || !order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    if (!order.shipping_address) return NextResponse.json({ error: "Order has no shipping_address on file" }, { status: 400 });

    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("quantity, variant_id, product_variants!inner(supplier)")
      .eq("order_id", params.id);
    if (itemsError) throw new Error(itemsError.message);

    const dropshipItems = (items ?? []).filter((item: any) => item.product_variants?.supplier === "dropship-engine");
    if (dropshipItems.length === 0) return NextResponse.json({ error: "Order has no dropship-engine-sourced line items to place" }, { status: 400 });

    const result = await fulfillOrder({
      externalOrderId: order.id as string,
      shippingAddress: order.shipping_address as EngineAddress,
      lineItems: dropshipItems.map((item: any) => ({ externalVariantId: item.variant_id, quantity: item.quantity })),
    });

    await supabase
      .from("orders")
      .update({
        aliexpress_order_id: result.aliexpressOrderId,
        fulfillment_status: result.fulfillmentStatus ?? "fulfillment_in_progress",
        fulfilled_at: result.skipped ? undefined : new Date().toISOString(),
        status: result.aliexpressOrderId ? "FULFILLING" : undefined,
      })
      .eq("id", params.id);

    await supabase.from("fulfillment_logs").insert({
      tenant_id: order.tenant_id,
      order_id: params.id,
      event: result.skipped ? "order_place_skipped" : "order_placed",
      supplier_order_id: result.aliexpressOrderId,
    });

    return NextResponse.json(result, { status: result.skipped ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AliExpress order placement failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
