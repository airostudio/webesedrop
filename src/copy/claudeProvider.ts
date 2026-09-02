import Anthropic from "@anthropic-ai/sdk";
import type { CopyProvider, CopyRewriteRequest, StructuredDescription } from "./rewriter";

const MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `You write product listings for an ecommerce store that sources from AliExpress. You're given a raw AliExpress listing (title + description) — usually keyword-stuffed, buzzword-laden, and written like a marketplace ad, not a store's own copy — and a brand voice to write in.

Read the raw description first and actually understand what the product is, what it's made of, and who'd buy it — don't just clean up or translate the original text. Write fresh copy that reflects that understanding.

Title:
- SEO-friendly: naturally includes the concrete attributes a shopper would search for (material, product type, use case, style) — no keyword stuffing.
- Concise: aim for well under 70 characters, never over 100.
- Strip every marketplace/AliExpress tell: "hot sale", "wholesale", "dropship", "free shipping", "new arrival", a trailing year, excessive capitalization or exclamation marks, "AliExpress" itself.
- Written like a real store's product name, not a listing dumped from a marketplace.

Description — write exactly 4 sections matching the given labels, in the given brand voice:
- Grounded in what the raw description actually says about the product (material, fit, function) — never invent specs, certifications, or claims the source doesn't support.
- No marketplace buzzwords, no wall-of-text, no ALL CAPS.
- Sounds like it was written by the store, not translated from a supplier listing.

Respond with ONLY a JSON object, no other text, no markdown fences:
{"title": "...", "section1": "...", "section2": "...", "section3": "...", "section4": "..."}`;

function buildUserMessage(request: CopyRewriteRequest): string {
  const voice = request.voice;
  const voiceDescription = [
    `Store: ${voice.storeName}`,
    voice.styleLabel ? `Style: ${voice.styleLabel}` : null,
    voice.descriptors?.length ? `Descriptor words the store uses (weave the feel in, don't just prepend one): ${voice.descriptors.join(", ")}` : null,
    voice.openingLine ? `Typical opening-line style: "${voice.openingLine.replace("{name}", "<product name>")}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const sectionLabels = voice.sectionLabels ?? ["Overview", "Features", "Materials & Care", "Shipping & Delivery"];

  return [
    `Brand voice:\n${voiceDescription}`,
    `Section labels, in order: ${sectionLabels.join(" | ")}`,
    `Raw AliExpress title: ${request.rawTitle}`,
    request.rawDescriptionHtml ? `Raw AliExpress description (HTML):\n${request.rawDescriptionHtml.slice(0, 6000)}` : null,
    request.material ? `Material: ${request.material}` : null,
    request.careInstructions ? `Care instructions: ${request.careInstructions}` : null,
    request.estimatedDeliveryDays ? `Estimated delivery: ${request.estimatedDeliveryDays} days` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface ClaudeCopyResponse {
  title: string;
  section1: string;
  section2: string;
  section3: string;
  section4: string;
}

function parseResponse(text: string): ClaudeCopyResponse {
  // Claude is instructed to return bare JSON, but strip markdown fences defensively in case it doesn't.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const parsed = JSON.parse(cleaned) as Partial<ClaudeCopyResponse>;
  if (!parsed.title || !parsed.section1 || !parsed.section2 || !parsed.section3 || !parsed.section4) {
    throw new Error("Claude copy response missing required fields");
  }
  return parsed as ClaudeCopyResponse;
}

/**
 * LLM-backed CopyProvider using Claude. Reads the raw AliExpress listing, understands the
 * product, and writes an SEO-friendly title plus fresh on-brand description — not a template
 * fill-in. rewriteProductCopy() falls back to the offline template on any failure (bad JSON,
 * API error, timeout), so ingestion never blocks on this being available.
 */
export class ClaudeCopyProvider implements CopyProvider {
  id = "claude";
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async rewrite(request: CopyRewriteRequest): Promise<{ onBrandName: string; description: StructuredDescription }> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserMessage(request) }],
    });

    const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === "text");
    if (!textBlock) throw new Error("Claude returned no text content");

    const parsed = parseResponse(textBlock.text);
    return {
      onBrandName: parsed.title,
      description: { section1: parsed.section1, section2: parsed.section2, section3: parsed.section3, section4: parsed.section4 },
    };
  }
}

/** Returns a ClaudeCopyProvider when ANTHROPIC_API_KEY is configured, otherwise undefined — callers fall back to the offline template. */
export function getDefaultCopyProvider(): ClaudeCopyProvider | undefined {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeCopyProvider() : undefined;
}
