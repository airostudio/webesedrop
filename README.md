# Dropship Engine

A store-agnostic AliExpress dropshipping engine: product import, configurable margin pricing, on-brand copy rewriting, order fulfillment, and tracking sync. Beach Footprints is the pilot store, but nothing in this codebase knows that — every storefront it serves is just a row in `stores`, connected over a REST API + webhooks, never a shared database.

This repo **is** the engine — nothing else. It was extracted from the `beachfootprint` monorepo (formerly a `/dropship-engine` subdirectory) via a history-preserving `git subtree split`, so its commit history predates this standalone repo. Beach Footprints (the pilot store) and any other storefront — including sites built by Webese AI or Spinupfy — connect to it purely over the REST API + webhooks described below; none of them share this repo, its `node_modules`, or its Supabase project.

## Why a separate database, not a shared one

The earliest iteration of this (`packages/core/src/{aliexpress,fulfillment}` in the `beachfootprint` repo) read and wrote Beach Footprints' own `products`/`orders` tables directly — which only works for a store on that exact Next.js + Supabase stack. This engine owns nothing about any store's catalog or orders; it only knows:

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
   POST  /v1/products/mappings    { externalProductId, externalVariantId, aliexpressProductId, aliexpressSkuId }
     -> { id, supplierCostCents, retailPriceCents }
   GET   /v1/products/mappings/:externalProductId
   PATCH /v1/products/mappings/:id   { isActive }
     -> { id, isActive }   removes a product from the shop (isActive: false) or brings one back (true) — the
        only update a mapping needs after creation; catalog sync also flips this automatically on stock changes

   POST /v1/orders/fulfill       { externalOrderId, shippingAddress, lineItems: [{ externalVariantId, quantity }] }
     -> { orderId, skipped, aliexpressOrderId, fulfillmentStatus }   (idempotent — retry-safe)
   GET  /v1/orders/:externalOrderId
   ```
   Line items reference `externalVariantId` — the store's own variant id, never the engine's internal mapping id, so a store never has to track anything engine-internal.

   For an admin "sync now" button: `POST /v1/sync/catalog` / `POST /v1/sync/tracking` run the scheduled jobs on demand for just the calling store and return the summary synchronously (webhooks fire before the response comes back).

6. **Declare a domain** (optional — registering a webhook already logs one automatically, and every authenticated request best-effort logs its `Origin`/`Referer` too; call this for a domain that wouldn't otherwise surface, e.g. a staging site with no webhook):
   ```
   POST /v1/domains   { domain }
   ```

Every request needs `Authorization: Bearer <apiKey>` except `GET /v1/health` and `POST /v1/billing/webhook` (Stripe-signed instead — see Billing below).

## Billing (the engine's own subscription business)

Separate from AliExpress order money entirely: this is what a connected store pays *the engine* to use it. Stripe is the source of truth; `subscriptions`/`invoices` mirror it for reporting. Store-facing:

```
GET  /v1/billing/plans              -> { plans: [{ id, name, priceCents, billingInterval, ... }] }
POST /v1/billing/checkout-session   { planId, successUrl, cancelUrl } -> { checkoutUrl }
GET  /v1/billing/subscription       -> { subscription } | { subscription: null }
POST /v1/billing/webhook            Stripe calls this directly — verified via `stripe-signature`, not an API key
```

Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (see `.env.example`), then create at least one plan (`POST /v1/admin/plans`, below) with a real Stripe Price id before a store can check out.

## Admin API + dashboard

Everything above is a store's own view of itself. `/v1/admin/*` is the operator's view across every store — billing/accounting, the domain install log, and drill-down reports — gated by `ADMIN_API_KEY` (see `src/auth/adminAuth.ts`), never a store's own key:

```
GET  /v1/admin/overview          MRR, active/past-due subscriptions, domain count, orders + revenue this month
GET  /v1/admin/stores            every store with plan, subscription status, MRR contribution, domain/order counts
GET  /v1/admin/stores/:id        one store's full detail: domains, subscription, invoices, orders by status
GET  /v1/admin/domains           the full cross-store domain log — every hostname it's installed on
GET  /v1/admin/invoices          accounting ledger, filterable by store/status
GET  /v1/admin/plans             POST to create a plan (name, slug, priceCents, billingInterval, stripePriceId)
GET  /v1/admin/reports/revenue   cash collected per month (paid invoices)
GET  /v1/admin/reports/orders    order volume per day
GET  /v1/admin/reports/plans     current MRR broken down by plan
```

`admin/` is a small React + Vite dashboard over this API (see `admin/README.md`) — sign in with `ADMIN_API_KEY`, browse stores/domains/billing/reports. It's a separate app with its own `package.json`/install, same relationship to the engine as any storefront adapter: REST only, no shared code or database.

```bash
pnpm admin:install   # first time only
pnpm admin:dev        # http://localhost:4100, talking to VITE_ENGINE_API_URL (admin/.env.example)
```

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
  billing/       Stripe client wrapper (src/billing/stripe.ts) — the only
                 place the Stripe SDK is constructed from env vars.
  auth/          Per-store API key auth (apiKey.ts) and the separate
                 operator-only admin auth (adminAuth.ts) — deliberately not
                 the same mechanism; admin auth never touches `stores`.

admin/           Separate React + Vite dashboard over /v1/admin/* — own
                 package.json, own install, REST-only like any storefront
                 adapter. See admin/README.md.
```

## What's implemented (MVP core)

- Product import + pricing preview, store-owned product/variant mapping, cached AliExpress product/SKU data shared across every connected store (same AliExpress product means the same thing to everyone).
- Configurable pricing rules (percent-margin, fixed-markup, tiered) with 4 rounding modes.
- Idempotent order fulfillment (atomic claim — a retried or duplicated request can never place the same AliExpress order twice) and order status/tracking lookup.
- Daily catalog sync (price/stock reconciliation, price-change log, active/out-of-stock toggling) and tracking sync (shipped/delivered detection), both per-store and firing signed webhooks on real changes.
- Brand-voice-configurable copy rewriting with the same offline-template-fallback guarantee as the pilot.
- Stripe-backed subscription billing for the engine's own SaaS business (plans, checkout, webhook-driven subscriptions/invoices), a cross-store domain install log, and an operator-only admin API + dashboard (overview, per-store drill-down, accounting ledger, revenue/orders/plan reports).
- 80 passing unit/integration tests (`pnpm test`) against recorded API-shaped fixtures and an in-memory Supabase-shaped fake — no live AliExpress, Supabase, or Stripe credentials needed to verify the logic (Stripe webhook signature tests use its offline test-signature helper).

## What's next, not built here

- **Real operator accounts for the admin dashboard** — `ADMIN_API_KEY` is a single shared secret (see `src/auth/adminAuth.ts`); fine for one operator, not for a team.
- **Multi-supplier mapping** (DSers' "Supplier Optimizer": one product mapped to several AliExpress listings, auto-switching if one goes out of stock).
- **Dynamic/competitor-aware repricing** (AutoDS-style), beyond the cost-based rules here.
- **Retry/backoff on webhook delivery** — currently one attempt, logged either way; the sync jobs naturally re-derive the same event next run, but a dead-letter/retry queue would be more robust for something like an order-shipped notification.
- **Non-Next.js integration guides** — Beach Footprints connects via a thin Next.js adapter that calls this REST API. A store built on Webflow, WooCommerce, or another platform (e.g. via Webese AI or Spinupfy) integrates the same way — provision a store, call the same endpoints, receive the same webhooks — but no platform-specific adapter or guide exists here yet.

## Local development

```bash
pnpm install
pnpm test                         # 80 tests, no credentials needed
pnpm typecheck

# Against a real (separate!) Supabase project — apply supabase/schema.sql first:
pnpm dev                          # API on :3100
pnpm create-store -- --name="Beach Footprints" --slug=beach-footprints
pnpm sync:catalog                 # one-off catalog sync run
pnpm sync:tracking                # one-off tracking sync run
pnpm worker                       # scheduled jobs — needs REDIS_URL too
```
