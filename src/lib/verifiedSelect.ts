/**
 * Prisma select fragment for the verified badge (ADR-027). Spread it into any
 * `profile` select whose name is shown, then render the name with
 * `<PersonName verified={isVerified(row)} />`.
 */
export const VERIFIED = { verificationBadge: { select: { profileId: true } } } as const;
