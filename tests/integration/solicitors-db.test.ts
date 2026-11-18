import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { mandateChain, person, TERMS, type Person } from "../helpers/project-fixtures";
import { assertSafeIntegrationDatabase } from "../helpers/test-database-safety";

vi.mock("server-only", () => ({}));
vi.mock("@/services/auth/supabaseAuthService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/auth/supabaseAuthService")>();
  return {
    ...actual,
    consumeRateLimits: vi.fn().mockResolvedValue(true),
    appOrigin: () => "http://localhost:3000",
  };
});
vi.mock("@/services/email/mailer", () => ({
  sendProjectEmail: vi.fn().mockResolvedValue(undefined),
  sendSolicitorInviteEmail: vi.fn().mockResolvedValue(undefined),
  isMockMailer: () => true,
}));

import { Role } from "@/generated/prisma/enums";
import { sendSolicitorInviteEmail } from "@/services/email/mailer";
import { setAgentAccountProvisionerForTests } from "@/services/auth/agentAccountProvisioner";
import {
  decideNomination,
  nominateLead,
  respondToNomination,
} from "@/services/projects/lead";
import { createPledge, listProjectPledges } from "@/services/projects/pledges";
import { expressInterest, publishProject } from "@/services/projects/projects";
import {
  acceptSolicitorInvite,
  endSolicitor,
  getSolicitorProject,
  inspectSolicitorInvite,
  inviteSolicitor,
  isProjectSolicitor,
  resendSolicitorInvite,
} from "@/services/projects/solicitors";

/**
 * Phase 4 Task 5 (migration 20261119030000) on the disposable database:
 * Admin-only appointment, one Solicitor per project, the expiring
 * single-use invitation, the database creating exactly one SOLICITOR profile
 * bound to that project, closing on completion, and the RLS matrix proving a
 * Solicitor's session reads only their own project.
 */
const hasDb = assertSafeIntegrationDatabase(process.env.DATABASE_URL);
let client: Client;

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  // Stands in for Supabase's Admin API: inserting the Auth user fires the
  // real profile trigger, exactly as in production.
  setAgentAccountProvisionerForTests({
    async createConfirmedUser({ email, signupNonce }) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data)
         VALUES ($1, $2, jsonb_build_object('proplink_signup_nonce', $3::text))`,
        [id, email, signupNonce],
      );
      return { ok: true, authUserId: id };
    },
  });
});

afterAll(async () => {
  setAgentAccountProvisionerForTests(null);
  if (hasDb) await client.end();
});

const as = (p: Person, role: Role) => ({ ...p, role });
const PASSWORD = "Correct-Horse-Battery-9";

async function openProject() {
  const chain = await mandateChain(client);
  const published = await publishProject(
    as(chain.agent, Role.AGENT),
    chain.mandateId,
    TERMS,
  );
  if (!published.ok) throw new Error(published.error);
  const projectId = published.data.projectId;
  const lead = await person(client, "INVESTOR");
  await expressInterest(as(lead, Role.INVESTOR), projectId);
  const n = await nominateLead(as(chain.agent, Role.AGENT), projectId, lead.profileId);
  if (!n.ok) throw new Error(n.error);
  await respondToNomination(as(lead, Role.INVESTOR), n.data.nominationId, true);
  await decideNomination(as(chain.admin, Role.ADMIN), n.data.nominationId, true);
  return { ...chain, projectId, lead };
}

/** Invites and accepts; returns the Solicitor as an actor. */
async function appoint(projectId: string, admin: Person) {
  const email = `sol-${randomUUID()}@proplink.test`;
  const invited = await inviteSolicitor(as(admin, Role.ADMIN), projectId, {
    email,
    name: "Sam Solicitor",
    firm: "Lawful & Co LLP",
  });
  if (!invited.ok) throw new Error(invited.error);
  const token = new URL(invited.data.devInviteUrl!).hash.replace("#token=", "");
  const accepted = await acceptSolicitorInvite(
    { token, name: "Sam Solicitor", password: PASSWORD, acceptTerms: true },
    "127.0.0.1",
  );
  if (!accepted.ok) throw new Error(JSON.stringify(accepted));
  const legacyUserId = `p4-sol-${accepted.authUserId}`;
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Sam Solicitor', 'SOLICITOR')`,
    [legacyUserId, email],
  );
  await client.query(`UPDATE public.profiles SET "legacyUserId" = $2 WHERE id = $1`, [
    accepted.authUserId,
    legacyUserId,
  ]);
  return {
    solicitor: { profileId: accepted.authUserId, legacyUserId, role: Role.SOLICITOR },
    solicitorId: accepted.solicitorId,
    token,
  };
}

/** Runs one query as a signed-in Data API session (role authenticated). */
async function asSession<T>(uid: string | null, sql: string): Promise<T[]> {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE authenticated");
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      uid ?? "",
    ]);
    const { rows } = await client.query(sql);
    return rows as T[];
  } finally {
    await client.query("ROLLBACK");
  }
}

describe.skipIf(!hasDb)("Solicitor accounts (Task 5)", () => {
  it("are appointed only by Admin, one per project, through a single-use invitation", async () => {
    const chain = await openProject();
    const email = `sol-${randomUUID()}@proplink.test`;
    const details = { email, name: "Sam Solicitor", firm: "Lawful & Co LLP" };
    expect(
      await inviteSolicitor(as(chain.agent, Role.AGENT), chain.projectId, details),
    ).toMatchObject({ ok: false, status: 403 });
    const invited = await inviteSolicitor(
      as(chain.admin, Role.ADMIN),
      chain.projectId,
      details,
    );
    expect(invited).toMatchObject({ ok: true, data: { emailed: true } });
    if (!invited.ok) return;
    expect(sendSolicitorInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: email, projectTitle: TERMS.title }),
    );
    // One per project.
    expect(
      await inviteSolicitor(as(chain.admin, Role.ADMIN), chain.projectId, {
        ...details,
        email: `sol-${randomUUID()}@proplink.test`,
      }),
    ).toMatchObject({ ok: false, status: 409 });
    // An email that already has an account cannot be appointed.
    const other = await openProject();
    expect(
      await inviteSolicitor(as(other.admin, Role.ADMIN), other.projectId, {
        ...details,
        email: `p4-${other.agent.profileId}@proplink.test`,
      }),
    ).toMatchObject({ ok: false, status: 409 });

    // Re-send rotates the token: the old link stops working.
    const oldToken = new URL(invited.data.devInviteUrl!).hash.replace("#token=", "");
    const resent = await resendSolicitorInvite(
      as(chain.admin, Role.ADMIN),
      invited.data.solicitorId,
    );
    if (!resent.ok) throw new Error(resent.error);
    const newToken = new URL(resent.data.devInviteUrl!).hash.replace("#token=", "");
    expect(await inspectSolicitorInvite(oldToken)).toEqual({
      ok: false,
      problem: "invalid",
    });
    expect(await inspectSolicitorInvite(newToken)).toEqual({
      ok: true,
      email,
      projectTitle: TERMS.title,
    });

    // Expired invitations are refused.
    await client.query(
      `UPDATE public.project_solicitors SET "expiresAt" = now() - interval '1 minute' WHERE id = $1`,
      [invited.data.solicitorId],
    );
    expect(await inspectSolicitorInvite(newToken)).toEqual({
      ok: false,
      problem: "expired",
    });
    expect(
      await acceptSolicitorInvite(
        { token: newToken, name: "Sam", password: PASSWORD, acceptTerms: true },
        "127.0.0.1",
      ),
    ).toEqual({ ok: false, problem: "expired" });

    // Revoke it; a new appointment can then be made.
    expect(
      await endSolicitor(
        as(chain.admin, Role.ADMIN),
        invited.data.solicitorId,
        "Wrong firm",
      ),
    ).toEqual({ ok: true });
    expect(await inspectSolicitorInvite(newToken)).toEqual({
      ok: false,
      problem: "revoked",
    });
  });

  it("creates exactly one SOLICITOR profile bound to the project; the link works once", async () => {
    const chain = await openProject();
    const { solicitor, token } = await appoint(chain.projectId, chain.admin);
    const { rows } = await client.query(
      `SELECT p.role::text AS role, s.status::text AS status, s."projectId"
       FROM public.profiles p JOIN public.project_solicitors s ON s."profileId" = p.id
       WHERE p.id = $1`,
      [solicitor.profileId],
    );
    expect(rows).toEqual([
      { role: "SOLICITOR", status: "ACTIVE", projectId: chain.projectId },
    ]);
    expect(
      await acceptSolicitorInvite(
        { token, name: "Again", password: PASSWORD, acceptTerms: true },
        "127.0.0.1",
      ),
    ).toEqual({ ok: false, problem: "used" });
    // Without a claim, a new Auth user never becomes SOLICITOR.
    const id = randomUUID();
    await client.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data)
       VALUES ($1, $2, jsonb_build_object('proplink_signup_nonce', 'forged-nonce'))`,
      [id, `forged-${id}@proplink.test`],
    );
    const forged = await client.query(
      `SELECT role::text AS role FROM public.profiles WHERE id = $1`,
      [id],
    );
    expect(forged.rows[0].role).toBe("BUYER");
    // Database: only Admin appoints, and an appointment cannot move projects.
    const other = await openProject();
    await expect(
      client.query(
        `INSERT INTO public.project_solicitors (id, "projectId", email, name, firm, "tokenHash", "expiresAt", "invitedBy", "updatedAt")
         VALUES ($1, $2, 'x@proplink.test', 'Name', 'Firm', $3, now() + interval '1 day', $4, now())`,
        [randomUUID(), other.projectId, "a".repeat(64), other.agent.profileId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      client.query(
        `UPDATE public.project_solicitors SET "projectId" = $2 WHERE "profileId" = $1`,
        [solicitor.profileId, other.projectId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("scopes the Solicitor to their project and ends access when closed", async () => {
    const a = await openProject();
    const b = await openProject();
    const { solicitor: solA, solicitorId } = await appoint(a.projectId, a.admin);
    const { solicitor: solB } = await appoint(b.projectId, b.admin);
    const investor = await person(client, "INVESTOR");
    await createPledge(as(investor, Role.INVESTOR), a.projectId, "2000", randomUUID());

    expect(await isProjectSolicitor(solA, a.projectId)).toBe(true);
    expect(await isProjectSolicitor(solA, b.projectId)).toBe(false);
    expect((await getSolicitorProject(solA))?.id).toBe(a.projectId);
    // The service: pledges of their own project only.
    expect((await listProjectPledges(solA, a.projectId))?.length).toBe(1);
    expect(await listProjectPledges(solA, b.projectId)).toBeNull();
    expect(await listProjectPledges(solB, a.projectId)).toBeNull();

    // RLS matrix (exit gate): each session sees only what its policy allows.
    const projects = (uid: string | null) =>
      asSession<{ id: string }>(uid, `SELECT id FROM public.investor_projects`);
    const pledges = (uid: string | null) =>
      asSession<{ projectId: string }>(
        uid,
        `SELECT "projectId" FROM public.project_pledges`,
      );
    expect((await projects(solA.profileId)).map((row) => row.id)).toEqual([a.projectId]);
    expect((await projects(solB.profileId)).map((row) => row.id)).toEqual([b.projectId]);
    expect(
      (await pledges(solA.profileId)).every((row) => row.projectId === a.projectId),
    ).toBe(true);
    expect(await pledges(solB.profileId)).toEqual([]);
    for (const other of [investor, a.agent, a.admin, a.landlord, a.lead]) {
      expect(await projects(other.profileId)).toEqual([]);
      expect(await pledges(other.profileId)).toEqual([]);
    }
    expect(await projects(null)).toEqual([]);
    // Nobody writes through the Data API, not even the Solicitor.
    await expect(
      asSession(
        solA.profileId,
        `UPDATE public.investor_projects SET title = 'Changed by solicitor' WHERE true`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asSession(solA.profileId, `SELECT id FROM public.project_solicitors`),
    ).rejects.toMatchObject({ code: "42501" });

    // Closing (project completion): access ends everywhere.
    expect(
      await endSolicitor(as(a.admin, Role.ADMIN), solicitorId, "Project completed"),
    ).toEqual({ ok: true });
    expect(await isProjectSolicitor(solA, a.projectId)).toBe(false);
    expect(await getSolicitorProject(solA)).toBeNull();
    expect(await listProjectPledges(solA, a.projectId)).toBeNull();
    expect(await projects(solA.profileId)).toEqual([]);
    // And it cannot be reopened.
    await expect(
      client.query(
        `UPDATE public.project_solicitors SET status = 'ACTIVE', "endedAt" = NULL,
         "endedBy" = NULL, "endedReason" = NULL WHERE id = $1`,
        [solicitorId],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
