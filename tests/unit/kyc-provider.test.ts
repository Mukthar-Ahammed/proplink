import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  MOCK_SIGNATURE_HEADER,
  MockKycProvider,
  mockApplicantId,
  signMockWebhook,
} from "@/services/kycProvider/mockKycProvider";
import {
  SUMSUB_API_ORIGIN,
  SumsubKycProvider,
} from "@/services/kycProvider/sumsubProvider";
import {
  KycProviderUnavailableError,
  KycWebhookPayloadError,
  KycWebhookSignatureError,
} from "@/services/kycProvider/types";

const CONFIG = {
  appToken: "app-token",
  secretKey: "secret-key",
  webhookSecret: "webhook-secret",
  levelName: "basic-kyc-level",
};
const NOW = 1_763_380_000_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sumsub(fetchImpl: typeof fetch) {
  return new SumsubKycProvider(CONFIG, fetchImpl, () => NOW);
}

function digest(body: string, algorithm = "sha256", secret = CONFIG.webhookSecret) {
  return createHmac(algorithm, secret).update(body).digest("hex");
}

const reviewed = (answer: "GREEN" | "RED", rejectType?: "RETRY" | "FINAL") =>
  JSON.stringify({
    applicantId: "app-1",
    externalUserId: "profile-1",
    type: "applicantReviewed",
    reviewStatus: "completed",
    reviewResult: {
      reviewAnswer: answer,
      ...(rejectType ? { reviewRejectType: rejectType } : {}),
    },
    createdAtMs: String(NOW),
  });

describe("SumsubKycProvider requests", () => {
  it("signs ts + method + path + body and sends the app token", async () => {
    const fetchImpl = vi.fn(async () => json({ id: "app-1" }, 201));
    const provider = sumsub(fetchImpl);

    await expect(provider.createApplicant("profile-1")).resolves.toEqual({
      applicantId: "app-1",
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const path = "/resources/applicants?levelName=basic-kyc-level";
    expect(url).toBe(`${SUMSUB_API_ORIGIN}${path}`);
    const headers = init.headers as Record<string, string>;
    const ts = String(Math.floor(NOW / 1000));
    expect(headers["X-App-Token"]).toBe("app-token");
    expect(headers["X-App-Access-Ts"]).toBe(ts);
    const body = JSON.stringify({ externalUserId: "profile-1" });
    expect(init.body).toBe(body);
    expect(headers["X-App-Access-Sig"]).toBe(
      createHmac("sha256", "secret-key").update(`${ts}POST${path}${body}`).digest("hex"),
    );
    expect(init.redirect).toBe("error");
  });

  it("looks up an existing applicant on 409", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ description: "exists" }, 409))
      .mockResolvedValueOnce(json({ id: "existing-1" }));
    await expect(sumsub(fetchImpl).createApplicant("profile/1")).resolves.toEqual({
      applicantId: "existing-1",
    });
    expect(fetchImpl.mock.calls[1][0]).toBe(
      `${SUMSUB_API_ORIGIN}/resources/applicants/-;externalUserId=profile%2F1/one`,
    );
  });

  it.each([401, 429, 500])("treats HTTP %i as unavailable", async (status) => {
    await expect(
      sumsub(vi.fn(async () => json({}, status))).createApplicant("p"),
    ).rejects.toBeInstanceOf(KycProviderUnavailableError);
  });

  it("treats network errors as unavailable", async () => {
    const offline = sumsub(
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(offline.getStatus("a")).rejects.toMatchObject({ reason: "network" });
  });

  it("returns only Sumsub HTTPS verification links", async () => {
    const ok = sumsub(
      vi.fn(async () => json({ url: "https://in.sumsub.com/websdk/p/abc" })),
    );
    await expect(ok.getVerificationLink("profile-1", 1800)).resolves.toEqual({
      url: "https://in.sumsub.com/websdk/p/abc",
    });

    for (const url of [
      "https://evil.example/websdk",
      "http://in.sumsub.com/x",
      "https://sumsub.com.evil.example/x",
    ]) {
      const bad = sumsub(vi.fn(async () => json({ url })));
      await expect(bad.getVerificationLink("profile-1", 1800)).rejects.toMatchObject({
        reason: "unexpected_link_host",
      });
    }
  });

  it("maps applicant review state", async () => {
    const status = (review: unknown) =>
      sumsub(vi.fn(async () => json({ id: "a", review }))).getStatus("a");
    await expect(status({ reviewResult: { reviewAnswer: "GREEN" } })).resolves.toBe(
      "APPROVED",
    );
    await expect(status({ reviewResult: { reviewAnswer: "RED" } })).resolves.toBe(
      "REJECTED",
    );
    await expect(status({ reviewStatus: "pending" })).resolves.toBe("PENDING");
    await expect(status(undefined)).resolves.toBe("PENDING");
  });
});

describe("SumsubKycProvider webhooks", () => {
  const provider = sumsub(vi.fn());

  it("accepts a valid HMAC-SHA256 digest and maps the decision", () => {
    const body = reviewed("GREEN");
    const event = provider.parseWebhook(
      body,
      new Headers({ "x-payload-digest": digest(body) }),
    );
    expect(event).toEqual({
      applicantId: "app-1",
      externalUserId: "profile-1",
      type: "applicantReviewed",
      outcome: "APPROVED",
      rejectType: null,
      occurredAt: new Date(NOW),
    });
  });

  it.each([
    ["HMAC_SHA1_HEX", "sha1"],
    ["HMAC_SHA512_HEX", "sha512"],
  ])("supports %s", (alg, algorithm) => {
    const body = reviewed("RED", "FINAL");
    const event = provider.parseWebhook(
      body,
      new Headers({
        "x-payload-digest": digest(body, algorithm),
        "x-payload-digest-alg": alg,
      }),
    );
    expect(event).toMatchObject({ outcome: "REJECTED", rejectType: "FINAL" });
  });

  it.each([
    ["missing digest", {}],
    [
      "wrong secret",
      { "x-payload-digest": digest(reviewed("GREEN"), "sha256", "other") },
    ],
    [
      "unknown algorithm",
      { "x-payload-digest": digest(reviewed("GREEN")), "x-payload-digest-alg": "MD5" },
    ],
    ["not hex", { "x-payload-digest": "zz" }],
  ])("rejects a forged webhook: %s", (_label, headers) => {
    expect(() =>
      provider.parseWebhook(
        reviewed("GREEN"),
        new Headers(headers as Record<string, string>),
      ),
    ).toThrow(KycWebhookSignatureError);
  });

  it("rejects a body changed after signing", () => {
    const signed = reviewed("RED");
    const tampered = signed.replace('"RED"', '"GREEN"');
    expect(() =>
      provider.parseWebhook(
        tampered,
        new Headers({ "x-payload-digest": digest(signed) }),
      ),
    ).toThrow(KycWebhookSignatureError);
  });

  it("rejects signed but unreadable payloads", () => {
    for (const body of [
      "not json",
      JSON.stringify({ type: "x" }),
      JSON.stringify({ applicantId: "a", type: "t" }),
    ]) {
      expect(() =>
        provider.parseWebhook(body, new Headers({ "x-payload-digest": digest(body) })),
      ).toThrow(KycWebhookPayloadError);
    }
  });

  it("parses Sumsub's createdAt string format", () => {
    const body = JSON.stringify({
      applicantId: "a",
      type: "applicantPending",
      reviewStatus: "pending",
      createdAt: "2026-11-17 10:00:00+0000",
    });
    const event = provider.parseWebhook(
      body,
      new Headers({ "x-payload-digest": digest(body) }),
    );
    expect(event).toMatchObject({
      outcome: "PENDING",
      externalUserId: null,
      occurredAt: new Date("2026-11-17T10:00:00Z"),
    });
  });
});

describe("MockKycProvider", () => {
  const mock = new MockKycProvider("http://localhost:3000");

  it("creates a stable applicant and a local hosted-flow link", async () => {
    await expect(mock.createApplicant("p1")).resolves.toEqual({
      applicantId: mockApplicantId("p1"),
    });
    const { url } = await mock.getVerificationLink("p1");
    expect(new URL(url).pathname).toBe("/verify/mock");
  });

  it("verifies its own signature", () => {
    const body = JSON.stringify({
      applicantId: "a",
      externalUserId: "p1",
      type: "applicantReviewed",
      outcome: "APPROVED",
      rejectType: null,
      occurredAtMs: NOW,
      nonce: "n",
    });
    expect(
      mock.parseWebhook(
        body,
        new Headers({ [MOCK_SIGNATURE_HEADER]: signMockWebhook(body) }),
      ),
    ).toMatchObject({ outcome: "APPROVED", occurredAt: new Date(NOW) });
    expect(() =>
      mock.parseWebhook(body, new Headers({ [MOCK_SIGNATURE_HEADER]: "00" })),
    ).toThrow(KycWebhookSignatureError);
    expect(() => mock.parseWebhook(body, new Headers())).toThrow(
      KycWebhookSignatureError,
    );
  });
});
