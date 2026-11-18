import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockDb = vi.hoisted(() => ({
  review: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  reviewReport: { count: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: mockDb }));

import { Role } from "@/generated/prisma/enums";
import {
  moderateReview,
  replyToReview,
  reportReview,
  REPORTS_PER_DAY,
  REVIEWS_PER_DAY,
  submitReview,
} from "@/services/reviews/reviews";

/** Phase 5 Task 4 (ADR-054): validation, sanitising and per-day limits. */
const investor = {
  profileId: "11111111-1111-4111-8111-111111111111",
  legacyUserId: "u-1",
  role: Role.INVESTOR,
};
const input = {
  contextType: "PROJECT",
  contextId: "22222222-2222-4222-8222-222222222222",
  subjectId: "33333333-3333-4333-8333-333333333333",
  rating: "4",
  body: "Good communication throughout the project.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.review.count.mockResolvedValue(0);
  mockDb.reviewReport.count.mockResolvedValue(0);
});

describe("submitReview", () => {
  it("refuses once the day's limit is reached, before writing", async () => {
    mockDb.review.count.mockResolvedValue(REVIEWS_PER_DAY);
    expect(await submitReview(investor, input)).toMatchObject({ ok: false, status: 429 });
    expect(mockDb.review.create).not.toHaveBeenCalled();
  });

  it("validates stars and length after sanitising", async () => {
    expect(await submitReview(investor, { ...input, rating: "6" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await submitReview(investor, { ...input, body: "\u200b\u200b short \u202e" }),
    ).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await submitReview(investor, { ...input, body: "x".repeat(2001) }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(mockDb.review.create).not.toHaveBeenCalled();
  });

  it("writes a sanitised, pending review", async () => {
    mockDb.review.create.mockResolvedValue({});
    const result = await submitReview(investor, {
      ...input,
      body: "  Good\u202e communication\u0007 throughout.  ",
    });
    expect(result).toMatchObject({ ok: true });
    const data = mockDb.review.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      reviewerId: investor.profileId,
      rating: 4,
      body: "Good communication throughout.",
    });
    expect(data.status).toBeUndefined();
  });

  it("maps database refusals", async () => {
    mockDb.review.create.mockRejectedValueOnce({ code: "23514" });
    expect(await submitReview(investor, input)).toMatchObject({ ok: false, status: 403 });
    mockDb.review.create.mockRejectedValueOnce({ code: "23505" });
    expect(await submitReview(investor, input)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("reports, replies and moderation", () => {
  it("limits reports per day", async () => {
    mockDb.reviewReport.count.mockResolvedValue(REPORTS_PER_DAY);
    expect(await reportReview(investor, "r-1", "Unfair remarks")).toMatchObject({
      ok: false,
      status: 429,
    });
    expect(mockDb.reviewReport.create).not.toHaveBeenCalled();
  });

  it("replies only as the subject of a published review without a reply", async () => {
    mockDb.review.updateMany.mockResolvedValue({ count: 1 });
    expect(await replyToReview(investor, "r-1", "Thank you.")).toEqual({ ok: true });
    expect(mockDb.review.updateMany.mock.calls[0][0].where).toEqual({
      id: "r-1",
      subjectId: investor.profileId,
      status: "PUBLISHED",
      reply: null,
    });
  });

  it("is Admin-only", async () => {
    expect(await moderateReview(investor, "r-1", "publish")).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(mockDb.review.updateMany).not.toHaveBeenCalled();
  });
});
