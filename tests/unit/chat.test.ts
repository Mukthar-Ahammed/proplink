import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  db: {
    chatThreadMessage: { findUnique: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@/services/chat/threads", () => ({ threadAccess: vi.fn() }));
vi.mock("@/services/auth/supabaseAuthService", () => ({ consumeRateLimits: vi.fn() }));
vi.mock("@/services/notifications/deliveries", () => ({ deliverOnce: vi.fn() }));
vi.mock("@/services/uploads/pipeline", () => ({ createGrantedDownloadLink: vi.fn() }));
vi.mock("@/services/email/mailer", () => ({ sendNewChatMessageEmail: vi.fn() }));
vi.mock("@/services/admin/audit", () => ({ writeAudit: vi.fn() }));

import { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { consumeRateLimits } from "@/services/auth/supabaseAuthService";
import {
  cleanBody,
  EMAIL_WINDOW_MINUTES,
  markRead,
  MAX_BODY,
  sendLimits,
  sendMessage,
} from "@/services/chat/messages";
import { threadAccess } from "@/services/chat/threads";

const mockDb = vi.mocked(db, true);
const VIEWER = { profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: Role.AGENT };
const THREAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  vi.resetAllMocks();
  mockDb.chatThreadMessage.findUnique.mockResolvedValue(null);
});

describe("chat message rules", () => {
  it("applies the business send limits: 20 a minute per thread, 200 an hour", () => {
    expect(sendLimits("p", "t")).toEqual([
      { kind: "user", identifier: "p:t", windowSeconds: 60, limit: 20 },
      { kind: "user", identifier: "p", windowSeconds: 3600, limit: 200 },
    ]);
  });

  it("keeps text as text: strips control and direction-override characters, keeps markup literally", () => {
    expect(cleanBody("  hi\u0000 there‮\r\nnext  ")).toBe("hi there\nnext");
    expect(cleanBody("<b>bold</b>")).toBe("<b>bold</b>");
    expect(cleanBody("a\n\n\n\n\n\nb")).toBe("a\n\n\nb");
    expect(cleanBody(42)).toBe("");
  });

  it("refuses a flood before touching the thread", async () => {
    vi.mocked(consumeRateLimits).mockResolvedValue(false);
    const result = await sendMessage(VIEWER, THREAD, {
      body: "hi",
      clientMessageId: "abcdefgh1234",
      attachmentIds: [],
    });
    expect(result).toMatchObject({ ok: false, status: 429 });
    expect(threadAccess).not.toHaveBeenCalled();
  });

  it("validates size, key and content before the rate limit", async () => {
    for (const raw of [
      { body: "x".repeat(MAX_BODY + 1), clientMessageId: "abcdefgh1234" },
      { body: "hi", clientMessageId: "short" },
      { body: "hi", clientMessageId: "has spaces in it" },
      { body: "   ", clientMessageId: "abcdefgh1234", attachmentIds: [] },
      {
        body: "hi",
        clientMessageId: "abcdefgh1234",
        attachmentIds: Array(6).fill(THREAD),
      },
    ]) {
      expect(await sendMessage(VIEWER, THREAD, raw)).toMatchObject({
        ok: false,
        status: 400,
      });
    }
    expect(consumeRateLimits).not.toHaveBeenCalled();
  });

  it.each([
    ["pending", 403],
    ["closed", 403],
    ["their_subscription", 403],
    ["your_subscription", 402],
  ] as const)("refuses to send when the thread is %s (%i)", async (blocked, status) => {
    vi.mocked(consumeRateLimits).mockResolvedValue(true);
    vi.mocked(threadAccess).mockResolvedValue({
      ok: true,
      canSend: false,
      canRead: true,
      blocked,
    } as never);
    const result = await sendMessage(VIEWER, THREAD, {
      body: "hi",
      clientMessageId: "abcdefgh1234",
      attachmentIds: [],
    });
    expect(result).toMatchObject({ ok: false, status });
  });

  it("marks only the other person's unread messages as read", async () => {
    vi.mocked(threadAccess).mockResolvedValue({ ok: true, canRead: true } as never);
    mockDb.chatThreadMessage.updateMany.mockResolvedValue({ count: 0 });
    expect(await markRead(VIEWER, THREAD)).toEqual({ ok: true, marked: 0 });
    expect(mockDb.chatThreadMessage.updateMany.mock.calls[0][0].where).toEqual({
      threadId: THREAD,
      senderId: { not: VIEWER.profileId },
      readAt: null,
    });
  });

  it("emails at most once per thread per recipient per window", () => {
    expect(EMAIL_WINDOW_MINUTES).toBeGreaterThanOrEqual(5);
  });
});
