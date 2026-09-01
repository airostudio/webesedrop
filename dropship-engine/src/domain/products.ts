import type { SupabaseClient } from "@supabase/supabase-js";
import type { AliExpressClient } from "../aliexpress/client";
import type { AliExpressProductDetail } from "../aliexpress/types";
import { applyPricingRule, DEFAULT_PRICING_RULE, type PricingRule } from "../pricing/engine";
import { rewriteProductCopy, formatStructuredDescription, type BrandVoice, type CopyProvider } from "../copy/rewriter";

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

export interface ImportedSku {
  aliexpressSkuId: string;
  properties: string | null;
  supplierCostCents: number;
  stockOnHand: number;
  retailPriceCents: number;
  marginRate: number;
}

export interface ImportProductResult {
  aliexpressProductId: string;
  onBrandName: string;
  description: string;
  imageUrls: string[];
  currencyCode: string;
  skus: ImportedSku[];
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
  const detail = await client.getProductDetail(params.aliexpressProductId);
  await cacheAeProduct(db, detail);

  const rule = params.pricingRuleId
    ? ((await db.from("pricing_rules").select("rule").eq("id", params.pricingRuleId).single()).data?.rule as PricingRule)
    : await getDefaultPricingRule(db, params.storeId);
  const voice = await getBrandVoice(db, params.storeId);

  const { onBrandName, description } = await rewriteProductCopy(
    { rawTitle: detail.subject, rawDescriptionHtml: detail.detail, voice },
    params.copyProvider,
  );

  const skus: ImportedSku[] = detail.ae_item_sku_info_dtos.map((sku) => {
    const supplierCostCents = Math.round(parseFloat(sku.sku_price) * 100);
    const pricing = applyPricingRule(supplierCostCents, rule);
    return {
      aliexpressSkuId: sku.sku_id,
      properties: sku.sku_properties?.map((p) => p.property_value_definition_name).join(" / ") ?? null,
      supplierCostCents,
      stockOnHand: sku.sku_available_stock,
      retailPriceCents: pricing.retailPriceCents,
      marginRate: pricing.marginRate,
    };
  });

  return {
    aliexpressProductId: detail.product_id,
    onBrandName,
    description: formatStructuredDescription(description, voice),
    imageUrls: detail.image_urls ? detail.image_urls.split(";").map((u) => u.trim()).filter(Boolean) : [],
    currencyCode: detail.currency_code,
    skus,
  };
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
  const pricing = applyPricingRule(skuRow.supplier_cost_cents as number, rule);

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
        supplier_cost_cents: skuRow.supplier_cost_cents,
        retail_price_cents: pricing.retailPriceCents,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "store_id,external_variant_id" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not create mapping: ${error?.message}`);

  return { id: data.id as string, supplierCostCents: skuRow.supplier_cost_cents as number, retailPriceCents: pricing.retailPriceCents };
}
