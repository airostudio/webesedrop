import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./__tests__/fake-db";
import { createStore } from "./stores";

describe("createStore", () => {
  it("inserts a store with a hashed api key and returns the plaintext key once", async () => {
    const db = new FakeSupabase() as any;
    const result = await createStore(db, { name: "Beach Footprints", slug: "beach-footprints" });

    expect(result.name).toBe("Beach Footprints");
    expect(result.slug).toBe("beach-footprints");
    expect(result.apiKey).toMatch(/^dse_/);

    const stored = db.rows("stores")[0];
    expect(stored.api_key_hash).toBeDefined();
    expect(stored.api_key_hash).not.toBe(result.apiKey);
  });
});
