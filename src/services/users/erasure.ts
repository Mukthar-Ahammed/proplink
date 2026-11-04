import { db } from "@/lib/db";

/**
 * GDPR right-to-erasure: anonymises the User row in place.
 * KycRecord rows are DELIBERATELY preserved (UK AML: 5-year retention,
 * docs/CONTEXT.md §compliance) — they end up linked to an anonymised shell.
 */
export async function eraseUser(userId: string): Promise<{ ok: boolean }> {
  return db.$transaction(async (transaction) => {
    const user = await transaction.user.findUnique({
      where: { id: userId },
      select: { id: true, authProfile: { select: { id: true } } },
    });
    if (!user) return { ok: false };

    if (user.authProfile) {
      await transaction.profile.update({
        where: { id: user.authProfile.id },
        data: {
          name: "Erased User",
          avatarUrl: null,
          complianceCode: null,
          gdprConsentAt: null,
          active: false,
        },
      });
    }
    await transaction.user.update({
      where: { id: userId },
      data: {
        email: `erased-${userId}@anonymised.invalid`,
        name: "Erased User",
        passwordHash: null,
        avatarUrl: null,
        complianceCode: null,
        gdprConsentAt: null,
        active: false,
        emailVerified: null,
      },
    });

    // Tokens are PII-adjacent and now useless. KYC records remain untouched.
    await transaction.verificationToken.deleteMany({ where: { userId } });
    await transaction.auditLog.create({
      data: {
        actorUserId: userId,
        action: "USER_ERASED",
        entity: "User",
        entityId: userId,
      },
    });

    return { ok: true };
  });
}
