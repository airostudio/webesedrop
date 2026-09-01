import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WebhookEvent =
  | "product.price_changed"
  | "product.out_of_stock"
  | "product.restocked"
  | "order.shipped"
  | "order.delivered"
  | "order.fulfillment_failed";

export interface WebhookDeliveryRequest {
  storeId: string;
  webhookUrl: string;
  webhookSecret: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

/** Signs a webhook payload the same way Stripe/GitHub do: HMAC-SHA256 over the raw JSON body, sent as a header, so the receiver can verify it actually came from this engine. */
export function signWebhookPayload(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Delivers one webhook and records the attempt. Does not retry — retries are the sync/tracking jobs' job (they re-derive the same event next run), so this stays a fire-and-log call. */
export async function deliverWebhook(db: SupabaseClient, request: WebhookDeliveryRequest): Promise<{ delivered: boolean; status?: number }> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const body = JSON.stringify({ event: request.event, data: request.payload, sentAt: new Date().toISOString() });
  const signature = signWebhookPayload(request.webhookSecret, body);

  let delivered = false;
  let status: number | undefined;
  try {
    const res = await fetchImpl(request.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dropship-Signature": signature, "X-Dropship-Event": request.event },
      body,
    });
    status = res.status;
    delivered = res.ok;
  } catch {
    delivered = false;
  }

  await db.from("webhook_deliveries").insert({
    store_id: request.storeId,
    event: request.event,
    payload: request.payload,
    status: delivered ? "delivered" : "failed",
    attempts: 1,
    last_attempt_at: new Date().toISOString(),
  });

  return { delivered, status };
}
