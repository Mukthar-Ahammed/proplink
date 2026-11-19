import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { getServerEnv } from "@/env";

/**
 * TEMPORARY development mail inbox (until Resend is configured; BLOCKERS).
 * While the mock mailer is active, every email the app sends is kept here so
 * it can be read at /dev/mail, newest first, last 100 emails.
 *
 * - Development: stored on the local machine under `.data/` (git-ignored).
 * - Hosted demo (ADR-076): stored in the `demo_mail_outbox` table, because
 *   serverless functions share no disk. The page is Admin-only there.
 *
 * Never active in production or staging: the env schema requires Resend there.
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
  return (
    (env.NODE_ENV === "development" || env.DEMO_MODE) && env.EMAIL_PROVIDER === "mock"
  );
}

/** The demo keeps its inbox in the database; development uses a local file. */
function usesDatabase(file: string): boolean {
  return file === OUTBOX_FILE && getServerEnv().DEMO_MODE;
}

async function demoDb() {
  return (await import("@/lib/db")).db;
}

export async function readOutbox(file = OUTBOX_FILE): Promise<OutboxMail[]> {
  if (usesDatabase(file)) {
    const db = await demoDb();
    const rows = await db.demoMailOutbox.findMany({
      orderBy: { sentAt: "desc" },
      take: MAX_MAILS,
    });
    return rows.map((row) => ({ ...row, sentAt: row.sentAt.toISOString() }));
  }
  try {
    const parsed: unknown = JSON.parse(
      await readFile(/*turbopackIgnore: true*/ file, "utf8"),
    );
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
  if (usesDatabase(file)) {
    const db = await demoDb();
    await db.demoMailOutbox.create({
      data: { id: randomUUID(), to: mail.to, subject: mail.subject, text: mail.text },
    });
    // Keep the newest MAX_MAILS only.
    const stale = await db.demoMailOutbox.findMany({
      orderBy: { sentAt: "desc" },
      skip: MAX_MAILS,
      select: { id: true },
    });
    if (stale.length) {
      await db.demoMailOutbox.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
    }
    return;
  }
  const existing = await readOutbox(file);
  const entry: OutboxMail = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    sentAt: new Date().toISOString(),
  };
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  await writeFile(
    /*turbopackIgnore: true*/ file,
    JSON.stringify([entry, ...existing].slice(0, MAX_MAILS), null, 2),
  );
}

export async function clearOutbox(file = OUTBOX_FILE): Promise<void> {
  if (!isDevOutboxEnabled()) return;
  if (usesDatabase(file)) {
    const db = await demoDb();
    await db.demoMailOutbox.deleteMany({});
    return;
  }
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ file, "[]");
}
