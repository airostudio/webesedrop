// Thin client over the engine's /v1/admin/* API — mirrors the pattern the
// storefront's own adapter uses (see ../../src/api and the pilot store's
// dropshipEngine.ts): one authorization header, JSON in and out, no ORM.

const ADMIN_KEY_STORAGE_KEY = "dropship-engine-admin-key";

export function getStoredAdminKey(): string | null {
  return localStorage.getItem(ADMIN_KEY_STORAGE_KEY);
}

export function setStoredAdminKey(key: string): void {
  localStorage.setItem(ADMIN_KEY_STORAGE_KEY, key);
}

export function clearStoredAdminKey(): void {
  localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE_URL = import.meta.env.VITE_ENGINE_API_URL ?? "http://localhost:3100";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const key = getStoredAdminKey();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...init?.headers },
  });

  if (res.status === 401) {
    clearStoredAdminKey();
    throw new ApiError("Admin key rejected — sign in again.", 401);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(typeof body?.error === "string" ? body.error : JSON.stringify(body?.error ?? `Request failed (${res.status})`), res.status);
  return body as T;
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

export interface StoreDetail {
  store: { id: string; name: string; slug: string; isActive: boolean; createdAt: string; webhookUrl: string | null };
  domains: Array<{ id: string; domain: string; source: string; firstSeenAt: string; lastSeenAt: string; isActive: boolean }>;
  subscription: { id: string; planName: string; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  invoices: Array<{ id: string; status: string; amountDueCents: number; amountPaidCents: number; createdAt: string }>;
  ordersByStatus: Record<string, number>;
  productMappingCount: number;
}

export interface DomainLogEntry {
  id: string;
  storeId: string;
  storeName: string;
  domain: string;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
  isActive: boolean;
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

export interface PlanBreakdownEntry {
  planId: string;
  planName: string;
  subscriberCount: number;
  mrrCents: number;
}

export const api = {
  overview: () => request<OverviewStats>("/v1/admin/overview"),
  stores: () => request<{ stores: StoreListEntry[] }>("/v1/admin/stores").then((r) => r.stores),
  storeDetail: (id: string) => request<StoreDetail>(`/v1/admin/stores/${id}`),
  domains: (params?: { storeId?: string; domain?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ domains: DomainLogEntry[] }>(`/v1/admin/domains${qs ? `?${qs}` : ""}`).then((r) => r.domains);
  },
  invoices: (params?: { storeId?: string; status?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<{ invoices: InvoiceListEntry[] }>(`/v1/admin/invoices${qs ? `?${qs}` : ""}`).then((r) => r.invoices);
  },
  plans: () => request<{ plans: Plan[] }>("/v1/admin/plans").then((r) => r.plans),
  createPlan: (input: { name: string; slug: string; priceCents: number; billingInterval: "month" | "year"; stripePriceId?: string }) =>
    request<Plan>("/v1/admin/plans", { method: "POST", body: JSON.stringify(input) }),
  revenueReport: () => request<{ points: Array<{ month: string; collectedCents: number }> }>("/v1/admin/reports/revenue").then((r) => r.points),
  ordersReport: () => request<{ points: Array<{ day: string; count: number }> }>("/v1/admin/reports/orders").then((r) => r.points),
  planBreakdown: () => request<{ plans: PlanBreakdownEntry[] }>("/v1/admin/reports/plans").then((r) => r.plans),
};

export function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
