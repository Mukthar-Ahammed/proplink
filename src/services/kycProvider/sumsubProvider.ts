import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  KycProviderUnavailableError,
  KycWebhookPayloadError,
  KycWebhookSignatureError,
  type KycOutcome,
  type KycProvider,
  type KycWebhookEvent,
} from "@/services/kycProvider/types";

/**
 * Sumsub adapter. API requests are signed with
 * `HMAC-SHA256(secret, ts + METHOD + pathWithQuery + body)` and sent with
 * `X-App-Token`, `X-App-Access-Ts` and `X-App-Access-Sig`. Webhooks carry
 * `X-Payload-Digest`: an HMAC of the raw body with the webhook secret, using
 * the algorithm named in `X-Payload-Digest-Alg`. The host is fixed.
 */
export const SUMSUB_API_ORIGIN = "https://api.sumsub.com";
const TIMEOUT_MS = 8_000;

const DIGEST_ALGORITHMS: Record<string, string> = {
  HMAC_SHA1_HEX: "sha1",
  HMAC_SHA256_HEX: "sha256",
  HMAC_SHA512_HEX: "sha512",
};

const reviewResultSchema = z
  .object({
    reviewAnswer: z.enum(["GREEN", "RED"]).optional(),
    reviewRejectType: z.enum(["RETRY", "FINAL"]).optional(),
  })
  .optional();

const webhookSchema = z.object({
  applicantId: z.string().min(1).max(100),
  externalUserId: z.string().max(200).optional(),
  type: z.string().min(1).max(100),
  reviewStatus: z.string().max(50).optional(),
  reviewResult: reviewResultSchema,
  createdAtMs: z.union([z.string(), z.number()]).optional(),
  createdAt: z.string().optional(),
});

const applicantSchema = z.object({
  id: z.string().min(1),
  review: z
    .object({
      reviewStatus: z.string().optional(),
      reviewResult: reviewResultSchema,
    })
    .optional(),
});

function outcomeFrom(
  reviewStatus: string | undefined,
  reviewResult: z.infer<typeof reviewResultSchema>,
): KycOutcome | null {
  if (reviewResult?.reviewAnswer === "GREEN") return "APPROVED";
  if (reviewResult?.reviewAnswer === "RED") return "REJECTED";
  if (reviewStatus && ["pending", "queued", "onHold"].includes(reviewStatus)) {
    return "PENDING";
  }
  return null;
}

function parseOccurredAt(data: z.infer<typeof webhookSchema>): Date {
  if (data.createdAtMs !== undefined) {
    const ms = Number(data.createdAtMs);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  if (data.createdAt) {
    // Sumsub formats e.g. "2026-11-17 10:00:00+0000".
    const parsed = new Date(data.createdAt.replace(" ", "T").replace(/\+0000$/, "Z"));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new KycWebhookPayloadError("missing timestamp");
}

export class SumsubKycProvider implements KycProvider {
  readonly name = "sumsub" as const;

  constructor(
    private readonly config: {
      appToken: string;
      secretKey: string;
      webhookSecret: string;
      levelName: string;
    },
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Exposed for tests: the request signature Sumsub expects. */
  sign(ts: string, method: string, pathWithQuery: string, body: string): string {
    return createHmac("sha256", this.config.secretKey)
      .update(ts + method.toUpperCase() + pathWithQuery + body)
      .digest("hex");
  }

  private async request(
    method: "GET" | "POST",
    pathWithQuery: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const ts = String(Math.floor(this.now() / 1000));
    let response: Response;
    try {
      response = await this.fetchImpl(`${SUMSUB_API_ORIGIN}${pathWithQuery}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json" } : {}),
          "X-App-Token": this.config.appToken,
          "X-App-Access-Ts": ts,
          "X-App-Access-Sig": this.sign(ts, method, pathWithQuery, payload),
        },
        body: payload || undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new KycProviderUnavailableError("network");
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  }

  private applicantByExternalIdPath(externalUserId: string): string {
    return `/resources/applicants/-;externalUserId=${encodeURIComponent(externalUserId)}/one`;
  }

  async createApplicant(externalUserId: string): Promise<{ applicantId: string }> {
    const level = encodeURIComponent(this.config.levelName);
    const created = await this.request(
      "POST",
      `/resources/applicants?levelName=${level}`,
      {
        externalUserId,
      },
    );
    let result = created;
    if (created.status === 409) {
      // Already exists for this externalUserId: look it up instead.
      result = await this.request("GET", this.applicantByExternalIdPath(externalUserId));
    }
    if (result.status < 200 || result.status >= 300) {
      throw new KycProviderUnavailableError(`http_${result.status}`);
    }
    const parsed = applicantSchema.safeParse(result.json);
    if (!parsed.success) throw new KycProviderUnavailableError("invalid_body");
    return { applicantId: parsed.data.id };
  }

  async getVerificationLink(
    externalUserId: string,
    ttlSeconds: number,
  ): Promise<{ url: string }> {
    const level = encodeURIComponent(this.config.levelName);
    const query = new URLSearchParams({
      ttlInSecs: String(ttlSeconds),
      externalUserId,
    });
    const result = await this.request(
      "POST",
      `/resources/sdkIntegrations/levels/${level}/websdkLink?${query.toString()}`,
    );
    if (result.status < 200 || result.status >= 300) {
      throw new KycProviderUnavailableError(`http_${result.status}`);
    }
    const parsed = z.object({ url: z.url() }).safeParse(result.json);
    if (!parsed.success) throw new KycProviderUnavailableError("invalid_body");
    const url = new URL(parsed.data.url);
    // Only ever redirect users to Sumsub's own HTTPS hosts.
    if (
      url.protocol !== "https:" ||
      !(url.hostname === "sumsub.com" || url.hostname.endsWith(".sumsub.com"))
    ) {
      throw new KycProviderUnavailableError("unexpected_link_host");
    }
    return { url: url.toString() };
  }

  parseWebhook(rawBody: string, headers: Headers): KycWebhookEvent {
    const digest = headers.get("x-payload-digest");
    const algorithm =
      DIGEST_ALGORITHMS[headers.get("x-payload-digest-alg") ?? "HMAC_SHA256_HEX"];
    if (!digest || !algorithm || !/^[0-9a-f]+$/i.test(digest)) {
      throw new KycWebhookSignatureError();
    }
    const expected = createHmac(algorithm, this.config.webhookSecret)
      .update(rawBody)
      .digest();
    const received = Buffer.from(digest, "hex");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      throw new KycWebhookSignatureError();
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new KycWebhookPayloadError("not JSON");
    }
    const parsed = webhookSchema.safeParse(json);
    if (!parsed.success) throw new KycWebhookPayloadError("unexpected shape");
    const data = parsed.data;
    const outcome = outcomeFrom(data.reviewStatus, data.reviewResult);
    return {
      applicantId: data.applicantId,
      externalUserId: data.externalUserId ?? null,
      type: data.type,
      outcome,
      rejectType:
        outcome === "REJECTED" ? (data.reviewResult?.reviewRejectType ?? null) : null,
      occurredAt: parseOccurredAt(data),
    };
  }

  async getStatus(applicantId: string): Promise<KycOutcome> {
    const result = await this.request(
      "GET",
      `/resources/applicants/${encodeURIComponent(applicantId)}/one`,
    );
    if (result.status < 200 || result.status >= 300) {
      throw new KycProviderUnavailableError(`http_${result.status}`);
    }
    const parsed = applicantSchema.safeParse(result.json);
    if (!parsed.success) throw new KycProviderUnavailableError("invalid_body");
    return (
      outcomeFrom(parsed.data.review?.reviewStatus, parsed.data.review?.reviewResult) ??
      "PENDING"
    );
  }
}
