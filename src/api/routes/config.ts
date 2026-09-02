import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordDomainSighting } from "../../domain/domains";
import { getStoreSettings, updateStoreSettings } from "../../domain/settings";

const webhookSchema = z.object({ url: z.string().url(), secret: z.string().min(16) });
const domainSchema = z.object({ domain: z.string().min(1) });

const roundingSchema = z.enum(["none", "up-95", "up-99", "up-00"]);
const pricingRuleUnionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("percent_margin"), marginRate: z.number().min(0), rounding: roundingSchema }),
  z.object({ type: z.literal("fixed_markup"), markupCents: z.number().int(), rounding: roundingSchema }),
  z.object({
    type: z.literal("tiered_margin"),
    tiers: z.array(z.object({ maxCostCents: z.number().int().positive().optional(), marginRate: z.number().min(0) })).min(1),
    rounding: roundingSchema,
  }),
]);
const pricingRuleSchema = z.object({
  name: z.string().min(1),
  isDefault: z.boolean().optional(),
  rule: pricingRuleUnionSchema,
});

const storeSettingsSchema = z
  .object({
    pricing: z
      .object({
        minPriceCents: z.number().int().min(0).optional(),
        maxPriceCents: z.number().int().min(0).optional(),
        ignorePriceChangeBelowPercent: z.number().min(0).optional(),
        compareAtRule: pricingRuleUnionSchema.optional(),
      })
      .optional(),
    import: z.object({ defaultStatus: z.enum(["draft", "published"]) }).optional(),
    stock: z
      .object({
        outOfStockBehavior: z.enum(["mark_unavailable", "keep_visible"]),
        ignoreStockChangeBelowUnits: z.number().int().min(0).optional(),
      })
      .optional(),
    shipping: z.object({ preferredLogisticsService: z.string().optional() }).optional(),
    notifications: z
      .object({
        priceChanged: z.boolean(),
        outOfStock: z.boolean(),
        restocked: z.boolean(),
        orderShipped: z.boolean(),
        orderDelivered: z.boolean(),
        fulfillmentFailed: z.boolean(),
      })
      .optional(),
  })
  .refine((v) => !(v.pricing?.minPriceCents !== undefined && v.pricing?.maxPriceCents !== undefined && v.pricing.minPriceCents > v.pricing.maxPriceCents), {
    message: "minPriceCents must not be greater than maxPriceCents",
  });

const brandVoiceSchema = z.object({
  storeName: z.string().min(1),
  descriptors: z.array(z.string()).optional(),
  styleLabel: z.string().optional(),
  sectionLabels: z.tuple([z.string(), z.string(), z.string(), z.string()]).optional(),
  openingLine: z.string().optional(),
});

export function registerConfigRoutes(app: FastifyInstance, db: SupabaseClient): void {
  /** Registers where the engine sends product/order event webhooks for this store. See src/domain/webhooks.ts for the signature format. */
  app.post("/v1/webhooks", async (request, reply) => {
    const parsed = webhookSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db.from("stores").update({ webhook_url: parsed.data.url, webhook_secret: parsed.data.secret }).eq("id", request.store.id);
    await recordDomainSighting(db, request.store.id, parsed.data.url, "webhook_url");
    return { registered: true };
  });

  /** Explicit domain declaration — for a store that doesn't register a webhook (or wants a staging domain logged too). Feeds the admin's domain install log. */
  app.post("/v1/domains", async (request, reply) => {
    const parsed = domainSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await recordDomainSighting(db, request.store.id, parsed.data.domain, "manual");
    return reply.code(201).send({ recorded: true });
  });

  app.post("/v1/pricing-rules", async (request, reply) => {
    const parsed = pricingRuleSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    if (parsed.data.isDefault) {
      await db.from("pricing_rules").update({ is_default: false }).eq("store_id", request.store.id).eq("is_default", true);
    }
    const { data, error } = await db
      .from("pricing_rules")
      .insert({ store_id: request.store.id, name: parsed.data.name, rule: parsed.data.rule, is_default: parsed.data.isDefault ?? false })
      .select("id")
      .single();
    if (error || !data) return reply.code(500).send({ error: error?.message ?? "Could not create pricing rule" });
    return reply.code(201).send({ id: data.id });
  });

  app.get("/v1/pricing-rules", async (request) => {
    const { data } = await db.from("pricing_rules").select("id, name, rule, is_default").eq("store_id", request.store.id);
    return { rules: data ?? [] };
  });

  /** Sets this store's brand voice for the copy rewriter (see src/copy/rewriter.ts). Omit any field to fall back to the neutral default. */
  app.put("/v1/brand-voice", async (request, reply) => {
    const parsed = brandVoiceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    await db.from("stores").update({ brand_voice: parsed.data }).eq("id", request.store.id);
    return { updated: true };
  });

  /** This store's dropshipping settings (pricing bounds/compare-at, import defaults, stock/sync behavior, shipping preference, notification toggles) — see src/domain/settings.ts. Always returns every field, defaults filled in. */
  app.get("/v1/settings", async (request) => {
    return { settings: await getStoreSettings(db, request.store.id) };
  });

  /** Patches this store's settings — pass only the top-level sections you're changing (pricing/import/stock/shipping/notifications); each section replaces that whole section, so include every field you want kept within a section you're updating. Returns the fully-resolved settings. */
  app.put("/v1/settings", async (request, reply) => {
    const parsed = storeSettingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    return { settings: await updateStoreSettings(db, request.store.id, parsed.data) };
  });
}
