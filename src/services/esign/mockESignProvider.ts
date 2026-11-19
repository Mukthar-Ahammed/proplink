import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { renderPdf } from "@/lib/pdf/simplePdf";
import {
  ESignWebhookError,
  type ESignEvent,
  type ESignProvider,
  type ESignRequest,
} from "@/services/esign/types";

/**
 * Development and test e-signature provider (ADR-048). No legal effect and
 * refused in production. It mirrors the real flow: envelopes and signer ids,
 * a signed short-lived signing link (opened at /esign/mock), and HMAC-signed
 * events that go through the same webhook verification and replay checks as
 * the real provider's. The "signed PDF" is generated, listing the envelope.
 */

export const MOCK_SIGNATURE_HEADER = "x-proplink-mock-esign-signature";
const LINK_TTL_MS = 30 * 60 * 1000;

type MockEventBody = {
  id: string;
  type: ESignEvent["type"];
  envelopeId: string;
  signerId: string | null;
  time: string;
};

export class MockESignProvider implements ESignProvider {
  readonly name = "mock" as const;
  private readonly titles = new Map<string, string>();

  constructor(private readonly secret: string) {}

  private sign(value: string): string {
    return createHmac("sha256", `mock-esign:${this.secret}`).update(value).digest("hex");
  }

  private equal(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  async createEnvelope(request: ESignRequest) {
    if (request.signers.length === 0) throw new Error("An envelope needs signers");
    const envelopeId = `mock_env_${randomUUID()}`;
    this.titles.set(envelopeId, request.title);
    return {
      envelopeId,
      signerIds: request.signers.map(() => `mock_sig_${randomUUID()}`),
    };
  }

  /** `/esign/mock?…` with an expiry and an HMAC over all parameters. */
  async signingUrl(envelopeId: string, providerSignerId: string, returnPath: string) {
    const expires = String(Date.now() + LINK_TTL_MS);
    const params = new URLSearchParams({
      e: envelopeId,
      s: providerSignerId,
      r: returnPath,
      x: expires,
    });
    params.set("h", this.sign(params.toString()));
    return `/esign/mock?${params.toString()}`;
  }

  /** Checks a signing link from `signingUrl` (signature and expiry). */
  verifySigningLink(
    query: URLSearchParams,
    now: number = Date.now(),
  ): { envelopeId: string; signerId: string; returnPath: string } | null {
    const h = query.get("h") ?? "";
    const params = new URLSearchParams();
    for (const key of ["e", "s", "r", "x"]) params.set(key, query.get(key) ?? "");
    if (!this.equal(h, this.sign(params.toString()))) return null;
    if (Number(params.get("x")) < now) return null;
    const returnPath = params.get("r") ?? "/";
    return {
      envelopeId: params.get("e")!,
      signerId: params.get("s")!,
      returnPath:
        returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/",
    };
  }

  /** What the mock signing page posts to the webhook processor. */
  signedEvent(
    type: ESignEvent["type"],
    envelopeId: string,
    signerId: string | null,
    at: Date = new Date(),
  ): { rawBody: string; headers: Headers } {
    const body: MockEventBody = {
      id: `mock_evt_${randomUUID()}`,
      type,
      envelopeId,
      signerId,
      time: at.toISOString(),
    };
    const rawBody = JSON.stringify(body);
    return {
      rawBody,
      headers: new Headers({ [MOCK_SIGNATURE_HEADER]: this.sign(rawBody) }),
    };
  }

  async remind() {
    // Mock links are issued on demand, so a reminder needs no action.
  }

  async cancel() {}

  parseWebhook(rawBody: string, headers: Headers): ESignEvent {
    const signature = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
    if (!signature || !this.equal(signature, this.sign(rawBody))) {
      throw new ESignWebhookError("Invalid signature");
    }
    let body: MockEventBody;
    try {
      body = JSON.parse(rawBody) as MockEventBody;
    } catch {
      throw new ESignWebhookError("Malformed event");
    }
    const occurredAt = new Date(body.time);
    if (!body.id || !body.envelopeId || Number.isNaN(occurredAt.getTime())) {
      throw new ESignWebhookError("Malformed event");
    }
    return {
      eventId: body.id,
      envelopeId: body.envelopeId,
      occurredAt,
      type: body.type,
      providerSignerId: body.signerId,
    };
  }

  async downloadSigned(envelopeId: string): Promise<Uint8Array> {
    return renderPdf(
      [
        { text: "Signed agreement (development mock)", style: "title" },
        { text: this.titles.get(envelopeId) ?? "Project agreement", style: "heading" },
        { text: `Envelope ${envelopeId}` },
        {
          text: "Produced by the mock e-signature provider. It has no legal effect; real agreements are signed through the configured provider.",
          style: "small",
        },
      ],
      { title: "Signed agreement (mock)" },
    );
  }
}
