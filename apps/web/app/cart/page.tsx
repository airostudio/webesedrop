"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { ProductSummary } from "@/lib/types";

interface Line {
  productId: string;
  quantity: number;
  product: ProductSummary;
}

// Real cart persistence (carts/cart_items in supabase/schema.sql, synced from
// "Add to Cart") isn't wired up yet — see README "What's stubbed" — so this
// starts empty rather than pointing at fabricated product ids. Once
// AddToCartActions writes here (client state, then a cart_id synced to the
// DB), this page renders whatever's actually in it, no code change needed.
export default function CartPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [coupon, setCoupon] = useState("");
  const [couponApplied, setCouponApplied] = useState<string | null>(null);

  const items = lines.map((line) => ({ line, product: line.product }));

  const subtotal = items.reduce((sum, i) => sum + i.product.priceCents * i.line.quantity, 0);
  const discount = couponApplied ? Math.round(subtotal * 0.1) : 0;
  const shippingEstimate = subtotal > 0 ? 799 : 0;
  const taxEstimate = Math.round((subtotal - discount) * 0.0725);
  const total = subtotal - discount + shippingEstimate + taxEstimate;

  function updateQty(productId: string, quantity: number) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(1, quantity) } : l)));
  }

  function remove(productId: string) {
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }

  return (
    <div className="container-page py-14">
      <h1 className="font-serif text-4xl mb-10">Shopping Cart</h1>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-stone-500 mb-6">Your cart is empty.</p>
          <Link href="/shop" className="btn-primary">
            Continue Shopping
          </Link>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[1fr_360px] gap-12">
          <div className="divide-y divide-stone-200 border-t border-b border-stone-200">
            {items.map(({ line, product }) => (
              <div key={product.id} className="flex gap-4 py-6">
                <div className="relative w-24 h-28 bg-stone-200 shrink-0">
                  <Image src={product.imageUrl} alt={product.imageAlt} fill sizes="100px" className="object-cover" />
                </div>
                <div className="flex-1">
                  <Link href={`/product/${product.slug}`} className="text-sm hover:underline">
                    {product.title}
                  </Link>
                  <p className="text-sm text-stone-500 mt-1">{formatMoney(product.priceCents, product.currency)}</p>
                  <div className="flex items-center gap-4 mt-3">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateQty(product.id, Number(e.target.value))}
                      className="w-16 border border-stone-300 px-2 py-1 text-sm"
                    />
                    <button onClick={() => remove(product.id)} className="text-xs text-stone-500 underline">
                      Remove
                    </button>
                    <button className="text-xs text-stone-500 underline">Save for later</button>
                  </div>
                </div>
                <p className="text-sm">{formatMoney(product.priceCents * line.quantity, product.currency)}</p>
              </div>
            ))}
          </div>

          <aside className="border border-stone-200 p-6 h-fit">
            <div className="flex gap-2 mb-6">
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Coupon code"
                className="flex-1 border border-stone-300 px-3 py-2 text-sm"
              />
              <button
                className="btn-secondary px-4"
                onClick={() => setCouponApplied(coupon || null)}
              >
                Apply
              </button>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-stone-500">Subtotal</span>
                <span>{formatMoney(subtotal)}</span>
              </div>
              {couponApplied && (
                <div className="flex justify-between text-accent-dark">
                  <span>Discount ({couponApplied})</span>
                  <span>-{formatMoney(discount)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-stone-500">Estimated shipping</span>
                <span>{formatMoney(shippingEstimate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500">Estimated tax</span>
                <span>{formatMoney(taxEstimate)}</span>
              </div>
              <div className="flex justify-between text-base font-medium pt-3 border-t border-stone-200">
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
            </div>

            <Link href="/checkout" className="btn-primary w-full mt-6">
              Proceed to Checkout
            </Link>
            <p className="text-xs text-stone-500 mt-3 text-center">Guest checkout available — no account required.</p>
          </aside>
        </div>
      )}
    </div>
  );
}
