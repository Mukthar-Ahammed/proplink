import { NextResponse } from "next/server";

import { processESignWebhook } from "@/services/projects/agreements";

const MAX_BYTES = 256 * 1024;

/**
 * E-signature callbacks (Phase 4 Task 6, ADR-048). Authenticated by the
 * provider's own signature (Dropbox Sign: the event hash; mock: an HMAC
 * header), not by cookies; the proxy exempts POST /api/webhooks/* from the
 * same-origin check and applies the webhook rate class. Replays are
 * acknowledged without effect; stale or forged events are refused.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let rawBody: string;
  const type = request.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    // Dropbox Sign posts the event as a form field named "json".
    const form = await request.formData();
    const json = form.get("json");
    rawBody = typeof json === "string" ? json : "";
  } else {
    rawBody = await request.text();
  }
  if (rawBody.length === 0 || rawBody.length > MAX_BYTES) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const result = await processESignWebhook(rawBody, request.headers);
    if (!result.ok) {
      return NextResponse.json({ error: "Rejected" }, { status: result.status });
    }
    // Dropbox Sign requires this exact acknowledgement text.
    return new NextResponse("Hello API Event Received", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "esign_webhook.processing_failed",
        name: error instanceof Error ? error.name : "unknown",
      }),
    );
    // 5xx so the provider retries; the event is recorded only after verification.
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
