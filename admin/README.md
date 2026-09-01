# Dropship Engine — Admin

Operator-only dashboard over the engine's `/v1/admin/*` REST API: subscription billing/accounting, the domain install log (every hostname the engine's been installed on), and drill-down reports (revenue, orders, MRR by plan). It's a separate app on purpose — same relationship to the engine as any storefront's adapter: REST only, its own `package.json`, no shared code or database.

## Local development

```bash
pnpm install
cp .env.example .env.local   # set VITE_ENGINE_API_URL if not http://localhost:3100
pnpm dev                     # http://localhost:4100
```

Sign in with the engine's `ADMIN_API_KEY` (see `../.env.example`). The key is kept in `localStorage`, sent as `Authorization: Bearer <key>` on every request; a 401 clears it and bounces you back to the login screen.

## Build

```bash
pnpm build      # outputs dist/ — a static SPA, deploy it anywhere (it only ever talks to VITE_ENGINE_API_URL)
```

## Pages

- **Overview** — MRR, active/past-due subscriptions, connected stores, domain count, this month's orders/revenue, plus revenue and order trend charts.
- **Stores** — every connected store with plan, subscription status, MRR contribution, domain/order counts; click through to a store's full detail (its domain log, subscription, invoices, orders by status).
- **Domains** — the full cross-store install log, filterable by domain or store name.
- **Billing** — the accounting ledger (invoices, filterable by status) and plan management (create a plan, wire it to a Stripe Price id).
- **Reports** — MRR broken down by plan, and full-history revenue/orders charts.
