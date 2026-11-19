/**
 * Verified badge / blue tick (Phase 1 Task 7, ADR-027). Shown only when the
 * server says an Admin awarded it; never derived on the client.
 */
export function VerifiedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent ${className}`}
      title="Verified by PropLink"
      data-testid="verified-badge"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
        <path d="M8 0l1.9 1.4 2.3-.2.7 2.2 2 1.2-.6 2.3.9 2.1-1.8 1.5-.2 2.3-2.3.4-1.4 1.9L8 14l-2.1 1.1-1.4-1.9-2.3-.4-.2-2.3L.2 9l.9-2.1L.5 4.6l2-1.2.7-2.2 2.3.2L8 0zm-1 10.6l4.6-4.6-1-1L7 8.6 5.4 7 4.4 8l2.6 2.6z" />
      </svg>
      Verified
    </span>
  );
}
