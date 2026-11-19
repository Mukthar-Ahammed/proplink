import { randomUUID } from "node:crypto";

import type { Client } from "pg";

/**
 * Phase 4 database-test fixtures: people, an approved Landlord listing, an
 * ACTIVE mandate and a published project, created straight in the disposable
 * database (the Phase 2 services that normally create them are tested
 * elsewhere). Every row is unique per call; nothing is cleaned up.
 */

export type Person = { profileId: string; legacyUserId: string };

const created: string[] = [];

/**
 * Deactivates every account this file created, so later runs' announcement
 * tests (which email every eligible member) do not grow without bound.
 * Call from afterAll.
 */
export async function retirePeople(client: Client) {
  const ids = created.splice(0);
  if (ids.length === 0) return;
  // Profile and legacy user together: their consistency is checked at commit.
  await client.query(
    `WITH retired AS (
       UPDATE public.profiles SET active = false WHERE id = ANY($1::uuid[]) RETURNING "legacyUserId"
     )
     UPDATE public."User" SET active = false WHERE id IN (SELECT "legacyUserId" FROM retired)`,
    [ids],
  );
}
export type Role = "ADMIN" | "LANDLORD" | "AGENT" | "INVESTOR" | "SOLICITOR" | "BUYER";

/**
 * Test-only: gives an Admin a permission directly (Phase 6, ADR-058). The app
 * can only grant through a request approved by a second super-admin; this
 * fixture skips that by disabling triggers for one statement, which needs the
 * disposable database's superuser and is never possible for the app.
 */
export async function grantAdminPermission(
  client: Client,
  profileId: string,
  permission: string,
) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO public.admin_permission_grants (id, "profileId", permission)
       VALUES ($1, $2, $3::"AdminPermission")`,
      [randomUUID(), profileId, permission],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/**
 * OD-27: test Agents are pre-invite accounts; mark one as authorised by
 * PropLink. Replica mode skips the Admin-only guard (disposable DB only).
 */
export async function authoriseTestAgent(client: Client, profileId: string) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(
      `INSERT INTO public.agent_migrations ("profileId", status, "confirmedAt", "authorisedAt", "authorisedBy", "updatedAt")
       VALUES ($1, 'AUTHORISED', now(), now(), $1, now())
       ON CONFLICT ("profileId") DO NOTHING`,
      [profileId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function person(
  client: Client,
  role: Role,
  options: {
    kyc?: boolean;
    subscribed?: boolean;
    name?: string;
    /** Agent only: authorised by PropLink as an existing Agent (default true, OD-27). */
    authorised?: boolean;
    /** Admin only: permissions to hold (default SUPER_ADMIN; [] for none). */
    adminPermissions?: string[];
  } = {},
): Promise<Person> {
  const profileId = randomUUID();
  const legacyUserId = `p4-${profileId}`;
  created.push(profileId);
  const email = `p4-${profileId}@proplink.test`;
  await client.query("INSERT INTO auth.users (id, email) VALUES ($1, $2)", [
    profileId,
    email,
  ]);
  await client.query(
    `INSERT INTO public."User" (id, email, name, role) VALUES ($1, $2, 'Phase 4 Test', $3::"Role")`,
    [legacyUserId, email, role],
  );
  await client.query(
    `UPDATE public.profiles SET role = $2::"Role", "legacyUserId" = $3, name = $4 WHERE id = $1`,
    [profileId, role, legacyUserId, options.name ?? `Name ${profileId.slice(0, 8)}`],
  );
  const kyc = options.kyc ?? (role === "LANDLORD" || role === "INVESTOR");
  if (kyc) {
    await client.query(
      `WITH u AS (UPDATE public."User" SET "kycStatus" = 'APPROVED' WHERE id = $2 RETURNING 1)
       UPDATE public.profiles SET "kycStatus" = 'APPROVED' WHERE id = $1`,
      [profileId, legacyUserId],
    );
  }
  if (role === "ADMIN") {
    for (const permission of options.adminPermissions ?? ["SUPER_ADMIN"]) {
      await grantAdminPermission(client, profileId, permission);
    }
  }
  if (role === "AGENT") {
    await client.query(
      `INSERT INTO public.agent_company_checks
         ("profileId", "companyNumber", "companyName", "companyStatus", result, provider, "checkedAt", "updatedAt")
       VALUES ($1, '12345678', 'PROPLINK DEMO ESTATES LIMITED', 'active', 'VERIFIED', 'mock', now(), now())`,
      [profileId],
    );
  }
  if (role === "AGENT" && (options.authorised ?? true)) {
    await authoriseTestAgent(client, profileId);
  }
  if ((role === "AGENT" || role === "INVESTOR") && (options.subscribed ?? true)) {
    await subscribe(client, profileId, role === "AGENT" ? "AGENT" : "CO_INVESTOR");
  }
  return { profileId, legacyUserId };
}

export async function subscribe(
  client: Client,
  profileId: string,
  audience: "AGENT" | "LEAD_INVESTOR" | "CO_INVESTOR",
  status = "ACTIVE",
) {
  await client.query(
    `INSERT INTO public.subscriptions (id, "profileId", audience, interval, provider, "providerSubscriptionId",
       "providerPriceId", status, "currentPeriodEnd", "lastEventAt", "updatedAt")
     VALUES ($1, $2, $3::"SubscriptionAudience", 'MONTH', 'mock', $4, 'price_test', $5::"SubscriptionStatus",
       now() + interval '30 days', now(), now())
     ON CONFLICT ("providerSubscriptionId") DO UPDATE SET status = EXCLUDED.status, "lastEventAt" = now()`,
    [randomUUID(), profileId, audience, `sub_${profileId}_${audience}`, status],
  );
}

/** An approved listing with one photo and one document (and an ownership document). */
export async function approvedListing(
  client: Client,
  owner: Person,
  admin: Person,
): Promise<{
  listingId: string;
  photoId: string;
  documentId: string;
  ownershipId: string;
}> {
  const listingId = randomUUID();
  await client.query(
    `INSERT INTO public.landlord_listings
       (id, "ownerId", "createdBy", status, title, "addressLine1", city, postcode, description,
        "submittedAt", "reviewedAt", "reviewedBy", "updatedAt")
     VALUES ($1, $2, $2, 'APPROVED', 'Landlord private title', '1 Secret Street',
       'Town-' || left($1::uuid::text, 8), 'LS6 2AB', 'A terrace needing work.', now(), now(), $3, now())`,
    [listingId, owner.profileId, admin.profileId],
  );
  const file = async (kind: string, name: string, type: string) => {
    const fileId = randomUUID();
    await client.query(
      `INSERT INTO public.uploaded_files (id, "ownerId", purpose, status, "originalName",
         "declaredType", "sizeBytes", sha256, "storageKey", previewable, "updatedAt")
       VALUES ($1, $2, 'document', 'AVAILABLE', $3, $4, 10, $5, $6, $7, now())`,
      [
        fileId,
        owner.profileId,
        name,
        type,
        "e".repeat(64),
        `files/${fileId}`,
        kind === "PHOTO",
      ],
    );
    await client.query(
      `INSERT INTO public.landlord_listing_files ("listingId", "fileId", kind)
       VALUES ($1, $2, $3::"LandlordListingFileKind")`,
      [listingId, fileId, kind],
    );
    return fileId;
  };
  const ownershipId = await file("OWNERSHIP_DOCUMENT", "title.pdf", "application/pdf");
  const photoId = await file("PHOTO", "front.jpg", "image/jpeg");
  const documentId = await file("DOCUMENT", "survey.pdf", "application/pdf");
  return { listingId, photoId, documentId, ownershipId };
}

/** Proposal → offered → ACTIVE mandate, directly in SQL. */
export async function activeMandate(
  client: Client,
  listingId: string,
  agent: Person,
): Promise<string> {
  const proposalId = randomUUID();
  await client.query(
    `INSERT INTO public.agent_proposals
       (id, "listingId", "agentId", "valuationGBP", "feeType", "feeBasisPoints", "contractMonths",
        terms, pitch, "updatedAt")
     VALUES ($1, $2, $3, 18000000, 'PERCENT', 125, 6,
       'We manage the refurbishment and the sale within six months.',
       'Specialists in distressed terraced housing in north Leeds.', now())`,
    [proposalId, listingId, agent.profileId],
  );
  const mandateId = randomUUID();
  await client.query(
    `INSERT INTO public.mandates (id, "listingId", "agentId", "proposalId", "valuationGBP", "feeType",
       "feeBasisPoints", "contractMonths", terms, "updatedAt")
     VALUES ($1, $2, $3, $4, 18000000, 'PERCENT', 125, 6, 'Agreed terms.', now())`,
    [mandateId, listingId, agent.profileId, proposalId],
  );
  await client.query(
    `UPDATE public.mandates SET status = 'ACTIVE', "respondedAt" = now(), "acceptedAt" = now(),
       "endsAt" = now() + interval '6 months', "updatedAt" = now() WHERE id = $1`,
    [mandateId],
  );
  return mandateId;
}

export const TERMS = {
  title: "North Leeds terrace refurbishment",
  summary: "Full refurbishment of a three-bed terrace, then sale on the open market.",
  mode: "REFURBISHMENT",
  capitalRequired: "100000",
  minimumPledge: "1000",
  fundingDeadline: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
  purchase: "150000",
  marketValue: "220000",
  expectedProfit: "30000",
  expectedMonths: "9",
};

/** A whole chain: Admin, Landlord, Agent, approved listing and ACTIVE mandate. */
export async function mandateChain(client: Client) {
  const admin = await person(client, "ADMIN");
  const landlord = await person(client, "LANDLORD");
  const agent = await person(client, "AGENT");
  const listing = await approvedListing(client, landlord, admin);
  const mandateId = await activeMandate(client, listing.listingId, agent);
  return { admin, landlord, agent, mandateId, ...listing };
}

/** An ACTIVE Solicitor on a project, created in SQL (the invitation flow is tested elsewhere). */
export async function activeSolicitor(
  client: Client,
  projectId: string,
  admin: Person,
): Promise<Person> {
  const solicitor = await person(client, "SOLICITOR", { kyc: false });
  const id = randomUUID();
  await client.query(
    `INSERT INTO public.project_solicitors (id, "projectId", email, name, firm, "tokenHash", "expiresAt", "invitedBy", "updatedAt")
     VALUES ($1, $2, $3, 'Sam Solicitor', 'Lawful & Co LLP', $4, now() + interval '7 days', $5, now())`,
    [
      id,
      projectId,
      `p4-${solicitor.profileId}@proplink.test`,
      id.replace(/-/g, "").padEnd(64, "0"),
      admin.profileId,
    ],
  );
  await client.query(
    `UPDATE public.project_solicitors SET status = 'ACTIVE', "profileId" = $2, "acceptedAt" = now(), "updatedAt" = now()
     WHERE id = $1`,
    [id, solicitor.profileId],
  );
  return solicitor;
}
