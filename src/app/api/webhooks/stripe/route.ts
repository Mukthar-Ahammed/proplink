import { NextResponse } from "next/server";

import {
  processBillingWebhook,
  WEBHOOK_MAX_BYTES,
} from "@/services/billing/subscriptions";

/**
 * Billing webhook (Phase 3 Task 1, ADR-042). Authenticated by the provider's
 * signature over the exact raw body, not by cookies or origin; the proxy
 * exempts POST /api/webhooks/* from the same-origin check and applies the
 * webhook rate class. Idempotent and tolerant of out-of-order events.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const rawBody = await request.text();
  if (rawBody.length > WEBHOOK_MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  try {
    const result = await processBillingWebhook(rawBody, request.headers);
    if (result.status === 200)
      return NextResponse.json({ ok: true, result: result.result });
    return NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "billing_webhook.processing_failed",
        name: error instanceof Error ? error.name : "unknown",
      }),
    );
    // 5xx so the provider retries; nothing was recorded.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
