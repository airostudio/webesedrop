import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { fulfillOrder, getOrderStatus } from "../../domain/orders";

const addressSchema = z.object({
  fullName: z.string().min(1),
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  region: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().length(2),
  phone: z.string().min(1),
});

const fulfillSchema = z.object({
  externalOrderId: z.string().min(1),
  shippingAddress: addressSchema,
  lineItems: z.array(z.object({ externalVariantId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
  logisticsServiceName: z.string().optional(),
});

export function registerOrderRoutes(app: FastifyInstance, db: SupabaseClient): void {
  /** Places the AliExpress order for a paid storefront order. Idempotent — safe to call more than once for the same externalOrderId. */
  app.post("/v1/orders/fulfill", async (request, reply) => {
    const parsed = fulfillSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    try {
      const result = await fulfillOrder(db, { storeId: request.store.id, ...parsed.data });
      return reply.code(result.skipped ? 200 : 201).send(result);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "AliExpress order placement failed" });
    }
  });

  app.get("/v1/orders/:externalOrderId", async (request, reply) => {
    const { externalOrderId } = request.params as { externalOrderId: string };
    const status = await getOrderStatus(db, { storeId: request.store.id, externalOrderId });
    if (!status) return reply.code(404).send({ error: "Order not found" });
    return status;
  });
}
