import { FormEvent, useEffect, useState } from "react";
import { api, formatCents, formatDate, type InvoiceListEntry, type Plan } from "../api";

export function Billing() {
  const [invoices, setInvoices] = useState<InvoiceListEntry[] | null>(null);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reload() {
    Promise.all([api.invoices(statusFilter ? { status: statusFilter } : undefined), api.plans()])
      .then(([inv, pl]) => {
        setInvoices(inv);
        setPlans(pl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load billing data"));
  }

  useEffect(reload, [statusFilter]);

  if (error) return <p className="error">{error}</p>;

  const totalPaid = (invoices ?? []).reduce((sum, i) => sum + i.amountPaidCents, 0);
  const totalOutstanding = (invoices ?? []).filter((i) => i.status === "open").reduce((sum, i) => sum + (i.amountDueCents - i.amountPaidCents), 0);

  return (
    <div>
      <h1>Billing</h1>

      <div className="tile-grid">
        <div className="tile">
          <div className="tile-value">{formatCents(totalPaid)}</div>
          <div className="tile-label">Total collected</div>
        </div>
        <div className="tile">
          <div className="tile-value">{formatCents(totalOutstanding)}</div>
          <div className="tile-label">Outstanding</div>
        </div>
        <div className="tile">
          <div className="tile-value">{(plans ?? []).filter((p) => p.isActive).length}</div>
          <div className="tile-label">Active plans</div>
        </div>
      </div>

      <section className="panel">
        <h2>Plans</h2>
        <PlanTable plans={plans} onCreated={reload} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Invoices</h2>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="paid">Paid</option>
            <option value="open">Open</option>
            <option value="uncollectible">Uncollectible</option>
            <option value="void">Void</option>
          </select>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Store</th>
              <th>Status</th>
              <th>Due</th>
              <th>Paid</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).map((inv) => (
              <tr key={inv.id}>
                <td>{formatDate(inv.createdAt)}</td>
                <td>{inv.storeName}</td>
                <td>{inv.status}</td>
                <td>{formatCents(inv.amountDueCents, inv.currency)}</td>
                <td>{formatCents(inv.amountPaidCents, inv.currency)}</td>
                <td>
                  {inv.hostedInvoiceUrl && (
                    <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                      View
                    </a>
                  )}
                </td>
              </tr>
            ))}
            {invoices && invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
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

function PlanTable({ plans, onCreated }: { plans: Plan[] | null; onCreated: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [stripePriceId, setStripePriceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createPlan({
        name,
        slug,
        priceCents: Math.round(parseFloat(priceDollars) * 100),
        billingInterval: interval,
        stripePriceId: stripePriceId || undefined,
      });
      setShowForm(false);
      setName("");
      setSlug("");
      setPriceDollars("");
      setStripePriceId("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create plan");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Plan</th>
            <th>Price</th>
            <th>Stripe price</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(plans ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>
                {formatCents(p.priceCents)} / {p.billingInterval}
              </td>
              <td className="muted small">{p.stripePriceId ?? "—"}</td>
              <td>
                <span className={`badge badge-${p.isActive ? "ok" : "off"}`}>{p.isActive ? "active" : "inactive"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm ? (
        <form className="inline-form" onSubmit={handleSubmit}>
          <input placeholder="Name (e.g. Pro)" value={name} onChange={(e) => setName(e.target.value)} required />
          <input placeholder="Slug (e.g. pro)" value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <input placeholder="Price (USD)" type="number" step="0.01" min="0" value={priceDollars} onChange={(e) => setPriceDollars(e.target.value)} required />
          <select value={interval} onChange={(e) => setInterval(e.target.value as "month" | "year")}>
            <option value="month">Monthly</option>
            <option value="year">Yearly</option>
          </select>
          <input placeholder="Stripe price id (price_...)" value={stripePriceId} onChange={(e) => setStripePriceId(e.target.value)} />
          <button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create plan"}
          </button>
          <button type="button" className="secondary" onClick={() => setShowForm(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <button className="secondary" onClick={() => setShowForm(true)}>
          + New plan
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
