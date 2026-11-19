"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PropertyStatus } from "@/generated/prisma/enums";
import type {
  AdminListingSummary,
  ModerationListing,
} from "@/services/listings/moderationService";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatPenceGBP } from "@/components/listings/wizardTypes";

export function ModerationQueueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const statusParam =
    (searchParams.get("status") as PropertyStatus | "REJECTED" | "ALL") ||
    PropertyStatus.PENDING_REVIEW;
  const searchParam = searchParams.get("search") || "";
  const sortParam = (searchParams.get("sort") as "oldest" | "newest") || "oldest";
  const pageParam = parseInt(searchParams.get("page") || "1", 10);

  const [statusFilter, setStatusFilter] = useState<PropertyStatus | "REJECTED" | "ALL">(
    statusParam,
  );
  const [search, setSearch] = useState(searchParam);
  const [sortOrder, setSortOrder] = useState<"oldest" | "newest">(sortParam);
  const [page, setPage] = useState(pageParam);

  const [summary, setSummary] = useState<AdminListingSummary | null>(null);
  const [queue, setQueue] = useState<ModerationListing[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const updateUrl = useCallback(
    (newParams: { status?: string; search?: string; sort?: string; page?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newParams.status !== undefined) {
        if (newParams.status === PropertyStatus.PENDING_REVIEW) params.delete("status");
        else params.set("status", newParams.status);
      }
      if (newParams.search !== undefined) {
        if (!newParams.search.trim()) params.delete("search");
        else params.set("search", newParams.search.trim());
      }
      if (newParams.sort !== undefined) {
        if (newParams.sort === "oldest") params.delete("sort");
        else params.set("sort", newParams.sort);
      }
      if (newParams.page !== undefined) {
        if (newParams.page === 1) params.delete("page");
        else params.set("page", newParams.page.toString());
      }

      router.push(`/admin/moderation?${params.toString()}`);
    },
    [router, searchParams],
  );

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/listings/summary");
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch (err) {
      console.error("Failed to fetch listing summary:", err);
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      if (sortOrder) params.set("sort", sortOrder);
      params.set("page", page.toString());
      params.set("pageSize", "10");

      const res = await fetch(`/api/admin/listings?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load listing moderation queue");
      }
      const data = await res.json();
      setQueue(data.items ?? []);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, sortOrder, page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchSummary();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchSummary]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchQueue();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchQueue]);

  const handleStatusChange = (newStatus: PropertyStatus | "REJECTED" | "ALL") => {
    setStatusFilter(newStatus);
    setPage(1);
    updateUrl({ status: newStatus, page: 1 });
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(1);
    updateUrl({ search: val, page: 1 });
  };

  const handleSortChange = (newSort: "oldest" | "newest") => {
    setSortOrder(newSort);
    setPage(1);
    updateUrl({ sort: newSort, page: 1 });
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
      updateUrl({ page: newPage });
    }
  };

  const oldestPendingText = summary?.oldestPendingSubmittedAt
    ? formatAge(new Date(summary.oldestPendingSubmittedAt).toISOString())
    : "None";

  return (
    <div className="space-y-6">
      {/* Header */}
      <AdminPageHeader
        title="Agent Listing Moderation Studio"
        description="Inspect submitted property deal listings, verify supplied media, and approve to LIVE or return to DRAFT with feedback."
        badge={
          summary && summary.pendingCount > 0
            ? { label: `${summary.pendingCount} pending review`, tone: "warning" }
            : { label: "All clear", tone: "success" }
        }
      />

      {/* Queue Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Pending Moderation
          </p>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-primary">
              {summary?.pendingCount ?? "—"}
            </span>
            <span className="text-[11px] font-semibold text-warning">
              Requires review
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-success/30 bg-success/5 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Live Marketplace Listings
          </p>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-primary">
              {summary?.liveCount ?? "—"}
            </span>
            <span className="text-[11px] font-semibold text-success">Published</span>
          </div>
        </div>

        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Rejected Listings
          </p>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-primary">
              {summary?.rejectedCount ?? "—"}
            </span>
            <span className="text-[11px] font-semibold text-danger">Agent Revision</span>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Oldest Waiting Age
          </p>
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-bold text-primary truncate">
              {oldestPendingText}
            </span>
            {summary?.oldestPendingSubmittedAt && (
              <span className="text-[10px] font-semibold text-muted">FIFO order</span>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-line shadow-xs space-y-4">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
          <button
            onClick={() => handleStatusChange(PropertyStatus.PENDING_REVIEW)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              statusFilter === PropertyStatus.PENDING_REVIEW
                ? "bg-primary text-white"
                : "text-secondary hover:bg-surface"
            }`}
          >
            Pending Review ({summary?.pendingCount ?? 0})
          </button>
          <button
            onClick={() => handleStatusChange(PropertyStatus.LIVE)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              statusFilter === PropertyStatus.LIVE
                ? "bg-success text-white"
                : "text-secondary hover:bg-surface"
            }`}
          >
            Live Listings ({summary?.liveCount ?? 0})
          </button>
          <button
            onClick={() => handleStatusChange("REJECTED")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              statusFilter === "REJECTED"
                ? "bg-danger text-white"
                : "text-secondary hover:bg-surface"
            }`}
          >
            Rejected ({summary?.rejectedCount ?? 0})
          </button>
          <button
            onClick={() => handleStatusChange("ALL")}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              statusFilter === "ALL"
                ? "bg-accent text-white"
                : "text-secondary hover:bg-surface"
            }`}
          >
            All Listings ({summary?.totalCount ?? 0})
          </button>
        </div>

        {/* Search & Sort Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">
              Search Property / Agent
            </label>
            <input
              type="text"
              placeholder="Search by property title, city, or agent name/email..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full text-xs border border-line rounded-lg p-2 focus:ring-accent focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">
              Sort Order
            </label>
            <select
              value={sortOrder}
              onChange={(e) => handleSortChange(e.target.value as "oldest" | "newest")}
              className="w-full text-xs border border-line rounded-lg p-2 focus:ring-accent focus:border-accent"
            >
              <option value="oldest">Oldest First (FIFO)</option>
              <option value="newest">Newest First</option>
            </select>
          </div>
        </div>
      </div>

      {/* Queue Table */}
      {loading ? (
        <div className="bg-white p-12 rounded-xl border border-line text-center text-xs text-muted">
          Loading agent listings...
        </div>
      ) : error ? (
        <div className="bg-danger/5 border border-danger/30 p-4 rounded-xl text-danger text-xs">
          {error}
        </div>
      ) : queue.length === 0 ? (
        <div className="bg-white p-12 rounded-xl border border-line text-center space-y-2">
          <p className="text-sm font-semibold text-primary">No listings found</p>
          <p className="text-xs text-muted">
            No agent listings match your selected status, search, or filter criteria.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-xs">
              <thead className="bg-surface">
                <tr>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Property
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Asking Price
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Listing Source
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Agent / Agency
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Submitted / Waiting
                  </th>
                  <th className="px-4 py-3 text-right font-bold uppercase tracking-wider text-muted">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {queue.map((item) => {
                  const waitingAge = item.submittedAt
                    ? formatAge(new Date(item.submittedAt).toISOString())
                    : "Draft";

                  return (
                    <tr key={item.id} className="hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-bold text-primary">{item.title}</div>
                        <div className="text-[11px] text-muted">
                          {item.city}, {item.postcode}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-extrabold text-primary">
                        {formatPenceGBP(item.askingPriceGBP)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-surface border border-line text-muted uppercase">
                          {item.listingSource}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-primary">
                          {item.agentProfile?.user.name ?? "Platform"}
                        </div>
                        <div className="text-[11px] text-muted">
                          {item.agentProfile?.agencyName ?? "Independent"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <div>
                          {item.submittedAt
                            ? new Date(item.submittedAt).toLocaleDateString("en-GB", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })
                            : "Drafting"}
                        </div>
                        <div className="text-[10px] font-semibold text-warning">
                          {waitingAge}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/moderation/${item.id}`}
                          className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors shadow-xs"
                        >
                          Review Studio →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-4 border-t border-line bg-surface flex items-center justify-between text-xs">
              <span className="text-muted">
                Showing page <strong className="text-primary">{page}</strong> of{" "}
                <strong className="text-primary">{totalPages}</strong> ({total} total
                items)
              </span>

              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-1.5 font-semibold border border-line rounded bg-white hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed text-secondary transition-colors"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 font-semibold border border-line rounded bg-white hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed text-secondary transition-colors"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatAge(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return `Waiting ${days}d ${remHrs}h`;
}
