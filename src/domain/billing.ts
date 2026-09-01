import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export interface Plan {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  billingInterval: "month" | "year";
  stripePriceId: string | null;
  features: Record<string, unknown>;
  isActive: boolean;
}

function toPlan(row: any): Plan {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    priceCents: row.price_cents,
    billingInterval: row.billing_interval,
    stripePriceId: row.stripe_price_id,
    features: row.features ?? {},
    isActive: row.is_active,
  };
}

export async function listPlans(db: SupabaseClient, includeInactive = false): Promise<Plan[]> {
  const { data } = await db.from("plans").select("id, name, slug, price_cents, billing_interval, stripe_price_id, features, is_active");
  return (data ?? []).filter((row: any) => includeInactive || row.is_active).map(toPlan);
}

export async function createPlan(
  db: SupabaseClient,
  input: { name: string; slug: string; priceCents: number; billingInterval: "month" | "year"; stripePriceId?: string; features?: Record<string, unknown> },
): Promise<Plan> {
  const { data, error } = await db
    .from("plans")
    .insert({
      name: input.name,
      slug: input.slug,
      price_cents: input.priceCents,
      billing_interval: input.billingInterval,
      stripe_price_id: input.stripePriceId ?? null,
      features: input.features ?? {},
    })
    .select("id, name, slug, price_cents, billing_interval, stripe_price_id, features, is_active")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Could not create plan");
  return toPlan(data);
}

/** Finds this store's Stripe customer, creating one (and persisting the mapping) if none exists yet. */
export async function getOrCreateStripeCustomer(
  db: SupabaseClient,
  stripe: Stripe,
  store: { id: string; name: string; slug: string },
): Promise<string> {
  const { data: existing } = await db.from("stripe_customers").select("stripe_customer_id").eq("store_id", store.id).maybeSingle();
  if (existing) return existing.stripe_customer_id as string;

  const customer = await stripe.customers.create({ name: store.name, metadata: { storeId: store.id, storeSlug: store.slug } });
  await db.from("stripe_customers").insert({ store_id: store.id, stripe_customer_id: customer.id });
  return customer.id;
}

export async function createCheckoutSession(
  db: SupabaseClient,
  stripe: Stripe,
  params: { store: { id: string; name: string; slug: string }; planId: string; successUrl: string; cancelUrl: string },
): Promise<{ checkoutUrl: string }> {
  const { data: plan } = await db.from("plans").select("id, stripe_price_id").eq("id", params.planId).maybeSingle();
  if (!plan?.stripe_price_id) throw new Error("Plan not found or has no Stripe price configured");

  const customerId = await getOrCreateStripeCustomer(db, stripe, params.store);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: { storeId: params.store.id, planId: plan.id },
    subscription_data: { metadata: { storeId: params.store.id, planId: plan.id } },
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { checkoutUrl: session.url };
}

export interface SubscriptionSummary {
  id: string;
  planId: string;
  planName: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export async function getSubscriptionForStore(db: SupabaseClient, storeId: string): Promise<SubscriptionSummary | null> {
  const { data: subs } = await db
    .from("subscriptions")
    .select("id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, created_at")
    .eq("store_id", storeId);
  const active = (subs ?? []).filter((s: any) => s.status !== "canceled" && s.status !== "incomplete_expired").sort((a: any, b: any) => (a.created_at < b.created_at ? 1 : -1))[0];
  if (!active) return null;

  const { data: plan } = await db.from("plans").select("id, name").eq("id", active.plan_id).maybeSingle();
  return {
    id: active.id,
    planId: active.plan_id,
    planName: plan?.name ?? "Unknown plan",
    status: active.status,
    currentPeriodStart: active.current_period_start,
    currentPeriodEnd: active.current_period_end,
    cancelAtPeriodEnd: active.cancel_at_period_end,
  };
}

async function findStoreIdForCustomer(db: SupabaseClient, stripeCustomerId: string): Promise<string | null> {
  const { data } = await db.from("stripe_customers").select("store_id").eq("stripe_customer_id", stripeCustomerId).maybeSingle();
  return data?.store_id ?? null;
}

async function findPlanIdForStripePrice(db: SupabaseClient, stripePriceId: string | undefined): Promise<string | null> {
  if (!stripePriceId) return null;
  const { data } = await db.from("plans").select("id").eq("stripe_price_id", stripePriceId).maybeSingle();
  return data?.id ?? null;
}

async function upsertSubscriptionFromStripe(db: SupabaseClient, sub: Stripe.Subscription): Promise<void> {
  const storeId = (sub.metadata?.storeId as string | undefined) ?? (await findStoreIdForCustomer(db, sub.customer as string));
  if (!storeId) return;

  const priceId = sub.items.data[0]?.price?.id;
  const planId = (sub.metadata?.planId as string | undefined) ?? (await findPlanIdForStripePrice(db, priceId));
  if (!planId) return;

  const { data: existing } = await db.from("subscriptions").select("id").eq("stripe_subscription_id", sub.id).maybeSingle();
  const payload = {
    store_id: storeId,
    plan_id: planId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
  };

  if (existing) {
    await db.from("subscriptions").update(payload).eq("id", existing.id);
  } else {
    await db.from("subscriptions").insert(payload);
  }
}

async function upsertInvoiceFromStripe(db: SupabaseClient, invoice: Stripe.Invoice): Promise<void> {
  const storeId = (await findStoreIdForCustomer(db, invoice.customer as string)) ?? null;
  if (!storeId) return;

  const stripeSubscriptionId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
  let subscriptionId: string | null = null;
  if (stripeSubscriptionId) {
    const { data } = await db.from("subscriptions").select("id").eq("stripe_subscription_id", stripeSubscriptionId).maybeSingle();
    subscriptionId = data?.id ?? null;
  }

  const { data: existing } = await db.from("invoices").select("id").eq("stripe_invoice_id", invoice.id).maybeSingle();
  const payload = {
    store_id: storeId,
    subscription_id: subscriptionId,
    stripe_invoice_id: invoice.id,
    status: invoice.status ?? "open",
    amount_due_cents: invoice.amount_due,
    amount_paid_cents: invoice.amount_paid,
    currency: invoice.currency,
    period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    paid_at: invoice.status === "paid" ? new Date().toISOString() : null,
  };

  if (existing) {
    await db.from("invoices").update(payload).eq("id", existing.id);
  } else {
    await db.from("invoices").insert(payload);
  }
}

/**
 * Applies one Stripe webhook event to our billing tables. Idempotent by
 * design (upserts keyed on the Stripe object id) so a redelivered event is
 * harmless. Signature verification happens at the route layer — this
 * function trusts the event object it's given.
 */
export async function handleStripeWebhookEvent(db: SupabaseClient, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await upsertSubscriptionFromStripe(db, event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.finalized":
      await upsertInvoiceFromStripe(db, event.data.object as Stripe.Invoice);
      break;
    default:
      break; // logged to payment_events regardless; nothing else to apply
  }
}
