import type { FastifyInstance } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getStripe, getWebhookSecret } from "../../billing/stripe";
import { createCheckoutSession, getSubscriptionForStore, handleStripeWebhookEvent, listPlans } from "../../domain/billing";

const checkoutSchema = z.object({ planId: z.string().min(1), successUrl: z.string().url(), cancelUrl: z.string().url() });

/** Store-scoped billing endpoints (auth'd like every other /v1/* route) plus the public Stripe webhook receiver. */
export function registerBillingRoutes(app: FastifyInstance, db: SupabaseClient): void {
  app.get("/v1/billing/plans", async () => ({ plans: await listPlans(db) }));

  app.get("/v1/billing/subscription", async (request) => ({ subscription: await getSubscriptionForStore(db, request.store.id) }));

  app.post("/v1/billing/checkout-session", async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    try {
      const result = await createCheckoutSession(db, getStripe(), { store: request.store, ...parsed.data });
      return result;
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Could not start checkout" });
    }
  });

  // Not under /v1/* auth — Stripe calls this directly, authenticated only by
  // its own signature (see the rawBody content-type parser in server.ts).
  app.post("/v1/billing/webhook", async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    if (typeof signature !== "string" || !request.rawBody) {
      return reply.code(400).send({ error: "Missing Stripe signature or body" });
    }

    let event;
    try {
      event = getStripe().webhooks.constructEvent(request.rawBody, signature, getWebhookSecret());
    } catch (err) {
      return reply.code(400).send({ error: `Invalid signature: ${err instanceof Error ? err.message : "unknown error"}` });
    }

    const { data: existing } = await db.from("payment_events").select("id").eq("stripe_event_id", event.id).maybeSingle();
    if (existing) return reply.code(200).send({ received: true, duplicate: true });

    await db.from("payment_events").insert({ stripe_event_id: event.id, type: event.type, payload: event as unknown as Record<string, unknown> });

    try {
      await handleStripeWebhookEvent(db, event);
      await db.from("payment_events").update({ processed_at: new Date().toISOString() }).eq("stripe_event_id", event.id);
    } catch (err) {
      await db.from("payment_events").update({ error: err instanceof Error ? err.message : "unknown error" }).eq("stripe_event_id", event.id);
      // Still 200 — Stripe retries on non-2xx, and a bad event won't fix itself on retry. Failures are visible in payment_events for follow-up.
    }

    return reply.code(200).send({ received: true });
  });
}
