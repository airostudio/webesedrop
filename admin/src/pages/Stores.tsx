import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatCents, formatDate, type StoreListEntry } from "../api";

export function Stores() {
  const [stores, setStores] = useState<StoreListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stores().then(setStores).catch((err) => setError(err instanceof Error ? err.message : "Failed to load stores"));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stores) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Stores</h1>
      <table className="data-table">
        <thead>
          <tr>
            <th>Store</th>
            <th>Plan</th>
            <th>Status</th>
            <th>MRR</th>
            <th>Domains</th>
            <th>Orders</th>
            <th>Connected</th>
          </tr>
        </thead>
        <tbody>
          {stores.map((store) => (
            <tr key={store.id}>
              <td>
                <Link to={`/stores/${store.id}`}>{store.name}</Link>
                <div className="muted small">{store.slug}</div>
              </td>
              <td>{store.planName ?? "—"}</td>
              <td>{store.subscriptionStatus ? <StatusBadge status={store.subscriptionStatus} /> : "—"}</td>
              <td>{formatCents(store.mrrContributionCents)}</td>
              <td>{store.domainCount}</td>
              <td>{store.orderCount}</td>
              <td>{formatDate(store.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === "active" ? "ok" : status === "past_due" ? "warn" : status === "trialing" ? "info" : "off";
  return <span className={`badge badge-${tone}`}>{status.replace(/_/g, " ")}</span>;
}
