import type { SupabaseClient } from "@supabase/supabase-js";
import type { AliExpressClient } from "../aliexpress/client";
import type { AliExpressProductDetail } from "../aliexpress/types";
import { applyPricingRule, DEFAULT_PRICING_RULE, type PriceBounds, type PricingRule } from "../pricing/engine";
import { rewriteProductCopy, formatStructuredDescription, type BrandVoice, type CopyProvider } from "../copy/rewriter";
import { getStoreSettings } from "./settings";

const NEUTRAL_VOICE: BrandVoice = { storeName: "Store" };

async function cacheAeProduct(db: SupabaseClient, detail: AliExpressProductDetail): Promise<void> {
  await db.from("ae_products").upsert(
    {
      aliexpress_product_id: detail.product_id,
      subject: detail.subject,
      detail_html: detail.detail ?? null,
      image_urls: detail.image_urls ? detail.image_urls.split(";").map((u) => u.trim()).filter(Boolean) : [],
      currency_code: detail.currency_code,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "aliexpress_product_id" },
  );

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
}

async function getDefaultPricingRule(db: SupabaseClient, storeId: string): Promise<PricingRule> {
  const { data } = await db.from("pricing_rules").select("rule").eq("store_id", storeId).eq("is_default", true).maybeSingle();
  return (data?.rule as PricingRule | undefined) ?? DEFAULT_PRICING_RULE;
}

async function getBrandVoice(db: SupabaseClient, storeId: string): Promise<BrandVoice> {
  const { data } = await db.from("stores").select("name, brand_voice").eq("id", storeId).single();
  return (data?.brand_voice as BrandVoice | undefined) ?? { storeName: (data?.name as string) ?? NEUTRAL_VOICE.storeName };
}

export interface SkuOption {
  /** e.g. "Color" — may be absent when the supplier didn't name the property. */
  name: string | null;
  /** e.g. "Blue". */
  value: string;
  /** The supplier's own image for this option, where it provides one (colour swatches usually have one). */
  imageUrl: string | null;
}

export interface ProductAttribute {
  name: string;
  value: string;
}

export interface ImportedSku {
  aliexpressSkuId: string;
  properties: string | null;
  supplierCostCents: number;
  stockOnHand: number;
  retailPriceCents: number;
  marginRate: number;
  /** Strikethrough/compare-at price, if the store configured pricing.compareAtRule — see src/domain/settings.ts. */
  compareAtPriceCents: number | null;
  /** The variant's options as name/value pairs, so a store can fill option1_name/option1_value rather than parsing `properties`. */
  options: SkuOption[];
}

export interface ImportProductResult {
  aliexpressProductId: string;
  onBrandName: string;
  description: string;
  imageUrls: string[];
  currencyCode: string;
  skus: ImportedSku[];
  /** Shipping weight from AliExpress's package info, in grams — a store needs it to rate shipping. */
  packageWeightGrams: number | null;
  /** The unit the supplier sells in (e.g. "piece"), for the store's own display. */
  productUnit: string | null;
  /** AliExpress's own category id, useful for mapping to a store taxonomy. */
  aliexpressCategoryId: number | null;
  /** The supplier's specification table (Material, Style, Season…), ready for a store's specs tab. */
  attributes: ProductAttribute[];
}

/**
 * Fetches an AliExpress product, caches it, and returns a fully-priced,
 * on-brand preview. Does NOT create a product_mapping — the connected store
 * decides its own external product/variant ids and calls createMapping for
 * whichever SKUs it wants to sell, once it's created the product locally.
 */
export async function importProduct(
  db: SupabaseClient,
  client: AliExpressClient,
  params: { storeId: string; aliexpressProductId: string; pricingRuleId?: string; copyProvider?: CopyProvider },
): Promise<ImportProductResult> {
  const settings = await getStoreSettings(db, params.storeId);

  // Quote in the currency the store actually sells in, for the market it sells to — otherwise
  // every price and margin below is computed from a USD/US quote and silently wrong elsewhere.
  const detail = await client.getProductDetail(params.aliexpressProductId, {
    targetCurrency: settings.import.targetCurrency,
    shipToCountry: settings.import.shipToCountry,
  });
  await cacheAeProduct(db, detail);

  // Precedence: an explicit rule for this import, else the store's configured markup, else the
  // pricing_rules default row, else the engine default.
  const rule = params.pricingRuleId
    ? ((await db.from("pricing_rules").select("rule").eq("id", params.pricingRuleId).single()).data?.rule as PricingRule)
    : (settings.pricing.rule ?? (await getDefaultPricingRule(db, params.storeId)));
  const voice = await getBrandVoice(db, params.storeId);
  const bounds: PriceBounds = { minPriceCents: settings.pricing.minPriceCents, maxPriceCents: settings.pricing.maxPriceCents };

  const { onBrandName, description } = await rewriteProductCopy(
    { rawTitle: detail.subject, rawDescriptionHtml: detail.detail, voice },
    params.copyProvider,
  );

  const skus: ImportedSku[] = detail.ae_item_sku_info_dtos.map((sku) => {
    const supplierCostCents = Math.round(parseFloat(sku.sku_price) * 100);
    const pricing = applyPricingRule(supplierCostCents, rule, bounds);
    const compareAtPriceCents = settings.pricing.compareAtRule
      ? applyPricingRule(supplierCostCents, settings.pricing.compareAtRule, bounds).retailPriceCents
      : null;
    return {
      aliexpressSkuId: sku.sku_id,
      properties: sku.sku_properties?.map((p) => p.property_value_definition_name).join(" / ") ?? null,
      supplierCostCents,
      stockOnHand: sku.sku_available_stock,
      retailPriceCents: pricing.retailPriceCents,
      marginRate: pricing.marginRate,
      compareAtPriceCents,
      options: (sku.sku_properties ?? []).map((p) => ({
        name: p.sku_property_name ?? null,
        value: p.property_value_definition_name,
        imageUrl: p.sku_image ?? null,
      })),
    };
  });

  return {
    aliexpressProductId: detail.product_id,
    onBrandName,
    description: formatStructuredDescription(description, voice),
    imageUrls: detail.image_urls ? detail.image_urls.split(";").map((u) => u.trim()).filter(Boolean) : [],
    // AliExpress echoes the requested target currency; fall back to what the store asked for.
    currencyCode: detail.currency_code || settings.import.targetCurrency || "USD",
    skus,
    packageWeightGrams: detail.package_info?.gross_weight
      ? Math.round(parseFloat(detail.package_info.gross_weight) * 1000)
      : null,
    productUnit: detail.package_info?.product_unit ?? null,
    aliexpressCategoryId: detail.category_id ?? null,
    attributes: (detail.attributes ?? []).map((attr) => ({
      name: attr.attr_name,
      value: attr.attr_value_unit ? `${attr.attr_value} ${attr.attr_value_unit}` : attr.attr_value,
    })),
  };
}

/**
 * Toggles whether a mapping is active — i.e. whether the store is currently
 * selling it. This is the only way a store removes a product from its shop
 * (isActive: false) or brings one back (isActive: true, e.g. after pausing
 * it or after catalog sync auto-deactivated it for being out of stock).
 * Scoped to the calling store so one store can never touch another's
 * mapping. Deliberately a toggle, not a delete: product_price_log rows
 * reference this mapping and would be orphaned/cascade-deleted otherwise.
 */
export async function setMappingActive(db: SupabaseClient, storeId: string, mappingId: string, isActive: boolean): Promise<{ id: string; isActive: boolean }> {
  const { data, error } = await db
    .from("product_mappings")
    .update({ is_active: isActive })
    .eq("id", mappingId)
    .eq("store_id", storeId)
    .select("id, is_active")
    .maybeSingle();
  if (error) throw new Error(`Could not update mapping: ${error.message}`);
  if (!data) throw new Error("Mapping not found");
  return { id: data.id as string, isActive: data.is_active as boolean };
}

export interface CreateMappingParams {
  storeId: string;
  externalProductId: string;
  externalVariantId: string;
  aliexpressProductId: string;
  aliexpressSkuId: string;
  pricingRuleId?: string;
  onBrandName?: string;
}

export interface MappingResult {
  id: string;
  supplierCostCents: number;
  retailPriceCents: number;
  compareAtPriceCents: number | null;
}

/** Persists the link between a store's own variant and an AliExpress SKU, pricing it with the store's chosen (or default) rule. Upserts on (store, externalVariantId) — re-mapping an existing variant updates it in place. */
export async function createMapping(db: SupabaseClient, params: CreateMappingParams): Promise<MappingResult> {
  const { data: skuRow, error: skuError } = await db
    .from("ae_product_skus")
    .select("supplier_cost_cents")
    .eq("aliexpress_product_id", params.aliexpressProductId)
    .eq("aliexpress_sku_id", params.aliexpressSkuId)
    .single();
  if (skuError || !skuRow) throw new Error(`Unknown AliExpress SKU ${params.aliexpressSkuId} — import the product first`);

  const rule = params.pricingRuleId
    ? ((await db.from("pricing_rules").select("rule").eq("id", params.pricingRuleId).single()).data?.rule as PricingRule)
    : await getDefaultPricingRule(db, params.storeId);
  const settings = await getStoreSettings(db, params.storeId);
  const bounds: PriceBounds = { minPriceCents: settings.pricing.minPriceCents, maxPriceCents: settings.pricing.maxPriceCents };
  const supplierCostCents = skuRow.supplier_cost_cents as number;
  const pricing = applyPricingRule(supplierCostCents, rule, bounds);
  const compareAtPriceCents = settings.pricing.compareAtRule
    ? applyPricingRule(supplierCostCents, settings.pricing.compareAtRule, bounds).retailPriceCents
    : null;

  const { data, error } = await db
    .from("product_mappings")
    .upsert(
      {
        store_id: params.storeId,
        external_product_id: params.externalProductId,
        external_variant_id: params.externalVariantId,
        aliexpress_product_id: params.aliexpressProductId,
        aliexpress_sku_id: params.aliexpressSkuId,
        pricing_rule_id: params.pricingRuleId ?? null,
        on_brand_name: params.onBrandName ?? null,
        supplier_cost_cents: supplierCostCents,
        retail_price_cents: pricing.retailPriceCents,
        compare_at_price_cents: compareAtPriceCents,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "store_id,external_variant_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create mapping: ${error?.message}`);

  return { id: data.id as string, supplierCostCents, retailPriceCents: pricing.retailPriceCents, compareAtPriceCents };
}
