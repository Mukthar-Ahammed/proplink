import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { Role, SavedSearchAlertStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { sendSavedSearchAlertEmail } from "@/services/email/mailer";
import {
  buildSearchQueryString,
  parseSearchParams,
  searchService,
} from "@/services/search";

/**
 * Saved searches and email alerts (Phase 5 Task 3, ADR-056). Buyers save the
 * search they are looking at; with alerts on, a scheduled job queues at most
 * one alert per search per day listing newly published matches, then sends
 * them within a per-person daily limit. Every email carries an unsubscribe
 * link (a random token per search) that works without signing in.
 */

export const MAX_SAVED_SEARCHES = 20;
export const MAX_ALERTING_SEARCHES = 5;
export const MAX_ALERT_EMAILS_PER_DAY = 3;
const LISTINGS_PER_ALERT = 10;
const BATCH = 200;

type Buyer = { userId: string; role: Role };
type Result<T = object> =
  ({ ok: true } & T) | { ok: false; error: string; status: number };
const bad = (error: string, status = 400) => ({ ok: false as const, error, status });

function canonicalQuery(raw: string): string {
  const params = parseSearchParams(new URLSearchParams(raw));
  delete params.page;
  delete params.pageSize;
  return buildSearchQueryString(params);
}

function queryOf(paramsJson: Prisma.JsonValue): string {
  const value = paramsJson as { query?: unknown } | null;
  return typeof value?.query === "string" ? value.query : "";
}

export async function saveSearch(
  buyer: Buyer,
  input: { name: string; query: string },
): Promise<Result<{ id: string }>> {
  if (buyer.role !== Role.BUYER) return bad("Saved searches are for Buyer accounts", 403);
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) return bad("Give the search a name");
  const query = canonicalQuery(input.query.replace(/^\?/, ""));
  const count = await db.savedSearch.count({ where: { userId: buyer.userId } });
  if (count >= MAX_SAVED_SEARCHES) {
    return bad(`You can keep up to ${MAX_SAVED_SEARCHES} saved searches`, 409);
  }
  const saved = await db.savedSearch.create({
    data: { userId: buyer.userId, name, paramsJson: { query } },
    select: { id: true },
  });
  return { ok: true, id: saved.id };
}

export async function listSavedSearches(buyer: Buyer) {
  const rows = await db.savedSearch.findMany({
    where: { userId: buyer.userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      paramsJson: true,
      alertsEnabled: true,
      lastAlertAt: true,
    },
  });
  return rows.map((row) => ({ ...row, query: queryOf(row.paramsJson) }));
}

export async function deleteSavedSearch(buyer: Buyer, id: string): Promise<Result> {
  const removed = await db.savedSearch.deleteMany({
    where: { id, userId: buyer.userId },
  });
  return removed.count === 1 ? { ok: true } : bad("Saved search not found", 404);
}

export async function setSearchAlerts(
  buyer: Buyer,
  id: string,
  on: boolean,
): Promise<Result> {
  const search = await db.savedSearch.findFirst({
    where: { id, userId: buyer.userId },
    select: { alertsEnabled: true, alertToken: true },
  });
  if (!search) return bad("Saved search not found", 404);
  if (on && !search.alertsEnabled) {
    const alerting = await db.savedSearch.count({
      where: { userId: buyer.userId, alertsEnabled: true },
    });
    if (alerting >= MAX_ALERTING_SEARCHES) {
      return bad(`Alerts can be on for up to ${MAX_ALERTING_SEARCHES} searches`, 409);
    }
  }
  await db.savedSearch.update({
    where: { id },
    data: {
      alertsEnabled: on,
      // Alerts start from now: no flood of everything already listed.
      ...(on && !search.alertsEnabled ? { lastAlertAt: new Date() } : {}),
      ...(on && !search.alertToken
        ? { alertToken: randomBytes(24).toString("base64url") }
        : {}),
    },
  });
  return { ok: true };
}

/** One-click from the email: no sign-in, the random token identifies the search. */
export async function unsubscribeByToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const search = await db.savedSearch.findUnique({
    where: { alertToken: token },
    select: { id: true, name: true },
  });
  if (!search) return null;
  await db.savedSearch.update({
    where: { id: search.id },
    data: { alertsEnabled: false },
  });
  return search.name;
}

export async function searchNameForToken(token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const search = await db.savedSearch.findUnique({
    where: { alertToken: token },
    select: { name: true, alertsEnabled: true },
  });
  return search ? search.name : null;
}

const dayOf = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

/**
 * Step 1: queue. For each alerting search, the listings published since the
 * last alert; at most one queued alert per search per day (unique index).
 */
export async function queueSavedSearchAlerts(now = new Date()): Promise<number> {
  let queued = 0;
  let cursor: string | undefined;
  for (;;) {
    const searches = await db.savedSearch.findMany({
      where: { alertsEnabled: true, user: { active: true, role: Role.BUYER } },
      select: {
        id: true,
        userId: true,
        paramsJson: true,
        lastAlertAt: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (searches.length === 0) break;
    cursor = searches[searches.length - 1].id;
    for (const search of searches) {
      const since = search.lastAlertAt ?? search.createdAt;
      const params = parseSearchParams(new URLSearchParams(queryOf(search.paramsJson)));
      const results = await searchService.search({
        ...params,
        sort: "newest",
        page: 1,
        pageSize: 50,
      });
      const fresh = results.items
        .filter(
          (item) =>
            item.publishedAt && item.publishedAt > since && item.publishedAt <= now,
        )
        .slice(0, LISTINGS_PER_ALERT)
        .map((item) => item.id);
      if (fresh.length === 0) continue;
      try {
        await db.$transaction([
          db.savedSearchAlert.create({
            data: {
              id: randomUUID(),
              savedSearchId: search.id,
              userId: search.userId,
              windowDay: dayOf(now),
              listingIds: fresh,
            },
          }),
          db.savedSearch.update({ where: { id: search.id }, data: { lastAlertAt: now } }),
        ]);
        queued += 1;
      } catch (error) {
        // Already alerted today: the next run picks the listings up.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }
    if (searches.length < BATCH) break;
  }
  return queued;
}

/** Step 2: send queued alerts within each person's daily limit. */
export async function deliverSavedSearchAlerts(now = new Date()) {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  const queued = await db.savedSearchAlert.findMany({
    where: { status: SavedSearchAlertStatus.QUEUED },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      id: true,
      userId: true,
      listingIds: true,
      user: { select: { email: true, active: true } },
      savedSearch: { select: { name: true, alertToken: true, alertsEnabled: true } },
    },
  });
  const sentToday = new Map<string, number>();
  for (const alert of queued) {
    if (!sentToday.has(alert.userId)) {
      sentToday.set(
        alert.userId,
        await db.savedSearchAlert.count({
          where: {
            userId: alert.userId,
            status: SavedSearchAlertStatus.SENT,
            sentAt: { gte: dayOf(now) },
          },
        }),
      );
    }
    const already = sentToday.get(alert.userId) ?? 0;
    const listings = await db.property.findMany({
      where: { id: { in: alert.listingIds }, status: { in: ["LIVE", "UNDER_OFFER"] } },
      select: { id: true, title: true, city: true },
    });
    const skip =
      already >= MAX_ALERT_EMAILS_PER_DAY ||
      !alert.user.active ||
      !alert.savedSearch.alertsEnabled ||
      !alert.savedSearch.alertToken ||
      listings.length === 0;
    if (skip) {
      await db.savedSearchAlert.update({
        where: { id: alert.id },
        data: { status: SavedSearchAlertStatus.SKIPPED },
      });
      counts.skipped += 1;
      continue;
    }
    try {
      await sendSavedSearchAlertEmail({
        to: alert.user.email,
        searchName: alert.savedSearch.name,
        listings,
        unsubscribeToken: alert.savedSearch.alertToken!,
      });
      await db.savedSearchAlert.update({
        where: { id: alert.id },
        data: { status: SavedSearchAlertStatus.SENT, sentAt: now },
      });
      sentToday.set(alert.userId, already + 1);
      counts.sent += 1;
    } catch {
      await db.savedSearchAlert.update({
        where: { id: alert.id },
        data: { status: SavedSearchAlertStatus.FAILED },
      });
      counts.failed += 1;
    }
  }
  return counts;
}

export async function runSavedSearchAlerts(now = new Date()) {
  const queued = await queueSavedSearchAlerts(now);
  const delivered = await deliverSavedSearchAlerts(now);
  return { queued, ...delivered };
}
