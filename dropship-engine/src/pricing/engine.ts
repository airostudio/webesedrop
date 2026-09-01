/**
 * Pricing engine. All money is integer minor units (cents).
 *
 * `calculateRetailPrice` is the original fixed-percent-margin primitive
 * (Beach Footprints' pilot config: 35% + round up to .95). `PricingRule` /
 * `applyPricingRule` generalize it so a connected store can configure
 * percent-margin, fixed-markup, or tiered-by-cost rules — the common
 * "margin rules" surface every competitor (DSers, AutoDS, Ali2Woo) exposes.
 */

export const DEFAULT_MARGIN_RATE = 0.35;

export type RoundingMode = "none" | "up-95" | "up-99" | "up-00";

export interface RetailPriceResult {
  supplierCostCents: number;
  marginRate: number;
  /** Cost * (1 + marginRate), before rounding. */
  rawRetailCents: number;
  retailPriceCents: number;
}

function roundTo(cents: number, endingCents: number): number {
  if (cents <= 0) return 0;
  const dollars = Math.floor(cents / 100);
  const target = dollars * 100 + endingCents;
  return cents <= target ? target : (dollars + 1) * 100 + endingCents;
}

/** Rounds a price up to the nearest `.95`, unless it's already a whole dollar amount, in which case it's left alone. Never rounds down. */
export function psychologicalRoundUp(cents: number): number {
  if (cents <= 0) return 0;
  if (cents % 100 === 0) return cents;
  return roundTo(cents, 95);
}

export function applyRounding(cents: number, mode: RoundingMode): number {
  switch (mode) {
    case "none":
      return Math.max(0, Math.round(cents));
    case "up-95":
      return psychologicalRoundUp(cents);
    case "up-99":
      return cents <= 0 ? 0 : cents % 100 === 0 ? cents : roundTo(cents, 99);
    case "up-00":
      return cents <= 0 ? 0 : (Math.floor((cents - 1) / 100) + 1) * 100;
  }
}

export function calculateRetailPrice(supplierCostCents: number, marginRate: number = DEFAULT_MARGIN_RATE): RetailPriceResult {
  if (supplierCostCents < 0) throw new Error("supplierCostCents must be >= 0");
  if (marginRate < 0) throw new Error("marginRate must be >= 0");

  const rawRetailCents = Math.round(supplierCostCents * (1 + marginRate));
  return {
    supplierCostCents,
    marginRate,
    rawRetailCents,
    retailPriceCents: psychologicalRoundUp(rawRetailCents),
  };
}

// ── Configurable pricing rules ──────────────────────────────────────────

export interface PercentMarginRule {
  type: "percent_margin";
  marginRate: number; // e.g. 0.35 = cost * 1.35
  rounding: RoundingMode;
}

export interface FixedMarkupRule {
  type: "fixed_markup";
  markupCents: number; // e.g. 500 = cost + $5.00
  rounding: RoundingMode;
}

/** Tiers are evaluated in order; the first tier whose maxCostCents >= cost applies. The last tier should omit maxCostCents to act as a catch-all. */
export interface TieredMarginRule {
  type: "tiered_margin";
  tiers: Array<{ maxCostCents?: number; marginRate: number }>;
  rounding: RoundingMode;
}

export type PricingRule = PercentMarginRule | FixedMarkupRule | TieredMarginRule;

export function applyPricingRule(supplierCostCents: number, rule: PricingRule): RetailPriceResult {
  if (supplierCostCents < 0) throw new Error("supplierCostCents must be >= 0");

  let rawRetailCents: number;
  let effectiveMarginRate: number;

  switch (rule.type) {
    case "percent_margin": {
      effectiveMarginRate = rule.marginRate;
      rawRetailCents = Math.round(supplierCostCents * (1 + rule.marginRate));
      break;
    }
    case "fixed_markup": {
      rawRetailCents = supplierCostCents + rule.markupCents;
      effectiveMarginRate = supplierCostCents > 0 ? rule.markupCents / supplierCostCents : 0;
      break;
    }
    case "tiered_margin": {
      const tier = rule.tiers.find((t) => t.maxCostCents === undefined || supplierCostCents <= t.maxCostCents) ?? rule.tiers[rule.tiers.length - 1];
      if (!tier) throw new Error("tiered_margin rule has no tiers");
      effectiveMarginRate = tier.marginRate;
      rawRetailCents = Math.round(supplierCostCents * (1 + tier.marginRate));
      break;
    }
  }

  return {
    supplierCostCents,
    marginRate: effectiveMarginRate,
    rawRetailCents,
    retailPriceCents: applyRounding(rawRetailCents, rule.rounding),
  };
}

export interface PriceChange {
  variantId: string;
  previousCostCents: number | null;
  newCostCents: number;
  previousPriceCents: number | null;
  newPriceCents: number;
  marginRate: number;
  changed: boolean;
}

/** Compares a variant's stored cost/price against a freshly-fetched supplier cost, for the daily sync's price-log step. */
export function diffPriceChange(params: {
  variantId: string;
  previousCostCents: number | null;
  previousPriceCents: number | null;
  newSupplierCostCents: number;
  rule: PricingRule;
}): PriceChange {
  const { retailPriceCents, marginRate } = applyPricingRule(params.newSupplierCostCents, params.rule);
  return {
    variantId: params.variantId,
    previousCostCents: params.previousCostCents,
    newCostCents: params.newSupplierCostCents,
    previousPriceCents: params.previousPriceCents,
    newPriceCents: retailPriceCents,
    marginRate,
    changed: params.previousCostCents !== params.newSupplierCostCents,
  };
}

export const DEFAULT_PRICING_RULE: PricingRule = { type: "percent_margin", marginRate: DEFAULT_MARGIN_RATE, rounding: "up-95" };
