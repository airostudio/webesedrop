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
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_stores_updated_at before update on stores for each row execute function set_updated_at();

-- Each store connects its own AliExpress account (dropshipping orders are
-- placed — and paid for — under that account, so it can't be shared).
create table aliexpress_connections (
  store_id      uuid primary key references stores(id) on delete cascade,
  app_key       text not null,
  app_secret    text not null,
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
