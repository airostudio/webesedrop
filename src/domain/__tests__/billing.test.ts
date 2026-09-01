import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { FakeSupabase } from "./fake-db";
import {
  createCheckoutSession,
  createPlan,
  getOrCreateStripeCustomer,
  getSubscriptionForStore,
  handleStripeWebhookEvent,
  listPlans,
} from "../billing";

function seedPlan(db: FakeSupabase, overrides: Partial<Record<string, any>> = {}) {
  db.seed("plans", [
    ...db.rows("plans"),
    {
      id: "plan-pro",
      name: "Pro",
      slug: "pro",
      price_cents: 4900,
      billing_interval: "month",
      stripe_price_id: "price_pro_monthly",
      features: {},
      is_active: true,
      ...overrides,
    },
  ]);
}

function fakeStripe(overrides: Partial<Stripe> = {}): Stripe {
  return {
    customers: { create: vi.fn(async (params: any) => ({ id: "cus_123", ...params })) },
    checkout: { sessions: { create: vi.fn(async () => ({ url: "https://checkout.stripe.com/session/abc" })) } },
    ...overrides,
  } as unknown as Stripe;
}

describe("billing: plans", () => {
  it("lists only active plans by default", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db);
    seedPlan(db, { id: "plan-old", slug: "old", is_active: false });

    expect(await listPlans(db)).toHaveLength(1);
    expect(await listPlans(db, true)).toHaveLength(2);
  });

  it("creates a plan", async () => {
    const db = new FakeSupabase() as any;
    const plan = await createPlan(db, { name: "Starter", slug: "starter", priceCents: 1900, billingInterval: "month" });
    expect(plan.name).toBe("Starter");
    expect(db.rows("plans")).toHaveLength(1);
  });
});

describe("billing: Stripe customer + checkout", () => {
  it("creates a Stripe customer once and reuses it on subsequent calls", async () => {
    const db = new FakeSupabase() as any;
    const stripe = fakeStripe();
    const store = { id: "store-1", name: "Beach Footprints", slug: "beach-footprints" };

    const first = await getOrCreateStripeCustomer(db, stripe, store);
    const second = await getOrCreateStripeCustomer(db, stripe, store);

    expect(first).toBe("cus_123");
    expect(second).toBe("cus_123");
    expect((stripe.customers.create as any).mock.calls).toHaveLength(1);
  });

  it("creates a checkout session against the plan's Stripe price", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db);
    const stripe = fakeStripe();

    const result = await createCheckoutSession(db, stripe, {
      store: { id: "store-1", name: "Beach Footprints", slug: "beach-footprints" },
      planId: "plan-pro",
      successUrl: "https://beachfootprints.com/billing/success",
      cancelUrl: "https://beachfootprints.com/billing/cancel",
    });

    expect(result.checkoutUrl).toBe("https://checkout.stripe.com/session/abc");
    const createCall = (stripe.checkout.sessions.create as any).mock.calls[0][0];
    expect(createCall.line_items[0].price).toBe("price_pro_monthly");
    expect(createCall.customer).toBe("cus_123");
  });

  it("rejects a plan with no Stripe price configured", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db, { stripe_price_id: null });
    const stripe = fakeStripe();

    await expect(
      createCheckoutSession(db, stripe, {
        store: { id: "store-1", name: "Beach Footprints", slug: "beach-footprints" },
        planId: "plan-pro",
        successUrl: "https://x.com/ok",
        cancelUrl: "https://x.com/cancel",
      }),
    ).rejects.toThrow(/no Stripe price/i);
  });
});

describe("billing: getSubscriptionForStore", () => {
  it("returns the most recent non-canceled subscription with its plan name", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db);
    db.seed("subscriptions", [
      { id: "sub-old", store_id: "store-1", plan_id: "plan-pro", status: "canceled", created_at: "2026-01-01T00:00:00Z" },
      { id: "sub-new", store_id: "store-1", plan_id: "plan-pro", status: "active", created_at: "2026-02-01T00:00:00Z", current_period_start: "2026-02-01T00:00:00Z", current_period_end: "2026-03-01T00:00:00Z", cancel_at_period_end: false },
    ]);

    const sub = await getSubscriptionForStore(db, "store-1");
    expect(sub).toMatchObject({ id: "sub-new", planName: "Pro", status: "active" });
  });

  it("returns null when the store has no current subscription", async () => {
    const db = new FakeSupabase() as any;
    expect(await getSubscriptionForStore(db, "store-1")).toBeNull();
  });
});

describe("billing: Stripe webhook handling", () => {
  function subscriptionEvent(type: string, overrides: Partial<Record<string, any>> = {}): Stripe.Event {
    return {
      id: "evt_1",
      type,
      data: {
        object: {
          id: "sub_stripe_1",
          customer: "cus_123",
          status: "active",
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          cancel_at_period_end: false,
          canceled_at: null,
          items: { data: [{ price: { id: "price_pro_monthly" } }] },
          metadata: { storeId: "store-1", planId: "plan-pro" },
          ...overrides,
        },
      },
    } as unknown as Stripe.Event;
  }

  it("creates a subscription row from customer.subscription.created", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db);

    await handleStripeWebhookEvent(db, subscriptionEvent("customer.subscription.created"));

    const rows = db.rows("subscriptions");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store_id: "store-1", plan_id: "plan-pro", status: "active", stripe_subscription_id: "sub_stripe_1" });
  });

  it("updates the existing row (not a duplicate) on a redelivered/updated event", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db);

    await handleStripeWebhookEvent(db, subscriptionEvent("customer.subscription.created"));
    await handleStripeWebhookEvent(db, subscriptionEvent("customer.subscription.updated", { status: "past_due" }));

    const rows = db.rows("subscriptions");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("past_due");
  });

  it("falls back to the stripe_customers mapping when metadata is missing", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db);
    db.seed("stripe_customers", [{ store_id: "store-9", stripe_customer_id: "cus_456" }]);

    await handleStripeWebhookEvent(
      db,
      subscriptionEvent("customer.subscription.created", { customer: "cus_456", metadata: {}, items: { data: [{ price: { id: "price_pro_monthly" } }] } }),
    );

    expect(db.rows("subscriptions")[0].store_id).toBe("store-9");
  });

  it("upserts an invoice from invoice.paid, linking it to the matching subscription", async () => {
    const db = new FakeSupabase() as any;
    seedPlan(db);
    db.seed("stripe_customers", [{ store_id: "store-1", stripe_customer_id: "cus_123" }]);
    db.seed("subscriptions", [{ id: "sub-row-1", store_id: "store-1", plan_id: "plan-pro", stripe_subscription_id: "sub_stripe_1", status: "active" }]);

    const invoiceEvent = {
      id: "evt_2",
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          customer: "cus_123",
          subscription: "sub_stripe_1",
          status: "paid",
          amount_due: 4900,
          amount_paid: 4900,
          currency: "usd",
          period_start: 1700000000,
          period_end: 1702592000,
          hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
        },
      },
    } as unknown as Stripe.Event;

    await handleStripeWebhookEvent(db, invoiceEvent);

    const rows = db.rows("invoices");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ store_id: "store-1", subscription_id: "sub-row-1", status: "paid", amount_paid_cents: 4900 });
  });

  it("ignores event types it doesn't act on", async () => {
    const db = new FakeSupabase() as any;
    await expect(handleStripeWebhookEvent(db, { id: "evt_3", type: "charge.succeeded", data: { object: {} } } as unknown as Stripe.Event)).resolves.toBeUndefined();
  });
});
