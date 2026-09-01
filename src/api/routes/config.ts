import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const webhookSchema = z.object({ url: z.string().url(), secret: z.string().min(16) });

const roundingSchema = z.enum(["none", "up-95", "up-99", "up-00"]);
const pricingRuleSchema = z.object({
  name: z.string().min(1),
  isDefault: z.boolean().optional(),
  rule: z.discriminatedUnion("type", [
    z.object({ type: z.literal("percent_margin"), marginRate: z.number().min(0), rounding: roundingSchema }),
    z.object({ type: z.literal("fixed_markup"), markupCents: z.number().int(), rounding: roundingSchema }),
    z.object({
      type: z.literal("tiered_margin"),
      tiers: z.array(z.object({ maxCostCents: z.number().int().positive().optional(), marginRate: z.number().min(0) })).min(1),
      rounding: roundingSchema,
    }),
  ]),
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
    return { registered: true };
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
}
