import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import {
  KycWebhookPayloadError,
  KycWebhookSignatureError,
  type KycOutcome,
  type KycProvider,
  type KycWebhookEvent,
} from "@/services/kycProvider/types";

/**
 * Local/test provider. Its "hosted flow" is the development-only page
 * `/verify/mock`, which sends signed mock webhooks through the same
 * verification and idempotency path as a real provider.
 */
export const MOCK_WEBHOOK_SECRET = "proplink-mock-kyc-webhook-secret-not-for-production";
export const MOCK_SIGNATURE_HEADER = "x-mock-kyc-signature";

const mockWebhookSchema = z
  .object({
    applicantId: z.string().min(1).max(100),
    externalUserId: z.string().max(200),
    type: z.string().min(1).max(100),
    outcome: z.enum(["PENDING", "APPROVED", "REJECTED"]).nullable(),
    rejectType: z.enum(["RETRY", "FINAL"]).nullable(),
    occurredAtMs: z.number().int(),
    nonce: z.string().max(100),
  })
  .strict();

export type MockWebhookPayload = z.infer<typeof mockWebhookSchema>;

export function mockApplicantId(externalUserId: string): string {
  return `mock-${createHash("sha256").update(externalUserId).digest("hex").slice(0, 24)}`;
}

export function signMockWebhook(rawBody: string): string {
  return createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

export class MockKycProvider implements KycProvider {
  readonly name = "mock" as const;

  constructor(private readonly appOrigin: string) {}

  async createApplicant(externalUserId: string) {
    return { applicantId: mockApplicantId(externalUserId) };
  }

  async getVerificationLink(externalUserId: string) {
    const url = new URL("/verify/mock", this.appOrigin);
    url.searchParams.set("applicant", mockApplicantId(externalUserId));
    return { url: url.toString() };
  }

  parseWebhook(rawBody: string, headers: Headers): KycWebhookEvent {
    const signature = headers.get(MOCK_SIGNATURE_HEADER);
    const expected = Buffer.from(signMockWebhook(rawBody), "hex");
    const received = Buffer.from(signature ?? "", "hex");
    if (
      !signature ||
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw new KycWebhookSignatureError();
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new KycWebhookPayloadError("not JSON");
    }
    const parsed = mockWebhookSchema.safeParse(json);
    if (!parsed.success) throw new KycWebhookPayloadError("unexpected shape");
    return {
      applicantId: parsed.data.applicantId,
      externalUserId: parsed.data.externalUserId,
      type: parsed.data.type,
      outcome: parsed.data.outcome,
      rejectType: parsed.data.rejectType,
      occurredAt: new Date(parsed.data.occurredAtMs),
    };
  }

  async getStatus(): Promise<KycOutcome> {
    return "PENDING";
  }
}
