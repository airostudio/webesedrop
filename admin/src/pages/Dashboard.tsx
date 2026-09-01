import { useEffect, useState } from "react";
import { api, formatCents, type OverviewStats } from "../api";
import { BarChart } from "../components/charts";

export function Dashboard() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [revenue, setRevenue] = useState<Array<{ label: string; value: number }>>([]);
  const [orders, setOrders] = useState<Array<{ label: string; value: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.overview(), api.revenueReport(), api.ordersReport()])
      .then(([overview, revenuePoints, orderPoints]) => {
        setStats(overview);
        setRevenue(revenuePoints.map((p) => ({ label: p.month, value: p.collectedCents / 100 })));
        setOrders(orderPoints.slice(-14).map((p) => ({ label: p.day.slice(5), value: p.count })));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load overview"));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Overview</h1>
      <div className="tile-grid">
        <StatTile label="MRR" value={formatCents(stats.mrrCents)} />
        <StatTile label="Active subscriptions" value={String(stats.activeSubscriptions)} />
        <StatTile label="Past due" value={String(stats.pastDueSubscriptions)} tone={stats.pastDueSubscriptions > 0 ? "warn" : undefined} />
        <StatTile label="Connected stores" value={`${stats.activeStores} / ${stats.totalStores}`} />
        <StatTile label="Domains installed on" value={String(stats.totalDomains)} />
        <StatTile label="Orders this month" value={String(stats.ordersThisMonth)} />
        <StatTile label="Fulfilled this month" value={String(stats.ordersFulfilledThisMonth)} />
        <StatTile label="Collected this month" value={formatCents(stats.revenueCollectedThisMonthCents)} />
      </div>

      <div className="panel-grid">
        <section className="panel">
          <h2>Revenue collected (by month)</h2>
          <BarChart data={revenue} valueFormatter={(v) => `$${v.toFixed(2)}`} />
        </section>
        <section className="panel">
          <h2>Orders (last 14 days)</h2>
          <BarChart data={orders} />
        </section>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`tile ${tone ? `tile-${tone}` : ""}`}>
      <div className="tile-value">{value}</div>
      <div className="tile-label">{label}</div>
    </div>
  );
}
