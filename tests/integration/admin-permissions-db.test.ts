import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { person, retirePeople, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));

import { Role } from "@/generated/prisma/enums";
import {
  adminPermissionsOf,
  cancelPermissionChange,
  decidePermissionChange,
  hasAdminPermission,
  requestPermissionChange,
} from "@/services/admin/permissions";

/**
 * Phase 6 Task 2 exit gate (migration 20261120000000, ADR-058): maker-checker
 * cannot be bypassed. A super-admin asks, a different super-admin decides;
 * grants and revocations exist only through approved requests; the last
 * super-admin cannot be removed. The database refuses every shortcut.
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

describe.skipIf(!hasDb)("Admin permissions: maker-checker (Task 2)", () => {
  it("grants only with a second super-admin's approval", async () => {
    const maker = await person(client, "ADMIN");
    const checker = await person(client, "ADMIN");
    const target = await person(client, "ADMIN", { adminPermissions: [] });
    const plain = await person(client, "ADMIN", {
      adminPermissions: ["REVIEW_MODERATION"],
    });

    expect(await hasAdminPermission(target.profileId, "VERIFICATION")).toBe(false);
    // Only super-admins ask.
    expect(
      await requestPermissionChange(as(plain), {
        targetId: target.profileId,
        permission: "VERIFICATION",
        action: "GRANT",
        reason: "Joins the KYC team",
      }),
    ).toMatchObject({ ok: false, status: 403 });
    const asked = await requestPermissionChange(as(maker), {
      targetId: target.profileId,
      permission: "VERIFICATION",
      action: "GRANT",
      reason: "Joins the KYC team",
    });
    if (!asked.ok || !asked.id) throw new Error("request failed");
    // The maker cannot approve their own request, by the service or the database.
    expect(await decidePermissionChange(as(maker), asked.id, true)).toMatchObject({
      ok: false,
      status: 403,
    });
    await expect(
      client.query(
        `UPDATE public.admin_grant_requests SET status = 'APPROVED', "decidedBy" = $2, "decidedAt" = now() WHERE id = $1`,
        [asked.id, maker.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // A non-super-admin cannot decide either.
    await expect(
      client.query(
        `UPDATE public.admin_grant_requests SET status = 'APPROVED', "decidedBy" = $2, "decidedAt" = now() WHERE id = $1`,
        [asked.id, plain.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    // Nobody inserts a grant without an approved request.
    await expect(
      client.query(
        `INSERT INTO public.admin_permission_grants (id, "profileId", permission, "requestId") VALUES ($1, $2, 'VERIFICATION', $3)`,
        [randomUUID(), target.profileId, asked.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(
        `INSERT INTO public.admin_permission_grants (id, "profileId", permission) VALUES ($1, $2, 'SUPER_ADMIN')`,
        [randomUUID(), target.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });

    expect(await decidePermissionChange(as(checker), asked.id, true)).toEqual({
      ok: true,
    });
    expect([...(await adminPermissionsOf(target.profileId))]).toEqual(["VERIFICATION"]);
    // Decided requests are fixed; grants are never deleted.
    expect(await decidePermissionChange(as(checker), asked.id, false)).toMatchObject({
      ok: false,
      status: 409,
    });
    await expect(
      client.query(`DELETE FROM public.admin_permission_grants WHERE "profileId" = $1`, [
        target.profileId,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    // Revoking needs an approved request too.
    await expect(
      client.query(
        `UPDATE public.admin_permission_grants SET "revokedAt" = now(), "revokeRequestId" = $2 WHERE "profileId" = $1`,
        [target.profileId, asked.id],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    const revoke = await requestPermissionChange(as(checker), {
      targetId: target.profileId,
      permission: "VERIFICATION",
      action: "REVOKE",
      reason: "Left the KYC team",
    });
    if (!revoke.ok || !revoke.id) throw new Error("revoke request failed");
    expect(await decidePermissionChange(as(maker), revoke.id, true)).toEqual({
      ok: true,
    });
    expect(await hasAdminPermission(target.profileId, "VERIFICATION")).toBe(false);

    // The requester may cancel their own waiting request; nobody else.
    const again = await requestPermissionChange(as(maker), {
      targetId: target.profileId,
      permission: "SUSPENSION",
      action: "GRANT",
      reason: "Covers support rota",
    });
    if (!again.ok || !again.id) throw new Error("request failed");
    expect(await cancelPermissionChange(as(checker), again.id)).toMatchObject({
      ok: false,
    });
    expect(await cancelPermissionChange(as(maker), again.id)).toEqual({ ok: true });
  });

  it("never lets the last super-admin be revoked", async () => {
    const keeper = await person(client, "ADMIN");
    await client.query("BEGIN");
    try {
      // Test-only setup (superuser): leave exactly one active super-admin and
      // an approved revoke request for them.
      await client.query("SET LOCAL session_replication_role = replica");
      const requestId = randomUUID();
      await client.query(
        `INSERT INTO public.admin_grant_requests (id, "targetId", permission, action, reason, status, "requestedBy", "decidedBy", "decidedAt")
         VALUES ($1, $2, 'SUPER_ADMIN', 'REVOKE', 'Last one out', 'APPROVED', $2, $3, now())`,
        [requestId, keeper.profileId, randomUUID()],
      );
      await client.query(
        `UPDATE public.admin_permission_grants SET "revokedAt" = now(), "revokeRequestId" = $2
         WHERE permission = 'SUPER_ADMIN' AND "revokedAt" IS NULL AND "profileId" <> $1`,
        [keeper.profileId, requestId],
      );
      await client.query("SET LOCAL session_replication_role = origin");
      await expect(
        client.query(
          `UPDATE public.admin_permission_grants SET "revokedAt" = now(), "revokeRequestId" = $2
           WHERE "profileId" = $1 AND permission = 'SUPER_ADMIN'`,
          [keeper.profileId, requestId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
    }
  });
});
