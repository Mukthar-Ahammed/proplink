import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import { GET } from "@/app/api/health/route";
import { deliveryHealth } from "@/services/admin/deliveryHealth";
import { checkHealth } from "@/services/metrics/health";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    notificationDelivery: { count: vi.fn() },
    savedSearchAlert: { count: vi.fn() },
    billingWebhookEvent: { count: vi.fn(), findFirst: vi.fn() },
    kycWebhookEvent: { count: vi.fn(), findFirst: vi.fn() },
    eSignWebhookEvent: { count: vi.fn(), findFirst: vi.fn() },
  },
}));

const mockDb = vi.mocked(db, true);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("health check (Phase 7 Task 5)", () => {
  it("is ok when the database answers", async () => {
    mockDb.$queryRaw.mockResolvedValue([{ "?column?": 1 }] as never);
    const report = await checkHealth();
    expect(report.status).toBe("ok");
    expect(report.checks.database.ok).toBe(true);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns 503 without error details when the database fails", async () => {
    mockDb.$queryRaw.mockRejectedValue(
      new Error("connect ECONNREFUSED db.internal:5432"),
    );
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("unavailable");
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(body)).not.toContain("db.internal");
  });

  it("gives up on a database that hangs", async () => {
    vi.useFakeTimers();
    mockDb.$queryRaw.mockReturnValue(new Promise(() => {}) as never);
    const pending = checkHealth();
    await vi.advanceTimersByTimeAsync(2_100);
    const report = await pending;
    vi.useRealTimers();
    expect(report.status).toBe("unavailable");
  });
});

describe("deliveries and webhooks (Phase 7 Task 5)", () => {
  it("flags failed and stuck deliveries and reports webhook recency", async () => {
    const now = new Date("2026-11-19T12:00:00Z");
    // Order: failed, sent, stuck emails; failed, stuck alerts.
    mockDb.notificationDelivery.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(0);
    mockDb.savedSearchAlert.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);
    mockDb.billingWebhookEvent.count.mockResolvedValue(5);
    mockDb.billingWebhookEvent.findFirst.mockResolvedValue({
      receivedAt: new Date("2026-11-19T11:30:00Z"),
    } as never);
    mockDb.kycWebhookEvent.count.mockResolvedValue(0);
    mockDb.kycWebhookEvent.findFirst.mockResolvedValue(null);
    mockDb.eSignWebhookEvent.count.mockResolvedValue(0);
    mockDb.eSignWebhookEvent.findFirst.mockResolvedValue(null);

    const { deliveries, webhooks } = await deliveryHealth(now);
    const flagged = deliveries.filter((d) => d.attention).map((d) => d.name);
    expect(flagged).toEqual([
      "Emails failed (24 h)",
      "Saved-search alerts queued over 26 h",
    ]);
    expect(webhooks[0]).toEqual({
      provider: "Stripe (subscriptions)",
      last24h: 5,
      minutesAgo: 30,
    });
    expect(webhooks[1].minutesAgo).toBeNull();
  });
});
