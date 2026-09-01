"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";

export default function AddToCartActions({ priceCents, currency }: { priceCents: number; currency: string }) {
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [wishlisted, setWishlisted] = useState(false);

  return (
    <div className="mt-8 space-y-4">
      <div className="flex items-center gap-3">
        <label htmlFor="qty" className="text-sm text-stone-500">
          Quantity
        </label>
        <input
          id="qty"
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
          className="w-20 border border-stone-300 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="btn-primary flex-1 min-w-[180px]" onClick={() => setAdded(true)}>
          {added ? "Added ✓" : "Add to Cart"}
        </button>
        <button className="btn-secondary flex-1 min-w-[140px]">Buy Now</button>
      </div>

      <div className="flex gap-6 text-xs tracking-widest2 uppercase text-stone-500">
        <button onClick={() => setWishlisted((v) => !v)} className={wishlisted ? "text-ink-950" : ""}>
          {wishlisted ? "Wishlisted ✓" : "Add to Wishlist"}
        </button>
        <button>Compare</button>
      </div>

      <p className="text-xs text-stone-500">
        {formatMoney(priceCents, currency)} · Ships in simple, unmarked packaging.
      </p>
    </div>
  );
}
