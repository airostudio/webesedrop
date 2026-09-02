-- Store-level dropshipping settings (pricing bounds/compare-at, import defaults, stock/sync
-- behavior, shipping preference, per-event notification toggles) — see src/domain/settings.ts
-- for the shape and defaults. One JSON blob per store; every field is optional, so an empty
-- object is valid and every setting has a sane default applied in code.
alter table stores add column if not exists settings jsonb not null default '{}'::jsonb;

-- Optional strikethrough/compare-at price, computed from pricing.compareAtRule (see
-- src/domain/settings.ts) — null when a store hasn't configured one.
alter table product_mappings add column if not exists compare_at_price_cents int;
