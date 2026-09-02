import { describe, expect, it } from "vitest";
import { FakeSupabase } from "./__tests__/fake-db";
import { DEFAULT_STORE_SETTINGS, getStoreSettings, updateStoreSettings } from "./settings";

const STORE_ID = "store-1";

describe("getStoreSettings", () => {
  it("returns full defaults when a store has no settings saved", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID }]);

    const settings = await getStoreSettings(db, STORE_ID);
    expect(settings).toEqual(DEFAULT_STORE_SETTINGS);
  });

  it("merges saved settings over the defaults, section by section", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID, settings: { pricing: { minPriceCents: 500 }, notifications: { priceChanged: false } } }]);

    const settings = await getStoreSettings(db, STORE_ID);
    expect(settings.pricing.minPriceCents).toBe(500);
    expect(settings.notifications.priceChanged).toBe(false);
    // Untouched notification fields still default to true.
    expect(settings.notifications.outOfStock).toBe(true);
    expect(settings.import.defaultStatus).toBe("draft");
  });
});

describe("updateStoreSettings", () => {
  it("persists a patch and returns the resolved settings", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID }]);

    const updated = await updateStoreSettings(db, STORE_ID, { stock: { outOfStockBehavior: "keep_visible" } });
    expect(updated.stock.outOfStockBehavior).toBe("keep_visible");

    const reloaded = await getStoreSettings(db, STORE_ID);
    expect(reloaded.stock.outOfStockBehavior).toBe("keep_visible");
  });

  it("a later patch to one section does not clobber a previously-saved different section", async () => {
    const db = new FakeSupabase() as any;
    db.seed("stores", [{ id: STORE_ID }]);

    await updateStoreSettings(db, STORE_ID, { pricing: { minPriceCents: 500 } });
    await updateStoreSettings(db, STORE_ID, { shipping: { preferredLogisticsService: "ePacket" } });

    const settings = await getStoreSettings(db, STORE_ID);
    expect(settings.pricing.minPriceCents).toBe(500);
    expect(settings.shipping.preferredLogisticsService).toBe("ePacket");
  });
});
