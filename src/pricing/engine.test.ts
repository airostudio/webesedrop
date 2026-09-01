import { describe, expect, it } from "vitest";
import { applyPricingRule, applyRounding, calculateRetailPrice, diffPriceChange, psychologicalRoundUp } from "./engine";

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
});
