import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
const seen = vi.hoisted(() => new Set<string>());
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return {
    ...actual,
    // Once per action and key, like the real hourly limit.
    consumeRateLimits: vi.fn(async (action: string, specs: { identifier: string }[]) => {
      if (!action.startsWith("ad_")) return true;
      const key = `${action}:${specs[0].identifier}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
});

import { Role } from "@/generated/prisma/enums";
import {
  createCampaign,
  decideApplication,
  liveDestination,
  pickAd,
  recordAdEvent,
  setCampaignStatus,
  submitApplication,
} from "@/services/ads/ads";

/**
 * Phase 6 Task 1 (migration 20261120020000, ADR-060) on the disposable
 * database: application → Admin approval → campaign draft → approval by an
 * Admin with ADVERTISER_MANAGEMENT (database-checked) → served only in its
 * slot while live → counted at most once per visitor per hour; ended
 * campaigns are fixed and nothing is deleted. No billing.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
});

afterAll(async () => {
  if (hasDb) await retirePeople(client);
  if (hasDb) await client.end();
});

const as = (p: Person) => ({ ...p, role: Role.ADMIN });

describe.skipIf(!hasDb)("advertising (Task 1)", () => {
  it("runs application → advertiser → approved campaign → served and counted", async () => {
    const manager = await person(client, "ADMIN", {
      adminPermissions: ["ADVERTISER_MANAGEMENT"],
    });
    const other = await person(client, "ADMIN", {
      adminPermissions: ["REVIEW_MODERATION"],
    });
    const applied = await submitApplication(
      {
        businessName: `Survey Co ${randomUUID().slice(0, 6)}`,
        category: "SURVEYOR",
        contactName: "Sam Surveyor",
        contactEmail: `survey-${randomUUID().slice(0, 8)}@example.com`,
        website: "https://survey.example.co.uk",
        preferredSlot: "AGENT_DASHBOARD",
        preferredFormat: "TEXT_CARD",
        message: "Building surveys for distressed property.",
      },
      `ip-${randomUUID()}`,
    );
    if (!applied.ok) throw new Error(applied.error);
    // Placement must be a designated slot.
    expect(
      await submitApplication(
        {
          businessName: "Bad Slot Ltd",
          category: "OTHER",
          contactName: "Bad Slot",
          contactEmail: "bad@example.com",
          preferredSlot: "SEARCH_RESULTS",
          preferredFormat: "TEXT_CARD",
        },
        `ip-${randomUUID()}`,
      ),
    ).toMatchObject({ ok: false, status: 400 });

    expect(await decideApplication(as(other), applied.id, true, "")).toMatchObject({
      ok: false,
      status: 403,
    });
    const decided = await decideApplication(as(manager), applied.id, true, "");
    if (!decided.ok || !decided.advertiserId) throw new Error("approval failed");

    const draft = {
      advertiserId: decided.advertiserId,
      slot: "AGENT_DASHBOARD",
      format: "TEXT_CARD",
      headline: "Independent RICS surveys",
      body: "Fixed-fee building surveys within five working days.",
      startsAt: new Date(Date.now() - 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    };
    expect(
      await createCampaign(as(manager), { ...draft, destinationUrl: "https://bit.ly/x" }),
    ).toMatchObject({ ok: false });
    expect(
      await createCampaign(as(manager), {
        ...draft,
        slot: "SEARCH_RESULTS",
        destinationUrl: "https://survey.example.co.uk",
      }),
    ).toMatchObject({ ok: false });
    const created = await createCampaign(as(manager), {
      ...draft,
      destinationUrl: "https://survey.example.co.uk/offer",
    });
    if (!created.ok) throw new Error(created.error);

    // A draft is never served; going live needs the advertiser permission.
    expect((await pickAd("AGENT_DASHBOARD"))?.id).not.toBe(created.id);
    expect(await setCampaignStatus(as(other), created.id, "ACTIVE")).toMatchObject({
      ok: false,
      status: 403,
    });
    await expect(
      client.query(
        `UPDATE public.ad_campaigns SET status = 'ACTIVE', "approvedBy" = $2, "approvedAt" = now() WHERE id = $1`,
        [created.id, other.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(
        `UPDATE public.ad_campaigns SET "destinationUrl" = 'javascript:alert(1)' WHERE id = $1`,
        [created.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(await setCampaignStatus(as(manager), created.id, "ACTIVE")).toEqual({
      ok: true,
    });

    // Served only in its slot (rotation may pick another live ad; ours is among them).
    const served = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const ad = await pickAd("AGENT_DASHBOARD");
      if (ad) served.add(ad.id);
      if (ad?.id === created.id) break;
      if (ad) await recordAdEvent(ad.id, "impression", `rotate-${i}`);
    }
    expect(served.has(created.id)).toBe(true);
    expect((await pickAd("LANDLORD_DASHBOARD"))?.id).not.toBe(created.id);
    expect(await liveDestination(created.id)).toMatchObject({
      url: "https://survey.example.co.uk/offer",
    });

    // Counted once per visitor per hour; aggregates only.
    expect(await recordAdEvent(created.id, "impression", "visitor-a")).toBe(true);
    expect(await recordAdEvent(created.id, "impression", "visitor-a")).toBe(false);
    expect(await recordAdEvent(created.id, "impression", "visitor-b")).toBe(true);
    expect(await recordAdEvent(created.id, "click", "visitor-a")).toBe(true);
    const { rows } = await client.query(
      `SELECT sum(impressions)::int AS i, sum(clicks)::int AS c FROM public.ad_daily_stats WHERE "campaignId" = $1`,
      [created.id],
    );
    expect(rows[0]).toEqual({ i: 2, c: 1 });

    // Ended: no longer served; fixed; never deleted.
    expect(await setCampaignStatus(as(manager), created.id, "ENDED")).toEqual({
      ok: true,
    });
    expect(await liveDestination(created.id)).toBeNull();
    await expect(
      client.query(`UPDATE public.ad_campaigns SET status = 'ACTIVE' WHERE id = $1`, [
        created.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(`DELETE FROM public.ad_campaigns WHERE id = $1`, [created.id]),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
