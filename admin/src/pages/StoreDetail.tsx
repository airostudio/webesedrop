import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatCents, formatDate, type StoreDetail as StoreDetailData } from "../api";
import { StatusBadge } from "./Stores";

export function StoreDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<StoreDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.storeDetail(id).then(setDetail).catch((err) => setError(err instanceof Error ? err.message : "Failed to load store"));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!detail) return <p className="muted">Loading…</p>;

  return (
    <div>
      <Link to="/stores" className="back-link">
        ← Stores
      </Link>
      <h1>{detail.store.name}</h1>
      <p className="muted">
        {detail.store.slug} · Connected {formatDate(detail.store.createdAt)} · {detail.store.isActive ? "Active" : "Inactive"}
      </p>

      <div className="tile-grid">
        <div className="tile">
          <div className="tile-value">{detail.subscription?.planName ?? "No plan"}</div>
          <div className="tile-label">Plan{detail.subscription ? <> · <StatusBadge status={detail.subscription.status} /></> : null}</div>
        </div>
        <div className="tile">
          <div className="tile-value">{detail.domains.length}</div>
          <div className="tile-label">Domains installed on</div>
        </div>
        <div className="tile">
          <div className="tile-value">{detail.productMappingCount}</div>
          <div className="tile-label">Product mappings</div>
        </div>
      </div>

      <div className="panel-grid">
        <section className="panel">
          <h2>Domain log</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Source</th>
                <th>First seen</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {detail.domains.map((d) => (
                <tr key={d.id}>
                  <td>{d.domain}</td>
                  <td className="muted small">{d.source.replace(/_/g, " ")}</td>
                  <td>{formatDate(d.firstSeenAt)}</td>
                  <td>{formatDate(d.lastSeenAt)}</td>
                </tr>
              ))}
              {detail.domains.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No domains logged yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="panel">
          <h2>Orders by status</h2>
          <ul className="kv-list">
            {Object.entries(detail.ordersByStatus).map(([status, count]) => (
              <li key={status}>
                <span>{status.replace(/_/g, " ")}</span>
                <strong>{count}</strong>
              </li>
            ))}
            {Object.keys(detail.ordersByStatus).length === 0 && <li className="muted">No orders yet</li>}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h2>Invoices</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>Due</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {detail.invoices.map((inv) => (
              <tr key={inv.id}>
                <td>{formatDate(inv.createdAt)}</td>
                <td>{inv.status}</td>
                <td>{formatCents(inv.amountDueCents)}</td>
                <td>{formatCents(inv.amountPaidCents)}</td>
              </tr>
            ))}
            {detail.invoices.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No invoices yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
