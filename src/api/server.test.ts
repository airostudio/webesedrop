import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { buildServer } from "./server";
import { FakeSupabase } from "../domain/__tests__/fake-db";
import { generateApiKey, hashApiKey } from "../auth/apiKey";

describe("server", () => {
  it("responds to /v1/health without auth", async () => {
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("responds to /v1/health without auth even with a query string appended (e.g. by a hosting rewrite)", async () => {
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({ method: "GET", url: "/v1/health?foo=bar" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects a /v1/* request with no API key", async () => {
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({ method: "GET", url: "/v1/pricing-rules" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an unknown API key", async () => {
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({ method: "GET", url: "/v1/pricing-rules", headers: { authorization: "Bearer dse_not-a-real-key" } });
    expect(res.statusCode).toBe(401);
  });

  it("authenticates a valid API key and reaches the route handler", async () => {
    const db = new FakeSupabase() as any;
    const apiKey = generateApiKey();
    db.seed("stores", [{ id: "store-1", name: "Beach Footprints", slug: "beach-footprints", api_key_hash: hashApiKey(apiKey), is_active: true }]);
    db.seed("pricing_rules", [{ id: "rule-1", store_id: "store-1", name: "Default", rule: { type: "percent_margin", marginRate: 0.35, rounding: "up-95" }, is_default: true }]);

    const app = buildServer(db);
    const res = await app.inject({ method: "GET", url: "/v1/pricing-rules", headers: { authorization: `Bearer ${apiKey}` } });

    expect(res.statusCode).toBe(200);
    expect(res.json().rules).toHaveLength(1);
  });
});

describe("server: admin auth", () => {
  const ORIGINAL_ADMIN_KEY = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin_test_key";

  it("rejects an admin request with no key", async () => {
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({ method: "GET", url: "/v1/admin/overview" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an admin request with the wrong key", async () => {
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({ method: "GET", url: "/v1/admin/overview", headers: { authorization: "Bearer wrong" } });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid admin key and never checks it against the stores table", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: "store-1", name: "Beach Footprints", is_active: true, created_at: new Date().toISOString() }]);
    const app = buildServer(db);

    const res = await app.inject({ method: "GET", url: "/v1/admin/overview", headers: { authorization: "Bearer admin_test_key" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ totalStores: 1 });
  });

  it("a store API key does not grant admin access", async () => {
    const db = new FakeSupabase() as any;
    const apiKey = generateApiKey();
    db.seed("stores", [{ id: "store-1", name: "Beach Footprints", slug: "beach-footprints", api_key_hash: hashApiKey(apiKey), is_active: true }]);
    const app = buildServer(db);

    const res = await app.inject({ method: "GET", url: "/v1/admin/stores", headers: { authorization: `Bearer ${apiKey}` } });
    expect(res.statusCode).toBe(401);
  });

  it("creates a store via POST /v1/admin/stores and returns its plaintext api key once", async () => {
    const db = new FakeSupabase() as any;
    const app = buildServer(db);

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/stores",
      headers: { authorization: "Bearer admin_test_key" },
      payload: { name: "Beach Footprints", slug: "beach-footprints" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.slug).toBe("beach-footprints");
    expect(body.apiKey).toMatch(/^dse_/);
  });

  it("rejects POST /v1/admin/stores without a valid admin key", async () => {
    const db = new FakeSupabase() as any;
    const app = buildServer(db);

    const res = await app.inject({ method: "POST", url: "/v1/admin/stores", payload: { name: "x", slug: "x" } });
    expect(res.statusCode).toBe(401);
  });

  if (ORIGINAL_ADMIN_KEY !== undefined) process.env.ADMIN_API_KEY = ORIGINAL_ADMIN_KEY;
});

describe("server: billing webhook", () => {
  const webhookSecret = "whsec_test_secret";
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;

  function signedPayload(event: Record<string, unknown>) {
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return { payload, header };
  }

  it("rejects a webhook call with an invalid signature", async () => {
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      payload: JSON.stringify({ id: "evt_bad", type: "customer.subscription.updated" }),
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts a validly-signed event, logs it, and is idempotent on redelivery", async () => {
    const db = new FakeSupabase() as any;
    const { payload, header } = signedPayload({ id: "evt_ok", type: "charge.succeeded", data: { object: {} } });
    const app = buildServer(db);

    const first = await app.inject({ method: "POST", url: "/v1/billing/webhook", payload, headers: { "content-type": "application/json", "stripe-signature": header } });
    expect(first.statusCode).toBe(200);
    expect(db.rows("payment_events")).toHaveLength(1);

    const second = await app.inject({ method: "POST", url: "/v1/billing/webhook", payload, headers: { "content-type": "application/json", "stripe-signature": header } });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ duplicate: true });
    expect(db.rows("payment_events")).toHaveLength(1);
  });

  it("does not require a store or admin API key", async () => {
    const { payload, header } = signedPayload({ id: "evt_no_auth", type: "charge.succeeded", data: { object: {} } });
    const app = buildServer(new FakeSupabase() as any);
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhook", payload, headers: { "content-type": "application/json", "stripe-signature": header } });
    expect(res.statusCode).toBe(200);
  });
});
