import "server-only";

import {
  DealStage,
  InvestorProjectStatus,
  MandateStatus,
  OfferStatus,
  PledgeState,
  ProjectSolicitorStatus,
  Role,
  SubscriptionStatus,
} from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { eraseUser } from "@/services/users/erasure";

/**
 * GDPR erasure with legal holds (Phase 7 Task 4, ADR-065; Q42).
 *
 * Erasure pseudonymises the account (name, email, profile text and photo,
 * saved searches and listings, preferences) and signs it out everywhere.
 * Two kinds of hold:
 *  - **Blocking:** obligations still running with other people (an offered or
 *    active mandate, a project not yet sold or closed, a binding pledge on
 *    one, an accepted purchase not completed, an active Solicitor
 *    appointment, a live subscription, or an Admin account). Erasure waits
 *    until these end; the member is told why.
 *  - **Retained by law (kept, linked to the pseudonymised account):** KYC
 *    outcomes (UK AML, 5 years), agreements, the distribution ledger and
 *    sale records (6 years), the audit log, and messages in other people's
 *    conversations. Periods are in docs/compliance/RETENTION.md (OD-26).
 */

export type ErasureHolds = { blocking: string[]; retained: string[] };

const OPEN_PROJECT = {
  notIn: [InvestorProjectStatus.SOLD, InvestorProjectStatus.CLOSED],
};

export async function erasureHolds(profileId: string): Promise<ErasureHolds> {
  const profile = await db.profile.findUnique({
    where: { id: profileId },
    select: { role: true, legacyUserId: true },
  });
  if (!profile) return { blocking: [], retained: [] };
  const legacy = profile.legacyUserId;
  const [
    mandates,
    agentProjects,
    leadProjects,
    pledges,
    offers,
    solicitor,
    subscriptions,
    kyc,
    ledger,
    agreements,
  ] = await Promise.all([
    db.mandate.count({
      where: {
        status: { in: [MandateStatus.OFFERED, MandateStatus.ACTIVE] },
        OR: [{ agentId: profileId }, { listing: { ownerId: profileId } }],
      },
    }),
    db.investorProject.count({ where: { agentId: profileId, status: OPEN_PROJECT } }),
    db.investorProject.count({
      where: { leadInvestorId: profileId, status: OPEN_PROJECT },
    }),
    db.projectPledge.count({
      where: {
        investorId: profileId,
        status: PledgeState.BINDING,
        project: { status: OPEN_PROJECT },
      },
    }),
    legacy
      ? db.offer.count({
          where: {
            buyerUserId: legacy,
            OR: [
              {
                status: {
                  in: [
                    OfferStatus.SUBMITTED,
                    OfferStatus.UNDER_REVIEW,
                    OfferStatus.COUNTER_OFFERED,
                  ],
                },
              },
              {
                status: OfferStatus.ACCEPTED,
                deals: { some: { stage: { not: DealStage.COMPLETED } } },
              },
            ],
          },
        })
      : 0,
    db.projectSolicitor.count({
      where: { profileId, status: ProjectSolicitorStatus.ACTIVE },
    }),
    db.billingSubscription.count({
      where: {
        profileId,
        status: {
          in: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.TRIALING,
            SubscriptionStatus.PAST_DUE,
          ],
        },
      },
    }),
    legacy ? db.kycRecord.count({ where: { userId: legacy } }) : 0,
    db.distributionLedgerEntry.count({ where: { partyId: profileId } }),
    db.agreementParty.count({ where: { profileId } }),
  ]);

  const blocking: string[] = [];
  if (profile.role === Role.ADMIN)
    blocking.push("Admin accounts are closed by a super-admin.");
  if (mandates)
    blocking.push(
      "You have an offered or active mandate. It must end or be closed first.",
    );
  if (agentProjects + leadProjects)
    blocking.push("You run an investor project that has not been sold or closed.");
  if (pledges)
    blocking.push(
      "You have a binding pledge on a project that has not been sold or closed.",
    );
  if (offers)
    blocking.push("You have an open offer or a purchase that has not completed.");
  if (solicitor) blocking.push("You are the active Solicitor on a project.");
  if (subscriptions) blocking.push("You have a live subscription. Cancel it first.");

  const retained: string[] = [
    "The audit log of your actions (security and legal record).",
  ];
  if (kyc)
    retained.push("Identity check outcomes (UK anti-money-laundering rules, 5 years).");
  if (ledger + agreements) {
    retained.push(
      "Signed agreements and the distribution ledger (financial records, 6 years).",
    );
  }
  retained.push(
    "Messages you sent in other people's conversations (shown as from an erased member).",
  );
  return { blocking, retained };
}

export type EraseResult =
  | { ok: true; retained: string[] }
  | { ok: false; status: number; error: string; blocking?: string[] };

/** Erases a member's account unless a blocking hold applies. */
export async function eraseMember(legacyUserId: string): Promise<EraseResult> {
  const user = await db.user.findUnique({
    where: { id: legacyUserId },
    select: { authProfile: { select: { id: true } } },
  });
  if (!user) return { ok: false, status: 404, error: "Account not found" };
  const holds = user.authProfile
    ? await erasureHolds(user.authProfile.id)
    : { blocking: [], retained: [] };
  if (holds.blocking.length > 0) {
    return {
      ok: false,
      status: 409,
      error: "This account cannot be erased yet",
      blocking: holds.blocking,
    };
  }
  const erased = await eraseUser(legacyUserId);
  if (!erased.ok) return { ok: false, status: 404, error: "Account not found" };
  return { ok: true, retained: holds.retained };
}
