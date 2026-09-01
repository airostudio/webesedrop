import { NextResponse } from "next/server";
import { triggerTrackingSync } from "@/lib/dropshipEngine";

export const runtime = "nodejs";

/**
 * Manually triggers a tracking poll for every in-flight AliExpress order —
 * the same work the dropship-engine's scheduled every-5-hours job does, for
 * on-demand/admin-triggered use. The engine applies the actual updates by
 * calling back into POST /api/webhooks/dropship-engine (order.shipped /
 * order.delivered) before this request returns, so Beach Footprints' own
 * `orders` rows are already current by the time this responds.
 */
export async function POST() {
  try {
    const summary = await triggerTrackingSync();
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tracking sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
