import { describe, expect, it } from "vitest";
import { applyPricingRule, applyRounding, calculateRetailPrice, clampPrice, diffPriceChange, psychologicalRoundUp } from "./engine";

describe("psychologicalRoundUp", () => {
  it("rounds up to the nearest .95", () => {
    expect(psychologicalRoundUp(2160)).toBe(2195); // $21.60 -> $21.95
    expect(psychologicalRoundUp(101)).toBe(195);
  });

  it("leaves whole-dollar amounts alone", () => {
    expect(psychologicalRoundUp(2000)).toBe(2000);
  });

  it("does not round a value already at .95", () => {
    expect(psychologicalRoundUp(1995)).toBe(1995);
  });

  it("treats zero/negative as zero", () => {
    expect(psychologicalRoundUp(0)).toBe(0);
    expect(psychologicalRoundUp(-50)).toBe(0);
  });
});

describe("calculateRetailPrice", () => {
  it("applies the default 35% margin and psychological rounding", () => {
    const result = calculateRetailPrice(1600);
    expect(result.marginRate).toBe(0.35);
    expect(result.rawRetailCents).toBe(2160);
    expect(result.retailPriceCents).toBe(2195);
  });

  it("supports a custom margin rate", () => {
    const result = calculateRetailPrice(1000, 0.5);
    expect(result.rawRetailCents).toBe(1500);
    expect(result.retailPriceCents).toBe(1500);
  });

  it("rejects negative cost", () => {
    expect(() => calculateRetailPrice(-1)).toThrow();
  });
});

describe("applyRounding", () => {
  it("supports .95, .99, .00, and no rounding", () => {
    expect(applyRounding(2160, "up-95")).toBe(2195);
    expect(applyRounding(2160, "up-99")).toBe(2199);
    expect(applyRounding(2160, "up-00")).toBe(2200);
    expect(applyRounding(2160, "none")).toBe(2160);
  });
});

describe("applyPricingRule", () => {
  it("percent_margin matches calculateRetailPrice", () => {
    const result = applyPricingRule(1600, { type: "percent_margin", marginRate: 0.35, rounding: "up-95" });
    expect(result.retailPriceCents).toBe(2195);
  });

  it("clamps the computed price to the configured min/max bounds", () => {
    const rule = { type: "percent_margin" as const, marginRate: 0.35, rounding: "up-95" as const };
    expect(applyPricingRule(100, rule, { minPriceCents: 1000 }).retailPriceCents).toBe(1000);
    expect(applyPricingRule(1000000, rule, { maxPriceCents: 5000 }).retailPriceCents).toBe(5000);
    // Unclamped when within bounds.
    expect(applyPricingRule(1600, rule, { minPriceCents: 500, maxPriceCents: 5000 }).retailPriceCents).toBe(2195);
  });

  it("fixed_markup adds a flat amount and reports an effective margin rate", () => {
    const result = applyPricingRule(1000, { type: "fixed_markup", markupCents: 500, rounding: "none" });
    expect(result.rawRetailCents).toBe(1500);
    expect(result.marginRate).toBeCloseTo(0.5);
  });

  it("tiered_margin applies the first matching tier by cost", () => {
    const rule = {
      type: "tiered_margin" as const,
      tiers: [
        { maxCostCents: 1000, marginRate: 0.5 },
        { maxCostCents: 5000, marginRate: 0.35 },
        { marginRate: 0.2 },
      ],
      rounding: "up-95" as const,
    };
    expect(applyPricingRule(500, rule).marginRate).toBe(0.5);
    expect(applyPricingRule(3000, rule).marginRate).toBe(0.35);
    expect(applyPricingRule(10000, rule).marginRate).toBe(0.2);
  });
});

describe("diffPriceChange", () => {
  const rule = { type: "percent_margin" as const, marginRate: 0.35, rounding: "up-95" as const };

  it("flags a change when supplier cost moved and recomputes retail price", () => {
    const diff = diffPriceChange({ variantId: "v1", previousCostCents: 1600, previousPriceCents: 2195, newSupplierCostCents: 1800, rule });
    expect(diff.changed).toBe(true);
    expect(diff.newPriceCents).toBe(applyPricingRule(1800, rule).retailPriceCents);
  });

  it("reports no change when supplier cost is identical", () => {
    const diff = diffPriceChange({ variantId: "v1", previousCostCents: 1600, previousPriceCents: 2195, newSupplierCostCents: 1600, rule });
    expect(diff.changed).toBe(false);
  });

  it("suppresses changed when the price move is below ignoreChangeBelowPercent", () => {
    // 1600 -> 1601 moves retail price by well under 1% — should be suppressed.
    const diff = diffPriceChange({
      variantId: "v1",
      previousCostCents: 1600,
      previousPriceCents: applyPricingRule(1600, rule).retailPriceCents,
      newSupplierCostCents: 1601,
      rule,
      ignoreChangeBelowPercent: 5,
    });
    expect(diff.changed).toBe(false);
  });

  it("still flags changed when the price move exceeds ignoreChangeBelowPercent", () => {
    const diff = diffPriceChange({
      variantId: "v1",
      previousCostCents: 1600,
      previousPriceCents: applyPricingRule(1600, rule).retailPriceCents,
      newSupplierCostCents: 3200,
      rule,
      ignoreChangeBelowPercent: 5,
    });
    expect(diff.changed).toBe(true);
  });

  it("clamps the recomputed price to bounds even when suppressing the change flag", () => {
    const diff = diffPriceChange({
      variantId: "v1",
      previousCostCents: 1600,
      previousPriceCents: 2195,
      newSupplierCostCents: 100000,
      rule,
      bounds: { maxPriceCents: 5000 },
    });
    expect(diff.newPriceCents).toBe(5000);
  });
});

describe("clampPrice", () => {
  it("clamps to the floor and ceiling", () => {
    expect(clampPrice(500, { minPriceCents: 1000 })).toBe(1000);
    expect(clampPrice(50000, { maxPriceCents: 20000 })).toBe(20000);
    expect(clampPrice(1500, { minPriceCents: 1000, maxPriceCents: 20000 })).toBe(1500);
  });

  it("is a no-op with no bounds", () => {
    expect(clampPrice(1234)).toBe(1234);
  });
});
