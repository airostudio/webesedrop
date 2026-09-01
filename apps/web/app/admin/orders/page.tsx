const sampleOrders = [
  { id: "ORD-10231", customer: "j***@example.com", status: "Delivered", total: "$1,899.00" },
  { id: "ORD-10198", customer: "m***@example.com", status: "Shipped", total: "$149.00" },
];

export default function AdminOrdersPage() {
  return (
    <div>
      <h1 className="font-serif text-3xl mb-6">Orders</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500 border-b border-stone-200">
            <th className="py-2">Order</th>
            <th className="py-2">Customer</th>
            <th className="py-2">Status</th>
            <th className="py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {sampleOrders.map((o) => (
            <tr key={o.id} className="border-b border-stone-100">
              <td className="py-2">{o.id}</td>
              <td className="py-2 text-stone-500">{o.customer}</td>
              <td className="py-2 text-stone-500">{o.status}</td>
              <td className="py-2">{o.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
