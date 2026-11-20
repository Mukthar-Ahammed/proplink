import Link from "next/link";

import { PersonName } from "@/components/profiles/PersonName";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";

export type ThreadSummary = {
  id: string;
  title: string;
  counterpart: string;
  /** Server-derived: the counterpart carries the verified badge. */
  counterpartVerified: boolean;
  /** Signed photo link, or null for initials (decided server-side). */
  counterpartPhotoUrl?: string | null;
  pairType: string;
  status: string;
  unread: number;
  lastMessageAt: Date | null;
};

const PAIR: Record<string, string> = {
  LANDLORD_AGENT: "Landlord and agent",
  AGENT_INVESTOR: "Agent and investor",
  LEAD_CO_INVESTOR: "Lead and co-investor",
  BUYER_AGENT: "Buyer and agent",
};
const STATUS: Record<string, string> = {
  PENDING: "Waiting for PropLink to authorise",
  AUTHORIZED: "Open",
  CLOSED: "Closed (read-only)",
};

const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

function when(date: Date | null): string {
  if (!date) return "";
  return new Date(date).toDateString() === new Date().toDateString()
    ? timeFormat.format(date)
    : dateFormat.format(date);
}

/** The conversation list (Phase 3, ADR-043): left pane on desktop, whole page on phones. */
export function ThreadList({
  threads,
  activeId,
}: {
  threads: ThreadSummary[];
  activeId?: string;
}) {
  const unread = threads.reduce((sum, thread) => sum + thread.unread, 0);
  return (
    <section
      aria-label="Conversations"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-white"
    >
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3.5">
        <h2 className="text-base font-semibold text-primary">Conversations</h2>
        {unread > 0 && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">
            {unread} new
          </span>
        )}
      </header>
      {threads.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">
          No conversations yet. A chat opens once PropLink authorises it (buyer enquiries
          open straight away).
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {threads.map((thread) => {
            const active = thread.id === activeId;
            return (
              <li key={thread.id}>
                <Link
                  href={`/messages/${thread.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex items-center gap-3 px-4 py-3.5 transition-colors",
                    active ? "bg-pale" : "hover:bg-surface",
                  )}
                  data-testid={`thread-${thread.id}`}
                >
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-y-2 left-0 w-1 rounded-r bg-accent"
                    />
                  )}
                  <Avatar
                    name={thread.counterpart}
                    src={thread.counterpartPhotoUrl}
                    tone={active ? "accent" : "neutral"}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <PersonName
                        name={thread.counterpart}
                        verified={thread.counterpartVerified}
                        className={cn(
                          "text-primary",
                          thread.unread > 0 ? "font-bold" : "font-semibold",
                        )}
                      />
                      <span className="shrink-0 text-xs text-muted">
                        {when(thread.lastMessageAt)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-body">{thread.title}</span>
                      {thread.unread > 0 && (
                        <span className="shrink-0 rounded-full bg-accent px-1.5 text-xs font-semibold text-white">
                          {thread.unread}
                          <span className="sr-only"> new</span>
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                      <span
                        aria-hidden
                        className={cn(
                          "inline-block h-2 w-2 shrink-0 rounded-full",
                          thread.status === "AUTHORIZED"
                            ? "bg-success"
                            : thread.status === "PENDING"
                              ? "bg-warning"
                              : "bg-muted/50",
                        )}
                      />
                      <span className="truncate">
                        {STATUS[thread.status]} · {PAIR[thread.pairType]}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
