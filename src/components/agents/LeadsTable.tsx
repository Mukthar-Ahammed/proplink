"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";

export interface LeadRow {
  id: string;
  message: string;
  status: string;
  createdAt: string;
  fromName: string;
  fromEmail: string;
  propertyId: string;
  propertyTitle: string;
}

const STATUS_OPTIONS = [
  { value: "NEW", label: "New" },
  { value: "RESPONDED", label: "Responded" },
  { value: "CLOSED", label: "Closed" },
];

/**
 * `StatusPill` look (src/components/investor/InvestorUi.tsx), inlined: that
 * module imports server-only services, so this client component cannot.
 */
const PILL =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold";
const STATUS_TONE: Record<string, string> = {
  NEW: "border-accent/25 bg-pale text-accent",
  RESPONDED: "border-success/25 bg-success/10 text-success",
  CLOSED: "border-line bg-surface text-secondary",
};

/**
 * `/agent/leads` table (Task 2.6). Status is a per-row `<select>` that PATCHes
 * `/api/enquiries/[id]` and then `router.refresh()`es, the same
 * fetch-then-refresh pattern as `ListingWizard` and `ModerationQueue` — the
 * server component re-runs and the row re-renders from the DB, so what you see
 * after the toast is persisted state rather than local optimism.
 *
 * The select is disabled while its own request is in flight (tracked per row,
 * not globally, so two leads can be updated back to back).
 */
export function LeadsTable({ leads }: { leads: LeadRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function changeStatus(id: string, status: string) {
    setPendingId(id);
    try {
      const res = await fetch(`/api/enquiries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast(data?.error ?? `Could not update the lead (${res.status})`, "danger");
        return;
      }
      toast("Lead status updated", "success");
      router.refresh();
    } finally {
      setPendingId(null);
    }
  }

  if (leads.length === 0) {
    return (
      <p className="rounded-3xl border border-dashed border-line bg-surface/60 px-6 py-12 text-center text-sm text-muted">
        No enquiries yet for this agency. Leads appear here the moment a buyer contacts
        you about a live listing.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
      {/* Focusable named region: on a phone the table scrolls sideways, and a
          keyboard user must be able to reach it (axe: scrollable-region-focusable). */}
      <div
        role="region"
        aria-label="Enquiries"
        tabIndex={0}
        className="relative overflow-x-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      >
        <table className="w-full min-w-max text-left text-sm">
          <thead className="border-b border-line bg-surface/70 text-xs font-semibold tracking-[0.1em] text-muted uppercase">
            <tr>
              <th className="px-6 py-3">Enquirer</th>
              <th className="px-4 py-3">Listing</th>
              <th className="px-4 py-3">Message</th>
              <th className="px-4 py-3">Received</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {leads.map((l) => (
              <tr key={l.id} className="align-top transition-colors hover:bg-pale/40">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pale text-sm font-semibold text-accent"
                    >
                      {l.fromName.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-primary">{l.fromName}</p>
                      <a
                        href={`mailto:${l.fromEmail}`}
                        className="text-xs text-accent hover:underline"
                      >
                        {l.fromEmail}
                      </a>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <Link
                    href={`/marketplace/${l.propertyId}`}
                    className="font-medium text-primary underline decoration-line underline-offset-4 hover:decoration-accent"
                  >
                    {l.propertyTitle}
                  </Link>
                </td>
                <td className="px-4 py-4">
                  <p className="max-w-md text-sm leading-relaxed whitespace-pre-wrap text-body">
                    {l.message}
                  </p>
                </td>
                <td className="px-4 py-4 text-xs whitespace-nowrap text-muted">
                  {l.createdAt.slice(0, 10)}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(PILL, STATUS_TONE[l.status] ?? STATUS_TONE.CLOSED)}
                    >
                      {l.status}
                    </span>
                    <Select
                      aria-label={`Status for ${l.fromName}'s enquiry`}
                      options={STATUS_OPTIONS}
                      value={l.status}
                      disabled={pendingId === l.id}
                      onChange={(e) => changeStatus(l.id, e.target.value)}
                      className="mt-0 w-36 rounded-full py-2 disabled:opacity-60"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
