import { cn } from "@/lib/cn";

/**
 * True when a profile row carries the badge. Services select it next to the
 * name with `verificationBadge: { select: { profileId: true } }`.
 */
export function isVerified(
  profile: { verificationBadge?: { profileId: string } | null } | null | undefined,
): boolean {
  return Boolean(profile?.verificationBadge);
}

/**
 * The compact verified tick (ADR-027) that sits right after a person's name.
 * Server-derived only: callers pass what the database says, never a client
 * guess. Carries its own accessible text, so screen readers hear "Verified".
 */
export function VerifiedTick({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 align-[-0.125em] text-accent", className)}
      title="Verified by PropLink"
      data-testid="verified-tick"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="h-[1em] w-[1em] fill-current">
        <path d="M8 0l1.9 1.4 2.3-.2.7 2.2 2 1.2-.6 2.3.9 2.1-1.8 1.5-.2 2.3-2.3.4-1.4 1.9L8 14l-2.1 1.1-1.4-1.9-2.3-.4-.2-2.3L.2 9l.9-2.1L.5 4.6l2-1.2.7-2.2 2.3.2L8 0zm-1 10.6l4.6-4.6-1-1L7 8.6 5.4 7 4.4 8l2.6 2.6z" />
      </svg>
      <span className="sr-only">Verified</span>
    </span>
  );
}

/** A person's name followed by the verified tick when they carry the badge. */
export function PersonName({
  name,
  verified,
  className,
}: {
  name: string;
  verified: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <span className="truncate">{name}</span>
      {verified && <VerifiedTick />}
    </span>
  );
}
