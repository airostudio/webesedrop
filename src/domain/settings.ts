import type { SupabaseClient } from "@supabase/supabase-js";
import type { PricingRule } from "../pricing/engine";

/**
 * Per-store dropshipping settings — the knobs that actually change import/sync/fulfillment
 * behavior (see products.ts, sync.ts, orders.ts for where each field is read). Every field is
 * optional; DEFAULT_STORE_SETTINGS fills in the rest, so a store with no settings configured
 * still gets sane, documented behavior.
 */
export interface StoreSettings {
  pricing: {
    /** Hard floor — a computed retail price is never sent to a store below this, whatever the pricing rule computes. */
    minPriceCents?: number;
    /** Hard ceiling — same, on the high side. */
    maxPriceCents?: number;
    /**
     * A price-change sync (runCatalogSync) only counts as "changed" — logs it and fires
     * product.price_changed — when the move is at least this many percentage points. Filters out
     * the constant tiny cost fluctuations AliExpress suppliers make, which is genuinely undocumented
     * as a setting in Ali2Woo/DSers/AliDropship/Zendrop/Spocket despite being a real pain point.
     */
    ignorePriceChangeBelowPercent?: number;
    /** Optional separate rule for a compare-at/strikethrough price, computed the same way as the main pricing rule but usually with a higher margin. Omit for no compare-at price. */
    compareAtRule?: PricingRule;
    /**
     * The markup applied to every imported SKU's supplier cost. Previously only settable by writing
     * a row into `pricing_rules` directly, which made the single most important number in the whole
     * import invisible to the store's admin. An explicit `pricingRuleId` on an import still wins.
     */
    rule?: PricingRule;
  };
  import: {
    /** Product status a newly imported product lands as. Defaults to "draft" — review before it goes live. */
    defaultStatus: "draft" | "published";
    /**
     * The currency the store sells in. AliExpress converts supplier prices to it, so every imported
     * price — and the margin computed from it — is already in the currency customers are charged.
     * Defaults to USD, matching the API's own default.
     */
    targetCurrency?: string;
    /**
     * Destination country for the price quote (ISO 3166-1 alpha-2). AliExpress prices vary by
     * destination, so quoting against the market actually being sold to keeps the margin honest.
     * Defaults to US, matching the API's own default.
     */
    shipToCountry?: string;
  };
  stock: {
    /**
     * What happens to a mapping when AliExpress reports it out of stock. "mark_unavailable" (default)
     * deactivates it, the same way it already always worked; "keep_visible" leaves it active — useful
     * for a store that wants to keep taking orders and reconcile manually.
     */
    outOfStockBehavior: "mark_unavailable" | "keep_visible";
    /**
     * A mapping only comes back from out-of-stock once AliExpress reports at least this many units
     * on hand — filters a supplier's momentary 1-2 unit restock blips from flapping a listing back
     * live and firing product.restocked, only to sell out again on the next sync. Going to 0 always
     * fires product.out_of_stock regardless (that transition is unambiguous either way).
     */
    ignoreStockChangeBelowUnits?: number;
  };
  shipping: {
    /** Default AliExpress logistics service name used when an order doesn't specify one — see orders.ts's DEFAULT_LOGISTICS_SERVICE for the engine's own fallback if this isn't set either. */
    preferredLogisticsService?: string;
  };
  notifications: {
    priceChanged: boolean;
    outOfStock: boolean;
    restocked: boolean;
    orderShipped: boolean;
    orderDelivered: boolean;
    fulfillmentFailed: boolean;
  };
}

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  pricing: {},
  import: { defaultStatus: "draft", targetCurrency: "USD", shipToCountry: "US" },
  stock: { outOfStockBehavior: "mark_unavailable" },
  shipping: {},
  notifications: { priceChanged: true, outOfStock: true, restocked: true, orderShipped: true, orderDelivered: true, fulfillmentFailed: true },
};

/** Deep-merges a store's saved settings over the defaults, so a partially-configured store (or one that's never set anything) still gets every field. */
function withDefaults(saved: Partial<StoreSettings> | null | undefined): StoreSettings {
  return {
    pricing: { ...DEFAULT_STORE_SETTINGS.pricing, ...saved?.pricing },
    import: { ...DEFAULT_STORE_SETTINGS.import, ...saved?.import },
    stock: { ...DEFAULT_STORE_SETTINGS.stock, ...saved?.stock },
    shipping: { ...DEFAULT_STORE_SETTINGS.shipping, ...saved?.shipping },
    notifications: { ...DEFAULT_STORE_SETTINGS.notifications, ...saved?.notifications },
  };
}

export async function getStoreSettings(db: SupabaseClient, storeId: string): Promise<StoreSettings> {
  const { data } = await db.from("stores").select("settings").eq("id", storeId).single();
  return withDefaults(data?.settings as Partial<StoreSettings> | undefined);
}

/** Merges the given partial settings into the store's saved settings (per top-level section — passing `pricing` replaces the whole pricing section, not a per-field merge) and returns the resolved result. */
export async function updateStoreSettings(db: SupabaseClient, storeId: string, patch: Partial<StoreSettings>): Promise<StoreSettings> {
  const current = await getStoreSettings(db, storeId);
  const merged: StoreSettings = { ...current, ...patch };
  await db.from("stores").update({ settings: merged }).eq("id", storeId);
  return merged;
}
