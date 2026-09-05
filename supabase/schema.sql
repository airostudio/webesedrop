-- ============================================================
-- Dropship Engine — Supabase schema
--
-- This database belongs ONLY to the engine — no storefront ever queries it
-- directly, browser or otherwise. Every access goes through the engine's
-- own REST API, authenticated with a per-store API key. That's why there's
-- no Row Level Security here (unlike a typical Supabase app): RLS protects
-- against a browser holding an anon key, and nothing here is ever exposed
-- to one. Apply directly via the Supabase SQL editor, or:
--   supabase db execute -f supabase/schema.sql
-- ============================================================

create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ================================================================
-- Stores — one row per connected storefront (Beach Footprints is the
-- pilot; any future Shopify/WooCommerce/etc. store is just another row).
-- ================================================================

create table stores (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  slug           text not null unique,
  api_key_hash   text not null unique, -- sha256 of the store's API key; the raw key is shown once at creation and never stored
  webhook_url    text,
  webhook_secret text, -- used to HMAC-sign outbound webhook payloads
  brand_voice    jsonb, -- optional BrandVoice config (see src/copy/rewriter.ts) — null means neutral default copy
  settings       jsonb not null default '{}'::jsonb, -- StoreSettings (see src/domain/settings.ts) — pricing bounds/compare-at, import defaults, stock/sync behavior, shipping preference, notification toggles
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_stores_updated_at before update on stores for each row execute function set_updated_at();

-- Each store connects its own AliExpress account (dropshipping orders are
-- placed — and paid for — under that account, so it can't be shared).
-- app_key/app_secret are nullable: most stores use the engine's own platform
-- app (ALIEXPRESS_APP_KEY/ALIEXPRESS_APP_SECRET env vars) and only log into
-- their own AliExpress account during OAuth. A store only sets these if it
-- registered its own AliExpress Open Platform app (POST /v1/aliexpress/connection).
create table aliexpress_connections (
  store_id      uuid primary key references stores(id) on delete cascade,
  app_key       text,
  app_secret    text,
  access_token  text,
  refresh_token text,
  connected_at  timestamptz,
  updated_at    timestamptz not null default now()
);
create trigger trg_aliexpress_connections_updated_at before update on aliexpress_connections for each row execute function set_updated_at();

create table pricing_rules (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  name       text not null,
  rule       jsonb not null, -- PricingRule (percent_margin | fixed_markup | tiered_margin) — see src/pricing/engine.ts
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_pricing_rules_store on pricing_rules (store_id);
create unique index idx_pricing_rules_one_default_per_store on pricing_rules (store_id) where is_default;

-- ================================================================
-- AliExpress product cache — shared across every connected store, since
-- the same AliExpress product/SKU data means the same thing to everyone.
-- Store-specific pricing/branding lives in product_mappings, not here.
-- ================================================================

create table ae_products (
  aliexpress_product_id text primary key,
  subject                text not null,
  detail_html             text,
  image_urls              text[] not null default array[]::text[],
  currency_code            text not null default 'USD',
  fetched_at               timestamptz not null default now()
);

create table ae_product_skus (
  id                     uuid primary key default gen_random_uuid(),
  aliexpress_product_id  text not null references ae_products(aliexpress_product_id) on delete cascade,
  aliexpress_sku_id       text not null,
  supplier_cost_cents     int not null,
  stock_on_hand           int not null default 0,
  sku_properties          jsonb,
  fetched_at              timestamptz not null default now(),
  unique (aliexpress_product_id, aliexpress_sku_id)
);
create index idx_ae_product_skus_product on ae_product_skus (aliexpress_product_id);

-- ================================================================
-- Product mappings — one row per (store, storefront variant) linking it to
-- an AliExpress SKU, that store's chosen pricing rule, and the last price
-- computed for it. This is the whole "independent of the store" boundary:
-- the engine never touches the store's own product tables, only this.
-- ================================================================

create table product_mappings (
  id                     uuid primary key default gen_random_uuid(),
  store_id               uuid not null references stores(id) on delete cascade,
  external_product_id    text not null, -- the store's own product id/handle
  external_variant_id    text not null, -- the store's own variant/SKU id
  aliexpress_product_id  text not null references ae_products(aliexpress_product_id),
  aliexpress_sku_id       text not null,
  pricing_rule_id         uuid references pricing_rules(id) on delete set null,
  on_brand_name           text,
  supplier_cost_cents     int not null,
  retail_price_cents      int not null,
  compare_at_price_cents  int, -- optional strikethrough/compare-at price, computed from the store's pricing.compareAtRule setting (see src/domain/settings.ts) — null when unset
  is_active                boolean not null default true,
  last_synced_at           timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  unique (store_id, external_variant_id)
);
create index idx_product_mappings_store on product_mappings (store_id);
create index idx_product_mappings_aliexpress_product on product_mappings (aliexpress_product_id);

create table product_price_log (
  id                uuid primary key default gen_random_uuid(),
  mapping_id        uuid not null references product_mappings(id) on delete cascade,
  previous_cost_cents  int,
  new_cost_cents       int,
  previous_price_cents int,
  new_price_cents      int,
  margin_rate           numeric(6,4),
  reason                text not null default 'supplier_price_change',
  created_at             timestamptz not null default now()
);
create index idx_product_price_log_mapping on product_price_log (mapping_id, created_at desc);

-- ================================================================
-- Orders — one row per (store, storefront order) the store asked the
-- engine to fulfill via AliExpress.
-- ================================================================

create type fulfillment_status as enum (
  'unfulfilled',
  'fulfillment_in_progress',
  'shipped',
  'delivered',
  'fulfillment_failed',
  'canceled'
);

create table orders (
  id                   uuid primary key default gen_random_uuid(),
  store_id             uuid not null references stores(id) on delete cascade,
  external_order_id    text not null, -- the store's own order id
  fulfillment_status   fulfillment_status not null default 'unfulfilled',
  aliexpress_order_id  text,
  tracking_number      text,
  carrier              text,
  shipping_address     jsonb not null,
  line_items           jsonb not null, -- [{ mappingId, quantity }]
  fulfilled_at         timestamptz,
  shipped_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (store_id, external_order_id)
);
create trigger trg_orders_updated_at before update on orders for each row execute function set_updated_at();
create unique index idx_orders_aliexpress_order_id on orders (aliexpress_order_id) where aliexpress_order_id is not null;
create index idx_orders_store_status on orders (store_id, fulfillment_status);

-- ================================================================
-- Outbound webhooks & audit log
-- ================================================================

create table webhook_deliveries (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  event         text not null, -- product.price_changed | product.out_of_stock | product.restocked | order.shipped | order.delivered | order.fulfillment_failed
  payload       jsonb not null,
  status        text not null default 'pending', -- pending | delivered | failed
  attempts      int not null default 0,
  last_attempt_at timestamptz,
  created_at     timestamptz not null default now()
);
create index idx_webhook_deliveries_store_status on webhook_deliveries (store_id, status);

create table sync_logs (
  id         uuid primary key default gen_random_uuid(),
  store_id   uuid not null references stores(id) on delete cascade,
  event      text not null, -- catalog_sync_run | order_place_attempt | order_placed | order_place_failed | tracking_poll | shipped | delivered
  order_id   uuid references orders(id) on delete cascade,
  mapping_id uuid references product_mappings(id) on delete set null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
create index idx_sync_logs_store on sync_logs (store_id, created_at desc);

-- ================================================================
-- Billing — the engine's own SaaS subscription business (a store pays to
-- use the engine), entirely separate from AliExpress order money above.
-- Stripe is the source of truth; these tables mirror it for accounting/
-- reporting so the admin can run reports without calling Stripe for every
-- page load. Every row here is written only from the Stripe webhook
-- handler (or, for plans, by an operator) — never guessed locally.
-- ================================================================

create table plans (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  slug               text not null unique,
  price_cents        int not null,
  billing_interval   text not null default 'month' check (billing_interval in ('month', 'year')),
  stripe_price_id    text unique,
  features           jsonb not null default '{}'::jsonb,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create table stripe_customers (
  store_id           uuid primary key references stores(id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

create table subscriptions (
  id                     uuid primary key default gen_random_uuid(),
  store_id               uuid not null references stores(id) on delete cascade,
  plan_id                uuid not null references plans(id),
  stripe_subscription_id text not null unique,
  status                 text not null check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid')),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create trigger trg_subscriptions_updated_at before update on subscriptions for each row execute function set_updated_at();
create index idx_subscriptions_store on subscriptions (store_id);
create index idx_subscriptions_status on subscriptions (status);

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  subscription_id   uuid references subscriptions(id) on delete set null,
  stripe_invoice_id text not null unique,
  status            text not null check (status in ('draft', 'open', 'paid', 'uncollectible', 'void')),
  amount_due_cents  int not null,
  amount_paid_cents int not null default 0,
  currency          text not null default 'usd',
  period_start      timestamptz,
  period_end        timestamptz,
  hosted_invoice_url text,
  paid_at           timestamptz,
  created_at        timestamptz not null default now()
);
create index idx_invoices_store on invoices (store_id, created_at desc);
create index idx_invoices_status on invoices (status);

-- Raw Stripe webhook events, kept for audit/replay/debugging — every
-- delivery is logged here before (and regardless of whether) it's acted on.
create table payment_events (
  id                uuid primary key default gen_random_uuid(),
  stripe_event_id   text not null unique,
  type              text not null,
  payload           jsonb not null,
  processed_at      timestamptz,
  error             text,
  created_at        timestamptz not null default now()
);
create index idx_payment_events_type on payment_events (type, created_at desc);

-- ================================================================
-- Domain install log — every hostname a store's integration has been seen
-- calling from or registering a webhook for. A store can have more than
-- one (staging + production, a domain migration, multiple storefronts
-- under one account), so this is a log, not a single column.
-- ================================================================

create table store_domains (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid not null references stores(id) on delete cascade,
  domain         text not null,
  source         text not null check (source in ('manual', 'webhook_url', 'origin_header')),
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  is_active      boolean not null default true,
  unique (store_id, domain)
);
create index idx_store_domains_store on store_domains (store_id);
create index idx_store_domains_domain on store_domains (domain);
