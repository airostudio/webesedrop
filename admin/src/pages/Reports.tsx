import { useEffect, useState } from "react";
import { api, formatCents, type PlanBreakdownEntry } from "../api";
import { BarChart } from "../components/charts";

export function Reports() {
  const [planBreakdown, setPlanBreakdown] = useState<PlanBreakdownEntry[] | null>(null);
  const [revenue, setRevenue] = useState<Array<{ label: string; value: number }>>([]);
  const [orders, setOrders] = useState<Array<{ label: string; value: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.planBreakdown(), api.revenueReport(), api.ordersReport()])
      .then(([plans, revenuePoints, orderPoints]) => {
        setPlanBreakdown(plans);
        setRevenue(revenuePoints.map((p) => ({ label: p.month, value: p.collectedCents / 100 })));
        setOrders(orderPoints.map((p) => ({ label: p.day.slice(5), value: p.count })));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load reports"));
  }, []);

  if (error) return <p className="error">{error}</p>;

  const totalMrr = (planBreakdown ?? []).reduce((sum, p) => sum + p.mrrCents, 0);

  return (
    <div>
      <h1>Reports</h1>

      <section className="panel">
        <h2>MRR by plan</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th>Subscribers</th>
              <th>MRR</th>
              <th>Share</th>
            </tr>
          </thead>
          <tbody>
            {(planBreakdown ?? []).map((p) => (
              <tr key={p.planId}>
                <td>{p.planName}</td>
                <td>{p.subscriberCount}</td>
                <td>{formatCents(p.mrrCents)}</td>
                <td>{totalMrr > 0 ? `${((p.mrrCents / totalMrr) * 100).toFixed(0)}%` : "—"}</td>
              </tr>
            ))}
            {planBreakdown && planBreakdown.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No active subscriptions yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="panel-grid">
        <section className="panel">
          <h2>Revenue collected, full history</h2>
          <BarChart data={revenue} valueFormatter={(v) => `$${v.toFixed(2)}`} />
        </section>
        <section className="panel">
          <h2>Orders, full history</h2>
          <BarChart data={orders} />
        </section>
      </div>
    </div>
  );
}
