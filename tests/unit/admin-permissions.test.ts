import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ held: [] as string[] }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: "legacy-admin",
      authUserId: "11111111-1111-4111-8111-111111111111",
      role: "ADMIN",
      active: true,
      mfaVerifiedAt: new Date(),
    },
  })),
}));
vi.mock("@/services/auth/mfa", () => ({
  requiresMfa: () => true,
  isMfaSatisfied: async () => true,
}));
vi.mock("@/lib/db", () => ({
  db: {
    adminPermissionGrant: {
      findMany: vi.fn(async () => state.held.map((permission) => ({ permission }))),
    },
    auditLog: { create: vi.fn(async () => ({})) },
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

import { requireAdminPagePermission, requireAdminPermission } from "@/lib/authz";
import { mayOpenAdminPath, permissionForAdminPath } from "@/lib/authz/adminRoutes";
import { ALL_ADMIN_PERMISSIONS } from "@/services/admin/permissions";

/**
 * Phase 6 Task 2 exit gate (ADR-058): the permission matrix per Admin role.
 * An Admin holding exactly one permission passes only that permission's
 * checks; a super-admin passes all; an Admin with none passes none. Every
 * Admin page, action and API names the permission of its area.
 */
const ROOT = path.resolve(__dirname, "../..");
const ORDINARY = ALL_ADMIN_PERMISSIONS.filter((p) => p !== "SUPER_ADMIN");

beforeEach(() => {
  state.held = [];
});

describe("per-permission matrix", () => {
  it.each(ORDINARY)("an Admin holding only %s", async (held) => {
    state.held = [held];
    for (const needed of ALL_ADMIN_PERMISSIONS) {
      const result = await requireAdminPermission(needed);
      expect(result.ok, `${held} → ${needed}`).toBe(needed === held);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  });

  it("a super-admin passes every check", async () => {
    state.held = ["SUPER_ADMIN"];
    for (const needed of ALL_ADMIN_PERMISSIONS) {
      expect((await requireAdminPermission(needed)).ok).toBe(true);
    }
  });

  it("an Admin with no permissions passes none, and pages send them home", async () => {
    for (const needed of ALL_ADMIN_PERMISSIONS) {
      expect((await requireAdminPermission(needed)).ok).toBe(false);
    }
    await expect(requireAdminPagePermission("REVIEW_MODERATION")).rejects.toThrow(
      "redirect:/admin?denied=REVIEW_MODERATION",
    );
  });

  it("hides sidebar links by the same map", () => {
    expect(mayOpenAdminPath(["REVIEW_MODERATION"], "/admin/reviews")).toBe(true);
    expect(mayOpenAdminPath(["REVIEW_MODERATION"], "/admin/kyc")).toBe(false);
    expect(mayOpenAdminPath([], "/admin")).toBe(true);
    expect(mayOpenAdminPath(["SUPER_ADMIN"], "/admin/roles")).toBe(true);
    expect(permissionForAdminPath("/admin/unknown-area")).toBe("SUPER_ADMIN");
  });
});

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory()
      ? files(full)
      : /\.(ts|tsx)$/.test(name)
        ? [full]
        : [];
  });
}

describe("every Admin entry point checks its area's permission", () => {
  const entries = [
    ...files(path.join(ROOT, "src/app/admin")),
    ...files(path.join(ROOT, "src/app/api/admin")),
  ]
    .map((full) => ({
      rel: path.relative(ROOT, full).split(path.sep).join("/"),
      text: readFileSync(full, "utf8"),
    }))
    .filter(
      ({ rel, text }) =>
        /\/(page\.tsx|route\.ts)$/.test(rel) || /^["']use server["']/.test(text),
    )
    .filter(
      ({ rel }) =>
        !rel.startsWith("src/app/admin/login/") && rel !== "src/app/admin/page.tsx",
    );

  it("found the Admin entry points", () => {
    expect(entries.length).toBeGreaterThan(50);
  });

  it.each(entries.map((e) => [e.rel, e.text] as const))("%s", (rel, text) => {
    expect(text, "bare Admin role check").not.toMatch(
      /require(?:Page)?Role\((?:Role\.ADMIN|"ADMIN")\)/,
    );
    const used = [
      ...text.matchAll(/requireAdmin(?:Page)?Permission\(\s*"([A-Z_]+)"/g),
      ...text.matchAll(/adminActor\(\s*"([A-Z_]+)"/g),
    ].map((m) => m[1]);
    // The projects actions' adminActor() defaults to PROJECT_OVERSIGHT.
    if (rel === "src/app/admin/projects/actions.ts") used.push("PROJECT_OVERSIGHT");
    expect(used.length, "no permission check").toBeGreaterThan(0);
    const area = `/${rel
      .replace(/^src\/app\/(api\/)?/, "")
      .replace(/\/(page\.tsx|route\.ts|actions\.ts)$/, "")
      .replace(/\/\[[^\]]+\]/g, "")}`;
    const expected = permissionForAdminPath(area);
    const allowedExtra =
      rel === "src/app/admin/projects/actions.ts" ? ["SOLICITOR_MANAGEMENT"] : [];
    for (const permission of used) {
      expect([expected, ...allowedExtra], `${rel} uses ${permission}`).toContain(
        permission,
      );
    }
  });
});
