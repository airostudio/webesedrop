import type { SupabaseClient } from "@supabase/supabase-js";
import { listAllDomains, listDomainsForStore } from "./domains";
import { getSubscriptionForStore, listPlans, type Plan } from "./billing";

const CURRENT_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due"]);

function monthlyValueCents(plan: Pick<Plan, "priceCents" | "billingInterval">): number {
  return plan.billingInterval === "year" ? Math.round(plan.priceCents / 12) : plan.priceCents;
}

function startOfMonthIso(date = new Date()): string {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
}

function monthBucket(iso: string): string {
  return iso.slice(0, 7); // "YYYY-MM"
}

function dayBucket(iso: string): string {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}

interface RawSubscription {
  id: string;
  store_id: string;
  plan_id: string;
  status: string;
  created_at: string;
}

async function loadCurrentSubscriptionsWithPlans(db: SupabaseClient): Promise<Array<{ storeId: string; plan: Plan; status: string }>> {
  const { data: subs } = await db.from("subscriptions").select("id, store_id, plan_id, status, created_at");
  const plans = await listPlans(db, true);
  const planById = new Map(plans.map((p) => [p.id, p]));

  return ((subs ?? []) as RawSubscription[])
    .filter((s) => CURRENT_SUBSCRIPTION_STATUSES.has(s.status))
    .map((s) => ({ storeId: s.store_id, plan: planById.get(s.plan_id), status: s.status }))
    .filter((s): s is { storeId: string; plan: Plan; status: string } => Boolean(s.plan));
}

export interface OverviewStats {
  totalStores: number;
  activeStores: number;
  totalDomains: number;
  activeSubscriptions: number;
  pastDueSubscriptions: number;
  mrrCents: number;
  ordersThisMonth: number;
  ordersFulfilledThisMonth: number;
  revenueCollectedThisMonthCents: number;
}

export async function getOverviewStats(db: SupabaseClient): Promise<OverviewStats> {
  const { data: stores } = await db.from("stores").select("id, is_active");
  const { data: orders } = await db.from("orders").select("id, fulfillment_status, created_at");
  const { data: invoices } = await db.from("invoices").select("id, status, amount_paid_cents, paid_at");
  const domains = await listAllDomains(db);
  const currentSubs = await loadCurrentSubscriptionsWithPlans(db);

  const monthStart = startOfMonthIso();
  const ordersThisMonth = (orders ?? []).filter((o: any) => o.created_at >= monthStart);
  const revenueCollectedThisMonthCents = (invoices ?? [])
    .filter((i: any) => i.status === "paid" && i.paid_at && i.paid_at >= monthStart)
    .reduce((sum: number, i: any) => sum + (i.amount_paid_cents ?? 0), 0);

  return {
    totalStores: (stores ?? []).length,
    activeStores: (stores ?? []).filter((s: any) => s.is_active).length,
    totalDomains: domains.length,
    activeSubscriptions: currentSubs.filter((s) => s.status !== "past_due").length,
    pastDueSubscriptions: currentSubs.filter((s) => s.status === "past_due").length,
    mrrCents: currentSubs.reduce((sum, s) => sum + monthlyValueCents(s.plan), 0),
    ordersThisMonth: ordersThisMonth.length,
    ordersFulfilledThisMonth: ordersThisMonth.filter((o: any) => o.fulfillment_status === "shipped" || o.fulfillment_status === "delivered").length,
    revenueCollectedThisMonthCents,
  };
}

export interface StoreListEntry {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  domainCount: number;
  orderCount: number;
  planName: string | null;
  subscriptionStatus: string | null;
  mrrContributionCents: number;
}

export async function listStoresWithBilling(db: SupabaseClient): Promise<StoreListEntry[]> {
  const { data: stores } = await db.from("stores").select("id, name, slug, is_active, created_at");
  const { data: orders } = await db.from("orders").select("id, store_id");
  const domains = await listAllDomains(db);
  const currentSubs = await loadCurrentSubscriptionsWithPlans(db);
  const subByStore = new Map(currentSubs.map((s) => [s.storeId, s]));

  return ((stores ?? []) as any[]).map((store) => {
    const sub = subByStore.get(store.id);
    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      isActive: store.is_active,
      createdAt: store.created_at,
      domainCount: domains.filter((d) => d.storeId === store.id).length,
      orderCount: (orders ?? []).filter((o: any) => o.store_id === store.id).length,
      planName: sub?.plan.name ?? null,
      subscriptionStatus: sub?.status ?? null,
      mrrContributionCents: sub ? monthlyValueCents(sub.plan) : 0,
    };
  });
}

export interface StoreDetail {
  store: { id: string; name: string; slug: string; isActive: boolean; createdAt: string; webhookUrl: string | null };
  domains: Awaited<ReturnType<typeof listDomainsForStore>>;
  subscription: Awaited<ReturnType<typeof getSubscriptionForStore>>;
  invoices: Array<{ id: string; status: string; amountDueCents: number; amountPaidCents: number; createdAt: string }>;
  ordersByStatus: Record<string, number>;
  productMappingCount: number;
}

export async function getStoreDetail(db: SupabaseClient, storeId: string): Promise<StoreDetail | null> {
  const { data: store } = await db.from("stores").select("id, name, slug, is_active, created_at, webhook_url").eq("id", storeId).maybeSingle();
  if (!store) return null;

  const { data: invoices } = await db
    .from("invoices")
    .select("id, status, amount_due_cents, amount_paid_cents, created_at")
    .eq("store_id", storeId);
  const { data: orders } = await db.from("orders").select("id, fulfillment_status").eq("store_id", storeId);
  const { data: mappings } = await db.from("product_mappings").select("id").eq("store_id", storeId);

  const ordersByStatus: Record<string, number> = {};
  for (const order of (orders ?? []) as any[]) {
    ordersByStatus[order.fulfillment_status] = (ordersByStatus[order.fulfillment_status] ?? 0) + 1;
  }

  return {
    store: { id: store.id, name: store.name, slug: store.slug, isActive: store.is_active, createdAt: store.created_at, webhookUrl: store.webhook_url },
    domains: await listDomainsForStore(db, storeId),
    subscription: await getSubscriptionForStore(db, storeId),
    invoices: ((invoices ?? []) as any[])
      .map((i) => ({ id: i.id, status: i.status, amountDueCents: i.amount_due_cents, amountPaidCents: i.amount_paid_cents, createdAt: i.created_at }))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    ordersByStatus,
    productMappingCount: (mappings ?? []).length,
  };
}

export interface InvoiceListEntry {
  id: string;
  storeId: string;
  storeName: string;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
}

export async function listInvoices(db: SupabaseClient, filters?: { storeId?: string; status?: string }): Promise<InvoiceListEntry[]> {
  const { data: invoices } = await db
    .from("invoices")
    .select("id, store_id, status, amount_due_cents, amount_paid_cents, currency, created_at, paid_at, hosted_invoice_url");
  const { data: stores } = await db.from("stores").select("id, name");
  const storeNameById = new Map((stores ?? []).map((s: any) => [s.id, s.name as string]));

  return ((invoices ?? []) as any[])
    .filter((i) => (filters?.storeId ? i.store_id === filters.storeId : true))
    .filter((i) => (filters?.status ? i.status === filters.status : true))
    .map((i) => ({
      id: i.id,
      storeId: i.store_id,
      storeName: storeNameById.get(i.store_id) ?? "Unknown store",
      status: i.status,
      amountDueCents: i.amount_due_cents,
      amountPaidCents: i.amount_paid_cents,
      currency: i.currency,
      createdAt: i.created_at,
      paidAt: i.paid_at,
      hostedInvoiceUrl: i.hosted_invoice_url,
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface RevenuePoint {
  month: string; // "YYYY-MM"
  collectedCents: number;
}

/** Cash-basis revenue collected per month, from paid invoices — an accounting figure, not a projected run-rate. */
export async function getRevenueTimeseries(db: SupabaseClient): Promise<RevenuePoint[]> {
  const { data: invoices } = await db.from("invoices").select("status, amount_paid_cents, paid_at");
  const byMonth = new Map<string, number>();
  for (const invoice of (invoices ?? []) as any[]) {
    if (invoice.status !== "paid" || !invoice.paid_at) continue;
    const month = monthBucket(invoice.paid_at);
    byMonth.set(month, (byMonth.get(month) ?? 0) + invoice.amount_paid_cents);
  }
  return [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, collectedCents]) => ({ month, collectedCents }));
}

export interface OrdersPoint {
  day: string; // "YYYY-MM-DD"
  count: number;
}

export async function getOrdersTimeseries(db: SupabaseClient): Promise<OrdersPoint[]> {
  const { data: orders } = await db.from("orders").select("created_at");
  const byDay = new Map<string, number>();
  for (const order of (orders ?? []) as any[]) {
    const day = dayBucket(order.created_at);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, count]) => ({ day, count }));
}

export interface PlanBreakdownEntry {
  planId: string;
  planName: string;
  subscriberCount: number;
  mrrCents: number;
}

export async function getPlanBreakdown(db: SupabaseClient): Promise<PlanBreakdownEntry[]> {
  const currentSubs = await loadCurrentSubscriptionsWithPlans(db);
  const byPlan = new Map<string, PlanBreakdownEntry>();
  for (const sub of currentSubs) {
    const existing = byPlan.get(sub.plan.id) ?? { planId: sub.plan.id, planName: sub.plan.name, subscriberCount: 0, mrrCents: 0 };
    existing.subscriberCount += 1;
    existing.mrrCents += monthlyValueCents(sub.plan);
    byPlan.set(sub.plan.id, existing);
  }
  return [...byPlan.values()].sort((a, b) => b.mrrCents - a.mrrCents);
}
