import "server-only";
import { db, getTenantId } from "./client";

export interface DashboardKpis {
  revenueCents30d: number;
  orders30d: number;
  avgOrderValueCents: number;
  pendingOrders: number;
  fulfillingOrders: number;
  lowStockItems: number;
  currency: string;
}

const REVENUE_STATUSES = ["PAID", "FULFILLING", "FULFILLED", "DELIVERED"];

/** All real — this store has no live checkout wired up yet (see README), so these are legitimately zero until orders exist. */
export async function getDashboardKpis(): Promise<DashboardKpis> {
  const tenantId = await getTenantId();
  const supabase = db();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: orders }, { count: pendingOrders }, { count: fulfillingOrders }, { data: productIds }] = await Promise.all([
    supabase.from("orders").select("total, currency, status").eq("tenant_id", tenantId).gte("created_at", since),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "PENDING_PAYMENT"),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "FULFILLING"),
    supabase.from("products").select("id").eq("tenant_id", tenantId),
  ]);

  const revenueOrders = (orders ?? []).filter((o) => REVENUE_STATUSES.includes(o.status as string));
  const revenueCents30d = revenueOrders.reduce((sum, o) => sum + (o.total as number), 0);
  const currency = (revenueOrders[0]?.currency as string) ?? "USD";

  let lowStockItems = 0;
  const ids = ((productIds ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length > 0) {
    const { data: variants } = await supabase.from("product_variants").select("id").in("product_id", ids);
    const variantIds = ((variants ?? []) as { id: string }[]).map((v) => v.id);
    if (variantIds.length > 0) {
      // PostgREST filters compare a column to a literal, not another column —
      // fetch both and compare in JS rather than reach for a DB view/RPC for this.
      const { data: inv } = await supabase.from("inventory_items").select("stock_on_hand, low_stock_threshold").in("variant_id", variantIds);
      lowStockItems = ((inv ?? []) as { stock_on_hand: number; low_stock_threshold: number }[]).filter(
        (i) => i.stock_on_hand <= i.low_stock_threshold,
      ).length;
    }
  }

  return {
    revenueCents30d,
    orders30d: revenueOrders.length,
    avgOrderValueCents: revenueOrders.length > 0 ? Math.round(revenueCents30d / revenueOrders.length) : 0,
    pendingOrders: pendingOrders ?? 0,
    fulfillingOrders: fulfillingOrders ?? 0,
    lowStockItems,
    currency,
  };
}
