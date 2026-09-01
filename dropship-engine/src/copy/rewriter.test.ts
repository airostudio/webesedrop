import { describe, expect, it } from "vitest";
import { BEACH_FOOTPRINTS_VOICE, buildDescriptionTemplate, formatStructuredDescription, rewriteProductCopy, sanitizeTitle, toOnBrandName } from "./rewriter";
import type { BrandVoice, CopyProvider } from "./rewriter";

const NEUTRAL_VOICE: BrandVoice = { storeName: "Test Store" };

describe("sanitizeTitle", () => {
  it("strips dropshipping buzzwords", () => {
    const title = sanitizeTitle("2026 Hot Sale Sexy Floral Kimono Coverup Dropship Free Shipping!!");
    expect(title.toLowerCase()).not.toContain("hot sale");
    expect(title.toLowerCase()).not.toContain("dropship");
    expect(title.toLowerCase()).not.toContain("sexy");
    expect(title.toLowerCase()).not.toContain("free shipping");
  });

  it("drops marketplace suffixes after a pipe", () => {
    expect(sanitizeTitle("Boho Kimono | Free Shipping | AliExpress")).toBe("Boho Kimono");
  });
});

describe("toOnBrandName", () => {
  it("with no descriptors configured, returns the sanitized title unchanged (neutral pass-through)", () => {
    const name = toOnBrandName("2026 Hot Sale Floral Kimono Coverup", NEUTRAL_VOICE);
    expect(name).toBe(sanitizeTitle("2026 Hot Sale Floral Kimono Coverup"));
  });

  it("with descriptors configured, applies the store's brand style", () => {
    const name = toOnBrandName("Floral Kimono Coverup", BEACH_FOOTPRINTS_VOICE);
    expect(name).toMatch(/Boho Coastal/);
    expect(name).toContain("Kimono");
  });

  it("is idempotent on an already-prefixed name", () => {
    const first = toOnBrandName("Floral Kimono Coverup", BEACH_FOOTPRINTS_VOICE, 0);
    const second = toOnBrandName(first, BEACH_FOOTPRINTS_VOICE, 0);
    expect(second).toBe(first);
  });
});

describe("buildDescriptionTemplate / formatStructuredDescription", () => {
  it("produces all four sections with the store's own labels", () => {
    const description = buildDescriptionTemplate({
      onBrandName: "Sun-Drenched Boho Coastal Kimono",
      rawDescriptionHtml: "<p>Beautiful floral kimono. 100% Rayon.</p>",
      material: "100% Rayon",
      estimatedDeliveryDays: "12-20",
      voice: BEACH_FOOTPRINTS_VOICE,
    });
    const formatted = formatStructuredDescription(description, BEACH_FOOTPRINTS_VOICE);
    expect(formatted).toContain("The Vibe");
    expect(formatted).toContain("Fit & Features");
    expect(formatted).toContain("Fabric & Care");
    expect(formatted).toContain("Shipping & Delivery");
    expect(description.section1).not.toContain("<p>");
  });

  it("falls back to neutral section labels when a store hasn't configured its own", () => {
    const description = buildDescriptionTemplate({ onBrandName: "Test Product", voice: NEUTRAL_VOICE });
    const formatted = formatStructuredDescription(description, NEUTRAL_VOICE);
    expect(formatted).toContain("Overview");
    expect(formatted).toContain("Materials & Care");
  });
});

describe("rewriteProductCopy", () => {
  it("uses the offline template when no provider is given", async () => {
    const result = await rewriteProductCopy({ rawTitle: "2026 Hot Sale Kimono Dropship", voice: BEACH_FOOTPRINTS_VOICE });
    expect(result.source).toBe("template");
    expect(result.onBrandName).toMatch(/Boho Coastal/);
  });

  it("falls back to the template when the LLM provider throws", async () => {
    const failingProvider: CopyProvider = {
      id: "test-llm",
      rewrite: async () => {
        throw new Error("provider unavailable");
      },
    };
    const result = await rewriteProductCopy({ rawTitle: "2026 Hot Sale Kimono Dropship", voice: BEACH_FOOTPRINTS_VOICE }, failingProvider);
    expect(result.source).toBe("template");
  });

  it("prefers the LLM provider's output when it succeeds", async () => {
    const provider: CopyProvider = {
      id: "test-llm",
      rewrite: async () => ({
        onBrandName: "Custom LLM Name",
        description: { section1: "a", section2: "b", section3: "c", section4: "d" },
      }),
    };
    const result = await rewriteProductCopy({ rawTitle: "anything", voice: NEUTRAL_VOICE }, provider);
    expect(result.source).toBe("llm");
    expect(result.onBrandName).toBe("Custom LLM Name");
  });
});
