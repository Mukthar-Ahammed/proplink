import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseServerEnv } from "@/env";
import { renderPdf } from "@/lib/pdf/simplePdf";
import { DropboxSignProvider } from "@/services/esign/dropboxSignProvider";
import {
  MockESignProvider,
  MOCK_SIGNATURE_HEADER,
} from "@/services/esign/mockESignProvider";
import { ESignWebhookError } from "@/services/esign/types";
import { detectFileType } from "@/services/uploads/sniff";

/**
 * Phase 4 Task 6 (ADR-048): the e-signature adapters without network or
 * database. The Dropbox Sign adapter is checked against the documented API
 * shapes with a stubbed fetch; the live smoke test is in
 * docs/credentials/esignature.md.
 */

const API_KEY = "test-api-key";
const REQUEST = {
  document: { bytes: new Uint8Array([37, 80, 68, 70]), fileName: "agreement.pdf" },
  title: "Joint investment agreement",
  context: { type: "PROJECT_AGREEMENT" as const, id: "agreement-1" },
  signers: [
    {
      profileId: "p1",
      role: "INVESTOR" as const,
      email: "lead@example.test",
      name: "Lead",
    },
    {
      profileId: "p2",
      role: "AGENT" as const,
      email: "agent@example.test",
      name: "Agent",
    },
  ],
  testMode: true,
};

function dropboxEvent(
  type: string,
  time = String(Math.floor(Date.now() / 1000)),
  key = API_KEY,
) {
  return JSON.stringify({
    event: {
      event_time: time,
      event_type: type,
      event_hash: createHmac("sha256", key)
        .update(time + type)
        .digest("hex"),
      event_metadata: { related_signature_id: "sig-2" },
    },
    signature_request: { signature_request_id: "req-1" },
  });
}

describe("Dropbox Sign adapter", () => {
  it("creates a request with the signers and maps their signature ids by email", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({
        signature_request: {
          signature_request_id: "req-1",
          signatures: [
            { signature_id: "sig-2", signer_email_address: "AGENT@example.test" },
            { signature_id: "sig-1", signer_email_address: "lead@example.test" },
          ],
        },
      }),
    );
    const provider = new DropboxSignProvider(
      API_KEY,
      "client-1",
      fetchImpl as typeof fetch,
    );
    expect(await provider.createEnvelope(REQUEST)).toEqual({
      envelopeId: "req-1",
      signerIds: ["sig-1", "sig-2"],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.hellosign.com/v3/signature_request/send");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${API_KEY}:`).toString("base64")}`,
    );
    const form = init?.body as FormData;
    expect(form.get("client_id")).toBe("client-1");
    expect(form.get("test_mode")).toBe("1");
    expect(form.get("signers[0][email_address]")).toBe("lead@example.test");
    expect(form.get("signers[1][name]")).toBe("Agent");
    expect(form.get("files[0]")).toBeInstanceOf(Blob);
  });

  it("verifies callbacks with the event hash and refuses forgeries", () => {
    const provider = new DropboxSignProvider(
      API_KEY,
      "client-1",
      vi.fn() as typeof fetch,
    );
    const event = provider.parseWebhook(dropboxEvent("signature_request_signed"));
    expect(event).toMatchObject({
      envelopeId: "req-1",
      type: "SIGNED",
      providerSignerId: "sig-2",
    });
    expect(event.eventId).toMatch(/^[0-9a-f]{64}$/);
    // Same event again: the same replay key.
    const again = provider.parseWebhook(
      dropboxEvent(
        "signature_request_signed",
        String(Math.floor(event.occurredAt.getTime() / 1000)),
      ),
    );
    expect(again.eventId).toBe(event.eventId);
    expect(provider.parseWebhook(dropboxEvent("signature_request_all_signed")).type).toBe(
      "ALL_SIGNED",
    );
    expect(() =>
      provider.parseWebhook(
        dropboxEvent("signature_request_signed", undefined, "wrong-key"),
      ),
    ).toThrow(ESignWebhookError);
    expect(() => provider.parseWebhook("not json")).toThrow(ESignWebhookError);
    expect(() => provider.parseWebhook(JSON.stringify({ event: {} }))).toThrow(
      ESignWebhookError,
    );
  });

  it("reminds, cancels and downloads through the documented endpoints", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const provider = new DropboxSignProvider(
      API_KEY,
      "client-1",
      fetchImpl as typeof fetch,
    );
    await provider.remind("req-1", "lead@example.test");
    await provider.cancel("req-1");
    expect(await provider.downloadSigned("req-1")).toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchImpl.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      "https://api.hellosign.com/v3/signature_request/remind/req-1",
      "https://api.hellosign.com/v3/signature_request/cancel/req-1",
      "https://api.hellosign.com/v3/signature_request/files/req-1?file_type=pdf",
    ]);
    expect(await provider.signingUrl()).toBeNull();
  });

  it("surfaces provider errors without their bodies", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const provider = new DropboxSignProvider(
      API_KEY,
      "client-1",
      vi.fn(
        async () => new Response("secret personal data", { status: 400 }),
      ) as typeof fetch,
    );
    await expect(provider.cancel("req-1")).rejects.toThrow(
      "Dropbox Sign request failed (400)",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret personal data");
    warn.mockRestore();
  });
});

describe("mock provider", () => {
  it("issues expiring, tamper-proof signing links and signed events", async () => {
    const provider = new MockESignProvider("secret");
    const url = await provider.signingUrl("env-1", "sig-1", "/investor/projects/x");
    const query = new URL(url, "http://x").searchParams;
    expect(provider.verifySigningLink(query)).toEqual({
      envelopeId: "env-1",
      signerId: "sig-1",
      returnPath: "/investor/projects/x",
    });
    const tampered = new URLSearchParams(query);
    tampered.set("s", "sig-2");
    expect(provider.verifySigningLink(tampered)).toBeNull();
    expect(provider.verifySigningLink(query, Date.now() + 31 * 60 * 1000)).toBeNull();
    expect(new MockESignProvider("other").verifySigningLink(query)).toBeNull();

    const event = provider.signedEvent("SIGNED", "env-1", "sig-1");
    expect(provider.parseWebhook(event.rawBody, event.headers)).toMatchObject({
      envelopeId: "env-1",
      type: "SIGNED",
      providerSignerId: "sig-1",
    });
    expect(() =>
      provider.parseWebhook(event.rawBody, new Headers({ [MOCK_SIGNATURE_HEADER]: "0" })),
    ).toThrow(ESignWebhookError);
    // An open redirect is never produced.
    const evil = await provider.signingUrl("env-1", "sig-1", "//evil.example");
    expect(
      provider.verifySigningLink(new URL(evil, "http://x").searchParams)?.returnPath,
    ).toBe("/");
  });

  it("produces a real PDF the upload pipeline accepts", async () => {
    const bytes = await new MockESignProvider("secret").downloadSigned("env-1");
    expect(detectFileType(bytes)?.mime).toBe("application/pdf");
  });
});

describe("simple PDF writer", () => {
  it("writes a valid multi-page PDF and neutralises PDF syntax in text", () => {
    const lines = Array.from({ length: 120 }, (_, index) => ({
      text: `Line ${index} (with parentheses) \\ and £5 and emoji 🎉`,
    }));
    const pdf = Buffer.from(renderPdf(lines, { title: "Statement" })).toString("latin1");
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/Count 3");
    expect(pdf).toContain("\\(with parentheses\\)");
    expect(pdf).not.toContain("🎉");
    // xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
  });
});

describe("e-signature settings", () => {
  const base = { NODE_ENV: "development" } as NodeJS.ProcessEnv;

  it("defaults to the mock provider in test mode outside production", () => {
    const env = parseServerEnv(base);
    expect(env.ESIGN_PROVIDER).toBe("mock");
    expect(env.ESIGN_TEST_MODE).toBe(true);
  });

  it("needs keys for Dropbox Sign and refuses the mock or test mode in production", () => {
    expect(() => parseServerEnv({ ...base, ESIGN_PROVIDER: "dropbox_sign" })).toThrow(
      /ESIGN_API_KEY/,
    );
    expect(() =>
      parseServerEnv({
        ...base,
        ESIGN_PROVIDER: "dropbox_sign",
        ESIGN_API_KEY: "k",
        ESIGN_CLIENT_ID: "c",
      }),
    ).not.toThrow();
    const production = {
      NODE_ENV: "production",
      ESIGN_PROVIDER: "mock",
    } as unknown as NodeJS.ProcessEnv;
    expect(() => parseServerEnv(production)).toThrow(/mock e-signature provider/);
    expect(() =>
      parseServerEnv({
        NODE_ENV: "production",
        ESIGN_TEST_MODE: "true",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/test-mode signatures/);
  });
});
