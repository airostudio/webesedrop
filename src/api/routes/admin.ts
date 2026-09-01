import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getOverviewStats, getPlanBreakdown, getOrdersTimeseries, getRevenueTimeseries, getStoreDetail, listInvoices, listStoresWithBilling } from "../../domain/admin";
import { listAllDomains } from "../../domain/domains";
import { createPlan, listPlans } from "../../domain/billing";

const createPlanSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  priceCents: z.number().int().positive(),
  billingInterval: z.enum(["month", "year"]),
  stripePriceId: z.string().optional(),
  features: z.record(z.unknown()).optional(),
});

/**
 * Operator-only admin API — billing/accounting, the domain install log, and
 * drill-down reports. Gated by ADMIN_API_KEY (see src/auth/adminAuth.ts),
 * not any store's own key; wired up as its own onRequest hook in server.ts
 * rather than the per-store one every other /v1/* route uses.
 */
export function registerAdminRoutes(app: FastifyInstance, db: SupabaseClient): void {
  app.get("/v1/admin/overview", async () => getOverviewStats(db));

  app.get("/v1/admin/stores", async () => ({ stores: await listStoresWithBilling(db) }));

  app.get<{ Params: { id: string } }>("/v1/admin/stores/:id", async (request, reply) => {
    const detail = await getStoreDetail(db, request.params.id);
    if (!detail) return reply.code(404).send({ error: "Store not found" });
    return detail;
  });

  app.get("/v1/admin/domains", async (request) => {
    const query = request.query as { storeId?: string; domain?: string };
    return { domains: await listAllDomains(db, { storeId: query.storeId, domain: query.domain }) };
  });

  app.get("/v1/admin/invoices", async (request) => {
    const query = request.query as { storeId?: string; status?: string };
    return { invoices: await listInvoices(db, { storeId: query.storeId, status: query.status }) };
  });

  app.get("/v1/admin/plans", async () => ({ plans: await listPlans(db, true) }));

  app.post("/v1/admin/plans", async (request, reply) => {
    const parsed = createPlanSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      return reply.code(201).send(await createPlan(db, parsed.data));
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : "Could not create plan" });
    }
  });

  app.get("/v1/admin/reports/revenue", async () => ({ points: await getRevenueTimeseries(db) }));
  app.get("/v1/admin/reports/orders", async () => ({ points: await getOrdersTimeseries(db) }));
  app.get("/v1/admin/reports/plans", async () => ({ plans: await getPlanBreakdown(db) }));
}
