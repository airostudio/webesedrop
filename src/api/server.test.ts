import { describe, expect, it } from "vitest";
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
