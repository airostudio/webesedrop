const timeline = ["Order placed", "Payment confirmed", "Production started", "Quality check", "Preparing shipment", "Shipped", "Delivered"];

export default function OrderDetailPage({ params }: { params: { id: string } }) {
  return (
    <div>
      <h2 className="font-serif text-2xl mb-6">Order {params.id}</h2>
      <ol className="space-y-4">
        {timeline.map((step, i) => (
          <li key={step} className="flex items-center gap-3 text-sm">
            <span className={`w-2 h-2 rounded-full ${i < 4 ? "bg-ink-950" : "bg-stone-300"}`} />
            <span className={i < 4 ? "text-ink-900" : "text-stone-400"}>{step}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-stone-500 mt-8">Some statuses may be hidden by the merchant depending on order type.</p>
    </div>
  );
}
