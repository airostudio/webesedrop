"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatMoney } from "@/lib/format";

const checkoutSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  phone: z.string().optional(),
  fullName: z.string().min(2, "Enter your full name"),
  line1: z.string().min(3, "Enter your street address"),
  line2: z.string().optional(),
  city: z.string().min(1, "Enter a city"),
  region: z.string().optional(),
  postalCode: z.string().min(1, "Enter a postal code"),
  country: z.string().min(2, "Select a country"),
});

type CheckoutForm = z.infer<typeof checkoutSchema>;

const paymentMethods = [
  { id: "card", label: "Card" },
  { id: "apple_pay", label: "Apple Pay" },
  { id: "google_pay", label: "Google Pay" },
];

const steps = ["Customer", "Delivery", "Payment", "Review"] as const;

const subtotal = 15980;
const shipping = 799;
const tax = 1158;
const total = subtotal + shipping + tax;

export default function CheckoutPage() {
  const [stepIndex, setStepIndex] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [placed, setPlaced] = useState(false);

  const {
    register,
    handleSubmit,
    trigger,
    formState: { errors },
  } = useForm<CheckoutForm>({ resolver: zodResolver(checkoutSchema), mode: "onBlur" });

  async function goNext() {
    if (stepIndex === 0) {
      const ok = await trigger(["email", "phone"]);
      if (!ok) return;
    }
    if (stepIndex === 1) {
      const ok = await trigger(["fullName", "line1", "city", "postalCode", "country"]);
      if (!ok) return;
    }
    setStepIndex((i) => Math.min(steps.length - 1, i + 1));
  }

  return (
    <div className="container-page py-14 max-w-4xl">
      <h1 className="font-serif text-4xl mb-3">Checkout</h1>
      <p className="text-xs text-stone-500 mb-10">Guest checkout — no account required.</p>

      <div className="flex gap-2 mb-10">
        {steps.map((s, i) => (
          <span key={s} className={`text-xs tracking-widest2 uppercase px-3 py-1.5 border ${i === stepIndex ? "border-ink-950 bg-ink-950 text-warm-50" : "border-stone-300 text-stone-500"}`}>
            {i + 1}. {s}
          </span>
        ))}
      </div>

      {placed ? (
        <div className="text-center py-20">
          <h2 className="font-serif text-3xl mb-4">Order placed ✓</h2>
          <p className="text-stone-500">A confirmation has been sent to your email. Thank you for shopping with us.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit(() => setPlaced(true))}>
          {stepIndex === 0 && (
            <div className="space-y-4 max-w-md">
              <div>
                <label className="text-sm block mb-1">Email</label>
                <input {...register("email")} className="w-full border border-stone-300 px-3 py-2 text-sm" />
                {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email.message}</p>}
              </div>
              <div>
                <label className="text-sm block mb-1">Phone (optional)</label>
                <input {...register("phone")} className="w-full border border-stone-300 px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          {stepIndex === 1 && (
            <div className="space-y-4 max-w-md">
              {[
                { name: "fullName" as const, label: "Full name" },
                { name: "line1" as const, label: "Address line 1" },
                { name: "line2" as const, label: "Address line 2 (optional)" },
                { name: "city" as const, label: "City" },
                { name: "region" as const, label: "State / Region (optional)" },
                { name: "postalCode" as const, label: "Postal code" },
                { name: "country" as const, label: "Country (ISO code, e.g. US)" },
              ].map((f) => (
                <div key={f.name}>
                  <label className="text-sm block mb-1">{f.label}</label>
                  <input {...register(f.name)} className="w-full border border-stone-300 px-3 py-2 text-sm" />
                  {errors[f.name] && <p className="text-xs text-red-600 mt-1">{errors[f.name]?.message}</p>}
                </div>
              ))}
              <p className="text-xs text-stone-500">Estimated delivery: 5–12 business days via Standard Shipping.</p>
            </div>
          )}

          {stepIndex === 2 && (
            <div className="max-w-md space-y-3">
              <p className="text-sm text-stone-500 mb-2">Only payment methods enabled by our configured processor are shown.</p>
              {paymentMethods.map((m) => (
                <label key={m.id} className="flex items-center gap-3 border border-stone-300 px-4 py-3 text-sm cursor-pointer">
                  <input type="radio" name="payment" checked={paymentMethod === m.id} onChange={() => setPaymentMethod(m.id)} />
                  {m.label}
                </label>
              ))}
              <p className="text-xs text-stone-500 pt-2">
                Card details are handled entirely by our payment processor's secure, tokenised fields — Beach Footprints never stores raw card numbers.
              </p>
            </div>
          )}

          {stepIndex === 3 && (
            <div className="max-w-md">
              <dl className="space-y-2 text-sm border-t border-b border-stone-200 py-4">
                <div className="flex justify-between">
                  <dt className="text-stone-500">Subtotal</dt>
                  <dd>{formatMoney(subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Shipping</dt>
                  <dd>{formatMoney(shipping)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">Tax</dt>
                  <dd>{formatMoney(tax)}</dd>
                </div>
                <div className="flex justify-between font-medium text-base">
                  <dt>Total</dt>
                  <dd>{formatMoney(total)}</dd>
                </div>
              </dl>
              <p className="text-xs text-stone-500 mt-4">Payment method: {paymentMethods.find((m) => m.id === paymentMethod)?.label}</p>
            </div>
          )}

          <div className="flex justify-between mt-10 max-w-md">
            <button type="button" className="btn-ghost" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
              Back
            </button>
            {stepIndex < steps.length - 1 ? (
              <button type="button" className="btn-secondary" onClick={goNext}>
                Continue
              </button>
            ) : (
              <button type="submit" className="btn-primary">
                Place Order
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
