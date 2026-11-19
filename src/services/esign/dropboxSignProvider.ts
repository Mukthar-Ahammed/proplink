import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import {
  ESignWebhookError,
  type ESignEvent,
  type ESignProvider,
  type ESignRequest,
} from "@/services/esign/types";

/**
 * Dropbox Sign adapter (ADR-048; default provider, [OWNER confirms]). REST
 * API v3 with HTTP Basic auth (API key as the user name). Each signer gets
 * their own signing email from Dropbox Sign (non-embedded requests, so no
 * client-side library or CSP change is needed); PropLink shows the status
 * and can send a fresh reminder. Callbacks are verified with the documented
 * event hash: HMAC-SHA256 keyed with the API key over event_time +
 * event_type. Credentials: docs/credentials/esignature.md.
 */

const API = "https://api.hellosign.com/v3";

type FetchLike = typeof fetch;

type DropboxEvent = {
  event?: {
    event_time?: string;
    event_type?: string;
    event_hash?: string;
    event_metadata?: { related_signature_id?: string | null };
  };
  signature_request?: { signature_request_id?: string };
};

const TYPES: Record<string, ESignEvent["type"]> = {
  signature_request_signed: "SIGNED",
  signature_request_all_signed: "ALL_SIGNED",
  signature_request_declined: "DECLINED",
  signature_request_expired: "EXPIRED",
  signature_request_canceled: "VOIDED",
};

export class DropboxSignProvider implements ESignProvider {
  readonly name = "dropbox_sign" as const;

  constructor(
    private readonly apiKey: string,
    private readonly clientId: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private auth(): string {
    return `Basic ${Buffer.from(`${this.apiKey}:`).toString("base64")}`;
  }

  private async call(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: this.auth(), ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      // Never log the request or response bodies: they hold personal data.
      console.warn(
        JSON.stringify({
          event: "esign.provider_error",
          path: path.split("/")[1],
          status: response.status,
        }),
      );
      throw new Error(`Dropbox Sign request failed (${response.status})`);
    }
    return response;
  }

  async createEnvelope(request: ESignRequest) {
    const form = new FormData();
    form.set("client_id", this.clientId);
    form.set("title", request.title.slice(0, 255));
    form.set("subject", request.title.slice(0, 255));
    form.set(
      "message",
      "Please review and sign the project agreement prepared by the project's Solicitor.",
    );
    form.set("test_mode", request.testMode ? "1" : "0");
    form.set(`metadata[${request.context.type.toLowerCase()}]`, request.context.id);
    request.signers.forEach((signer, index) => {
      form.set(`signers[${index}][email_address]`, signer.email);
      form.set(`signers[${index}][name]`, signer.name);
    });
    form.set(
      "files[0]",
      new Blob([Buffer.from(request.document.bytes)], { type: "application/pdf" }),
      request.document.fileName,
    );
    const response = await this.call("/signature_request/send", {
      method: "POST",
      body: form,
    });
    const json = (await response.json()) as {
      signature_request?: {
        signature_request_id?: string;
        signatures?: { signature_id: string; signer_email_address: string }[];
      };
    };
    const envelopeId = json.signature_request?.signature_request_id;
    const signatures = json.signature_request?.signatures ?? [];
    if (!envelopeId) throw new Error("Dropbox Sign returned no signature request id");
    // Map back by email (the provider keeps the order, but email is explicit).
    const signerIds = request.signers.map((signer) => {
      const match = signatures.find(
        (signature) =>
          signature.signer_email_address.toLowerCase() === signer.email.toLowerCase(),
      );
      if (!match) throw new Error("Dropbox Sign returned an unexpected signer list");
      return match.signature_id;
    });
    return { envelopeId, signerIds };
  }

  /** Non-embedded: each signer signs from Dropbox Sign's own email. */
  async signingUrl(): Promise<string | null> {
    return null;
  }

  async remind(envelopeId: string, signerEmail: string) {
    const form = new FormData();
    form.set("email_address", signerEmail);
    await this.call(`/signature_request/remind/${encodeURIComponent(envelopeId)}`, {
      method: "POST",
      body: form,
    });
  }

  async cancel(envelopeId: string) {
    await this.call(`/signature_request/cancel/${encodeURIComponent(envelopeId)}`, {
      method: "POST",
    });
  }

  parseWebhook(rawBody: string): ESignEvent {
    let body: DropboxEvent;
    try {
      body = JSON.parse(rawBody) as DropboxEvent;
    } catch {
      throw new ESignWebhookError("Malformed event");
    }
    const event = body.event;
    const time = event?.event_time ?? "";
    const type = event?.event_type ?? "";
    const hash = event?.event_hash ?? "";
    if (!/^\d{9,11}$/.test(time) || !type || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new ESignWebhookError("Malformed event");
    }
    const expected = createHmac("sha256", this.apiKey)
      .update(time + type)
      .digest("hex");
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) {
      throw new ESignWebhookError("Invalid signature");
    }
    const envelopeId = body.signature_request?.signature_request_id ?? "";
    const signerId = event?.event_metadata?.related_signature_id ?? null;
    return {
      // The hash covers only time and type, so the replay key adds the request and signer.
      eventId: createHash("sha256")
        .update(`${hash}:${envelopeId}:${signerId ?? ""}`)
        .digest("hex"),
      envelopeId,
      occurredAt: new Date(Number(time) * 1000),
      type: TYPES[type] ?? "OTHER",
      providerSignerId: signerId,
    };
  }

  async downloadSigned(envelopeId: string): Promise<Uint8Array> {
    const response = await this.call(
      `/signature_request/files/${encodeURIComponent(envelopeId)}?file_type=pdf`,
      { method: "GET" },
    );
    return new Uint8Array(await response.arrayBuffer());
  }
}
