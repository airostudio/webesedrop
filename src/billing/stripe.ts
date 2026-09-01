import Stripe from "stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let cached: Stripe | undefined;

/** The engine's own Stripe account — bills stores for using the engine, entirely separate from any AliExpress/order money. */
export function getStripe(): Stripe {
  if (!cached) {
    cached = new Stripe(requireEnv("STRIPE_SECRET_KEY"), { apiVersion: "2025-02-24.acacia" });
  }
  return cached;
}

export function getWebhookSecret(): string {
  return requireEnv("STRIPE_WEBHOOK_SECRET");
}
