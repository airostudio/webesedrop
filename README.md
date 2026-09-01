# Dropship Engine

A store-agnostic AliExpress dropshipping engine: product import, configurable margin pricing, on-brand copy rewriting, order fulfillment, and tracking sync. Beach Footprints is the pilot store, but nothing in this codebase knows that — every storefront it serves is just a row in `stores`, connected over a REST API + webhooks, never a shared database.

**Currently lives inside the `beachfootprint` repo** (`/dropship-engine`) as a fully self-contained subdirectory — its own `package.json`, own `node_modules`, own Supabase project, zero imports from `apps/web` or `packages/core`. This was a deliberate stopgap: the session building this didn't have permission to create a new GitHub repo. Extracting it is a clean history-preserving split (`git subtree split --prefix=dropship-engine` or `git filter-repo`), not a rewrite, whenever repo-creation access is sorted out.

## Why a separate database, not a shared one

The previous iteration of this (in `packages/core/src/{aliexpress,fulfillment}` in the `beachfootprint` repo) worked, but read and wrote Beach Footprints' own `products`/`orders` tables directly — which only works for a store on that exact Next.js + Supabase stack. This version owns nothing about any store's catalog or orders; it only knows:

- which AliExpress SKU a store's product/variant maps to (`product_mappings`)
- what price that store's pricing rule computes for it
- what a store's order needs to fulfill it, and what AliExpress said happened

Everything else — actually creating the product listing, writing the order, running checkout — is the connected store's job. That's what makes "push this out to other stores" possible: a Shopify store, a WooCommerce store, or another Next.js store all integrate the same way, each writing a thin adapter for their own platform.

## How a store connects

1. **Provision the store** (operator action, not a public endpoint):
   ```bash
   pnpm create-store -- --name="Beach Footprints" --slug=beach-footprints
   ```
   Prints an API key once — store it in the connecting app's own secrets (e.g. Beach Footprints' `DROPSHIP_ENGINE_API_KEY`).

2. **Connect an AliExpress account** (every store connects its own — dropshipping orders are placed, and paid for, under that account):
   ```
   POST /v1/aliexpress/connection      { appKey, appSecret }
   GET  /v1/aliexpress/authorize-url?redirectUri=...   -> { authorizeUrl }
   POST /v1/aliexpress/callback        { code, redirectUri }
   ```

3. **Configure pricing and brand voice** (optional — sensible defaults apply without this):
   ```
   POST /v1/pricing-rules   { name, isDefault, rule: { type: "percent_margin" | "fixed_markup" | "tiered_margin", ... } }
   PUT  /v1/brand-voice     { storeName, descriptors?, styleLabel?, sectionLabels?, openingLine? }
   ```

4. **Register a webhook endpoint** to receive product/order events:
   ```
   POST /v1/webhooks   { url, secret }
   ```
   Events: `product.price_changed`, `product.out_of_stock`, `product.restocked`, `order.shipped`, `order.delivered`, `order.fulfillment_failed`. Each delivery is signed — verify `X-Dropship-Signature` as `HMAC-SHA256(secret, rawBody)` before trusting it.

5. **Import products, place orders, poll status:**
   ```
   POST /v1/products/import      { aliexpressProductId, pricingRuleId? }
     -> { onBrandName, description, imageUrls, skus: [{ aliexpressSkuId, supplierCostCents, retailPriceCents, stockOnHand, ... }] }
   POST /v1/products/mappings    { externalProductId, externalVariantId, aliexpressProductId, aliexpressSkuId }
     -> { id, supplierCostCents, retailPriceCents }
   GET  /v1/products/mappings/:externalProductId

   POST /v1/orders/fulfill       { externalOrderId, shippingAddress, lineItems: [{ externalVariantId, quantity }] }
     -> { orderId, skipped, aliexpressOrderId, fulfillmentStatus }   (idempotent — retry-safe)
   GET  /v1/orders/:externalOrderId
   ```
   Line items reference `externalVariantId` — the store's own variant id, never the engine's internal mapping id, so a store never has to track anything engine-internal.

   For an admin "sync now" button: `POST /v1/sync/catalog` / `POST /v1/sync/tracking` run the scheduled jobs on demand for just the calling store and return the summary synchronously (webhooks fire before the response comes back).

Every request needs `Authorization: Bearer <apiKey>` except `GET /v1/health`.

## Architecture

```
src/
  aliexpress/    AliExpress Open Platform client — HMAC-SHA256 signing, OAuth
                 token refresh + the authorization_code exchange, typed
                 methods for product/freight/order/tracking. Ported near-
                 verbatim from the Beach Footprints pilot; already fully
                 store-agnostic (no dependency on any store's schema).
  pricing/       Configurable margin-rule engine — percent-margin, fixed-
                 markup, tiered-by-cost, each with a rounding mode
                 (.95 / .99 / .00 / none). Beach Footprints' pilot config
                 (35% + round up to .95) is just one percent_margin rule.
  copy/          Buzzword-stripping + on-brand rewrite, LLM hook with an
                 offline template fallback. Brand voice (descriptor words,
                 section labels) is per-store config, not hardcoded —
                 BEACH_FOOTPRINTS_VOICE is the reference config, not the
                 only one.
  domain/        The actual engine logic, DB-aware but store-schema-
                 agnostic: products.ts (import + mapping), orders.ts
                 (idempotent fulfillment), sync.ts (catalog + tracking
                 sync, across every store), webhooks.ts (signed delivery),
                 connection.ts (builds a per-store AliExpress client from
                 its stored OAuth tokens, persisting refreshes).
  api/           Fastify REST API — one process, framework-light so it
                 runs anywhere (not Vercel-specific, no Next.js).
  worker/        BullMQ scheduler — catalog sync daily @ 02:00 UTC,
                 tracking sync every 5h. Needs REDIS_URL; the one-off CLI
                 scripts (sync:catalog / sync:tracking) don't.
  cli/           create-store (operator-only store provisioning, not a
                 public endpoint — API keys are shown once, never
                 recoverable), sync:catalog, sync:tracking.
```

## What's implemented (MVP core)

- Product import + pricing preview, store-owned product/variant mapping, cached AliExpress product/SKU data shared across every connected store (same AliExpress product means the same thing to everyone).
- Configurable pricing rules (percent-margin, fixed-markup, tiered) with 4 rounding modes.
- Idempotent order fulfillment (atomic claim — a retried or duplicated request can never place the same AliExpress order twice) and order status/tracking lookup.
- Daily catalog sync (price/stock reconciliation, price-change log, active/out-of-stock toggling) and tracking sync (shipped/delivered detection), both per-store and firing signed webhooks on real changes.
- Brand-voice-configurable copy rewriting with the same offline-template-fallback guarantee as the pilot.
- 48 passing unit/integration tests (`pnpm test`) against recorded API-shaped fixtures and an in-memory Supabase-shaped fake — no live AliExpress or Supabase credentials needed to verify the logic.

## What's next, not built here

- **A management UI/dashboard** — everything above is API-only right now.
- **Multi-supplier mapping** (DSers' "Supplier Optimizer": one product mapped to several AliExpress listings, auto-switching if one goes out of stock).
- **Dynamic/competitor-aware repricing** (AutoDS-style), beyond the cost-based rules here.
- **The Beach Footprints adapter itself** — this repo is the engine; Beach Footprints still needs a small integration layer (calls this API instead of `packages/core/src/{aliexpress,fulfillment}` directly, and a webhook receiver at `/api/webhooks/dropship-engine` that applies price/stock/tracking updates into its own Supabase tables). Not yet wired — this pass built the engine only.
- **Retry/backoff on webhook delivery** — currently one attempt, logged either way; the sync jobs naturally re-derive the same event next run, but a dead-letter/retry queue would be more robust for something like an order-shipped notification.

## Local development

```bash
pnpm install --ignore-workspace   # standalone — don't let this join the beachfootprint pnpm workspace
pnpm test                         # 48 tests, no credentials needed
pnpm typecheck

# Against a real (separate!) Supabase project — apply supabase/schema.sql first:
pnpm dev                          # API on :3100
pnpm create-store -- --name="Beach Footprints" --slug=beach-footprints
pnpm sync:catalog                 # one-off catalog sync run
pnpm sync:tracking                # one-off tracking sync run
pnpm worker                       # scheduled jobs — needs REDIS_URL too
```
