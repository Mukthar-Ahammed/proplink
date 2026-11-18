import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getServerEnv } from "@/env";

/**
 * TEMPORARY development mail inbox (until Resend is configured; BLOCKERS).
 * While the mock mailer is active outside production, every email the app
 * sends is kept here so it can be read at /dev/mail. Stored only on the local
 * machine under `.data/` (git-ignored), newest first, last 100 emails.
 * Never active in production: the env schema requires Resend there.
 */

export type OutboxMail = {
  id: string;
  to: string;
  subject: string;
  text: string;
  sentAt: string;
};

const MAX_MAILS = 100;
const OUTBOX_FILE = path.join(process.cwd(), ".data", "dev-mail", "outbox.json");

export function isDevOutboxEnabled(): boolean {
  const env = getServerEnv();
  return env.NODE_ENV === "development" && env.EMAIL_PROVIDER === "mock";
}

export async function readOutbox(file = OUTBOX_FILE): Promise<OutboxMail[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(parsed) ? (parsed as OutboxMail[]) : [];
  } catch {
    return [];
  }
}

export async function saveToOutbox(
  mail: { to: string; subject: string; text: string },
  file = OUTBOX_FILE,
): Promise<void> {
  if (!isDevOutboxEnabled()) return;
  const existing = await readOutbox(file);
  const entry: OutboxMail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    sentAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify([entry, ...existing].slice(0, MAX_MAILS), null, 2),
  );
}

export async function clearOutbox(file = OUTBOX_FILE): Promise<void> {
  if (!isDevOutboxEnabled()) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "[]");
}
