import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clearOutbox,
  isDevOutboxEnabled,
  readOutbox,
  saveToOutbox,
} from "@/services/email/devOutbox";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "outbox-"));
  file = path.join(dir, "outbox.json");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

describe("temporary dev mail inbox", () => {
  it("is on only in development with the mock mailer", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_PROVIDER", "mock");
    expect(isDevOutboxEnabled()).toBe(true);
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(isDevOutboxEnabled()).toBe(false);
    vi.stubEnv("EMAIL_PROVIDER", "mock");
    vi.stubEnv("NODE_ENV", "test");
    expect(isDevOutboxEnabled()).toBe(false);
  });

  it("keeps the newest 100 emails, newest first, and can be cleared", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_PROVIDER", "mock");
    for (let i = 0; i < 102; i += 1) {
      await saveToOutbox({ to: "a@example.test", subject: `Mail ${i}`, text: "t" }, file);
    }
    const mails = await readOutbox(file);
    expect(mails).toHaveLength(100);
    expect(mails[0].subject).toBe("Mail 101");
    await clearOutbox(file);
    await expect(readOutbox(file)).resolves.toEqual([]);
  });

  it("stores nothing when disabled", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await saveToOutbox({ to: "a@example.test", subject: "x", text: "y" }, file);
    await expect(readOutbox(file)).resolves.toEqual([]);
  });
});
