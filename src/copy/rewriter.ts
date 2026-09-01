/**
 * Copy rewriter — turns a raw AliExpress listing (buzzword-laden title,
 * wall-of-text HTML description) into a store's own on-brand voice.
 *
 * Buzzword stripping is generic (every dropshipping listing has the same
 * tells). Brand voice — descriptor words, section labels — is supplied per
 * store via `BrandVoice`, defaulting to a neutral style so a store that
 * hasn't configured one still gets a clean rewrite. Beach Footprints
 * configures the "boho surf" voice; another store configures its own.
 *
 * `rewriteProductCopy` tries an injected CopyProvider (LLM) first and falls
 * back to the deterministic template rewriter on any failure or when no
 * provider is configured — ingestion must never block on an external API.
 */

const BUZZWORD_PATTERNS: RegExp[] = [
  /\b20\d{2}\s*(hot\s*sale|new)\b/gi,
  /\bhot\s*sale\b/gi,
  /\bdropship(ping)?\b/gi,
  /\bwholesale\b/gi,
  /\bfree\s*shipping\b/gi,
  /\bsexy\b/gi,
  /\bbest\s*seller\b/gi,
  /\btop\s*quality\b/gi,
  /\bnew\s*arrival[s]?\b/gi,
  /\bfashion(able)?\b/gi,
  /\bfor\s*women\s*20\d{2}\b/gi,
  /!{2,}/g,
];

export interface BrandVoice {
  /** Store name, used as a fallback identity in generic copy. */
  storeName: string;
  /** Prefix words used to turn a generic title into an on-brand name, e.g. ["Sun-Drenched", "Driftwood"] for a boho surf brand. Omit for a neutral pass-through (sanitized title only). */
  descriptors?: string[];
  /** Words inserted between the descriptor and the sanitized title, e.g. "Boho Coastal". Ignored if descriptors is omitted. */
  styleLabel?: string;
  /** Structured-description section labels, in order. Defaults to a neutral 4-section set. */
  sectionLabels?: [string, string, string, string];
  /** Opening line template for the first section. {name} is replaced with the on-brand product name. */
  openingLine?: string;
}

const DEFAULT_SECTION_LABELS: [string, string, string, string] = ["Overview", "Features", "Materials & Care", "Shipping & Delivery"];

/** Strips dropshipping-listing buzzwords and normalizes whitespace/casing. */
export function sanitizeTitle(rawTitle: string): string {
  let title = rawTitle;
  for (const pattern of BUZZWORD_PATTERNS) title = title.replace(pattern, " ");
  title = title
    .replace(/[|/].*$/, "") // drop trailing "| Free Shipping | AliExpress"-style suffixes
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,.\-–]+|[\s,.\-–]+$/g, "")
    .trim();
  return title.length > 0 ? title : rawTitle.trim();
}

/**
 * Renames a generic supplier title into the store's on-brand style. With no
 * descriptors configured, this is just `sanitizeTitle` — a neutral,
 * buzzword-free product name. Idempotent — running it twice on an
 * already-prefixed name is a no-op.
 */
export function toOnBrandName(rawTitle: string, voice: BrandVoice, seed = 0): string {
  const sanitized = sanitizeTitle(rawTitle);
  if (!voice.descriptors || voice.descriptors.length === 0) return sanitized;
  if (voice.descriptors.some((d) => sanitized.startsWith(d))) return sanitized;

  const descriptor = voice.descriptors[seed % voice.descriptors.length];
  const titleCased = sanitized
    .toLowerCase()
    .split(" ")
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
  const style = voice.styleLabel ? `${voice.styleLabel} ` : "";
  return `${descriptor} ${style}${titleCased}`.replace(/\s{2,}/g, " ").trim();
}

export interface StructuredDescription {
  section1: string;
  section2: string;
  section3: string;
  section4: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Deterministic template fallback — no external calls, always available. */
export function buildDescriptionTemplate(params: {
  onBrandName: string;
  rawDescriptionHtml?: string;
  material?: string;
  careInstructions?: string;
  estimatedDeliveryDays?: string;
  voice: BrandVoice;
}): StructuredDescription {
  const cleanedRaw = params.rawDescriptionHtml ? stripHtml(params.rawDescriptionHtml) : "";
  const excerpt = cleanedRaw.slice(0, 220).trim();
  const opening = (params.voice.openingLine ?? `${params.voice.storeName}: {name}.`).replace("{name}", params.onBrandName);

  return {
    section1: [opening, excerpt ? `${excerpt}${excerpt.length >= 220 ? "…" : ""}` : ""].filter(Boolean).join(" "),
    section2: "A relaxed, true-to-size fit designed for everyday wear.",
    section3: params.material
      ? `${params.material}. ${params.careInstructions ?? "Follow the care label; gentle wash and air dry recommended."}`
      : (params.careInstructions ?? "Follow the care label; gentle wash and air dry recommended."),
    section4: params.estimatedDeliveryDays
      ? `Ships from our supplier network, typically arriving in ${params.estimatedDeliveryDays} days. Tracking is sent as soon as it's available.`
      : "Ships from our supplier network; tracking is sent to your email as soon as it's available.",
  };
}

export interface CopyRewriteRequest {
  rawTitle: string;
  rawDescriptionHtml?: string;
  material?: string;
  careInstructions?: string;
  estimatedDeliveryDays?: string;
  voice: BrandVoice;
  seed?: number;
}

export interface CopyRewriteResult {
  onBrandName: string;
  description: StructuredDescription;
  source: "llm" | "template";
}

/** Injectable hook for an LLM-backed rewriter (Claude/OpenAI/etc). */
export interface CopyProvider {
  id: string;
  rewrite(request: CopyRewriteRequest): Promise<{ onBrandName: string; description: StructuredDescription }>;
}

export async function rewriteProductCopy(request: CopyRewriteRequest, provider?: CopyProvider): Promise<CopyRewriteResult> {
  if (provider) {
    try {
      const { onBrandName, description } = await provider.rewrite(request);
      return { onBrandName, description, source: "llm" };
    } catch {
      // Fall through to the offline template — ingestion must never block on the LLM being down.
    }
  }

  const onBrandName = toOnBrandName(request.rawTitle, request.voice, request.seed ?? 0);
  return {
    onBrandName,
    description: buildDescriptionTemplate({ ...request, onBrandName }),
    source: "template",
  };
}

export function formatStructuredDescription(description: StructuredDescription, voice: BrandVoice): string {
  const labels = voice.sectionLabels ?? DEFAULT_SECTION_LABELS;
  return [
    `${labels[0]}\n${description.section1}`,
    `${labels[1]}\n${description.section2}`,
    `${labels[2]}\n${description.section3}`,
    `${labels[3]}\n${description.section4}`,
  ].join("\n\n");
}

/** Beach Footprints' pilot brand voice — the reference config a connected store can point to or copy. */
export const BEACH_FOOTPRINTS_VOICE: BrandVoice = {
  storeName: "Beach Footprints",
  descriptors: ["Sun-Drenched", "Driftwood", "Tidewater", "Sagebrush Coast", "Salt-Air", "Weathered Dune"],
  styleLabel: "Boho Coastal",
  sectionLabels: ["The Vibe", "Fit & Features", "Fabric & Care", "Shipping & Delivery"],
  openingLine: "{name} is built for salt-tangled hair, bare feet, and golden-hour light.",
};
