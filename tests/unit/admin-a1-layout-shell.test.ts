import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@/generated/prisma/enums";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  headers: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => mocks.headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    mocks.redirect(destination);
    throw new Error(`redirect:${destination}`);
  },
  usePathname: () => "/admin",
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/app/(auth)/actions", () => ({ logoutAction: vi.fn() }));

import AdminLayout from "@/app/admin/layout";
import { mapStatusToTone } from "@/components/admin/StatusBadge";

function sessionFor(role: Role, active = true) {
  return {
    user: {
      id: "test-user-id",
      email: "test@proplink.test",
      name: "Test Admin",
      role,
      active,
    },
  };
}

describe("Phase A1 — Secure Admin Shell & Layout Gate (SEC-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows /admin/login to render without requiring authentication or session redirect", async () => {
    mocks.headers.mockReturnValue(new Headers({ "x-pathname": "/admin/login" }));
    mocks.auth.mockResolvedValue(null);

    const result = await AdminLayout({ children: "Login Form" });
    expect(result).toBeDefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("redirects anonymous visitor accessing /admin to /admin/login (Fail Closed)", async () => {
    mocks.headers.mockReturnValue(new Headers({ "x-pathname": "/admin" }));
    mocks.auth.mockResolvedValue(null);

    await expect(AdminLayout({ children: "Protected Page" })).rejects.toThrow(
      "redirect:/admin/login",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/login");
  });

  it.each([Role.BUYER, Role.AGENT, Role.INVESTOR])(
    "redirects non-admin role %s accessing protected admin routes to /admin/login",
    async (role) => {
      mocks.headers.mockReturnValue(new Headers({ "x-pathname": "/admin/kyc" }));
      mocks.auth.mockResolvedValue(sessionFor(role));

      await expect(AdminLayout({ children: "Protected KYC Page" })).rejects.toThrow(
        "redirect:/admin/login",
      );
      expect(mocks.redirect).toHaveBeenCalledWith("/admin/login");
    },
  );

  it("redirects inactive ADMIN accessing protected routes to /admin/login", async () => {
    mocks.headers.mockReturnValue(new Headers({ "x-pathname": "/admin/moderation" }));
    mocks.auth.mockResolvedValue(sessionFor(Role.ADMIN, false));

    await expect(AdminLayout({ children: "Protected Moderation" })).rejects.toThrow(
      "redirect:/admin/login",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("allows active ADMIN user accessing /admin to render inside AdminShell", async () => {
    mocks.headers.mockReturnValue(new Headers({ "x-pathname": "/admin" }));
    mocks.auth.mockResolvedValue(sessionFor(Role.ADMIN, true));

    const result = await AdminLayout({ children: "Admin Content" });
    expect(result).toBeDefined();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  describe("StatusBadge Tone Mapping", () => {
    it("maps APPROVED, LIVE, COMPLETED, ACTIVE to success tone", () => {
      expect(mapStatusToTone("APPROVED")).toBe("success");
      expect(mapStatusToTone("LIVE")).toBe("success");
      expect(mapStatusToTone("COMPLETED")).toBe("success");
      expect(mapStatusToTone("ACTIVE")).toBe("success");
    });

    it("maps PENDING, PENDING_REVIEW, SUBMITTED to warning tone", () => {
      expect(mapStatusToTone("PENDING")).toBe("warning");
      expect(mapStatusToTone("PENDING_REVIEW")).toBe("warning");
      expect(mapStatusToTone("SUBMITTED")).toBe("warning");
    });

    it("maps REJECTED, DEACTIVATED, SUSPENDED to danger tone", () => {
      expect(mapStatusToTone("REJECTED")).toBe("danger");
      expect(mapStatusToTone("DEACTIVATED")).toBe("danger");
      expect(mapStatusToTone("SUSPENDED")).toBe("danger");
    });

    it("maps DRAFT, NOT_STARTED, PLANNING to neutral tone", () => {
      expect(mapStatusToTone("DRAFT")).toBe("neutral");
      expect(mapStatusToTone("NOT_STARTED")).toBe("neutral");
    });
  });
});
