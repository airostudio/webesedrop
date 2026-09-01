const sampleOrders = [
  { id: "ORD-10231", date: "2026-08-02", status: "Delivered", total: "$1,899.00" },
  { id: "ORD-10198", date: "2026-07-14", status: "Shipped", total: "$149.00" },
];

export default function OrdersPage() {
  return (
    <div className="space-y-4">
      {sampleOrders.map((o) => (
        <a key={o.id} href={`/account/orders/${o.id}`} className="flex justify-between items-center border border-stone-200 p-4 text-sm hover:border-ink-500">
          <div>
            <p className="font-medium">{o.id}</p>
            <p className="text-stone-500">{o.date}</p>
          </div>
          <p className="text-stone-500">{o.status}</p>
          <p>{o.total}</p>
        </a>
      ))}
    </div>
  );
}
