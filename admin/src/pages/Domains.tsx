import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, type DomainLogEntry } from "../api";

export function Domains() {
  const [domains, setDomains] = useState<DomainLogEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.domains().then(setDomains).catch((err) => setError(err instanceof Error ? err.message : "Failed to load domains"));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!domains) return <p className="muted">Loading…</p>;

  const filtered = filter.trim() ? domains.filter((d) => d.domain.includes(filter) || d.storeName.toLowerCase().includes(filter.toLowerCase())) : domains;

  return (
    <div>
      <h1>Domain install log</h1>
      <p className="muted">Every hostname the engine has seen a store's integration call from — webhook registration, an explicit declaration, or the Origin header on an authenticated request.</p>
      <input className="filter-input" placeholder="Filter by domain or store…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      <table className="data-table">
        <thead>
          <tr>
            <th>Domain</th>
            <th>Store</th>
            <th>Source</th>
            <th>First seen</th>
            <th>Last seen</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((d) => (
            <tr key={d.id}>
              <td>{d.domain}</td>
              <td>
                <Link to={`/stores/${d.storeId}`}>{d.storeName}</Link>
              </td>
              <td className="muted small">{d.source.replace(/_/g, " ")}</td>
              <td>{formatDate(d.firstSeenAt)}</td>
              <td>{formatDate(d.lastSeenAt)}</td>
              <td>
                <span className={`badge badge-${d.isActive ? "ok" : "off"}`}>{d.isActive ? "active" : "inactive"}</span>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No domains match
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
