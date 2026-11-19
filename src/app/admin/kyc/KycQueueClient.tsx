"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { KycSubmissionStatus, InvestorType } from "@/generated/prisma/enums";
import type {
  AdminKycQueueItem,
  AdminKycSummary,
} from "@/services/admin/kycAdminService";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";

export function KycQueueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read URL search params with sensible defaults
  const statusParam =
    (searchParams.get("status") as KycSubmissionStatus | "ALL") ||
    KycSubmissionStatus.SUBMITTED;
  const subtypeParam = searchParams.get("investorType") || "ALL";
  const searchParam = searchParams.get("search") || "";
  const sortParam = (searchParams.get("sort") as "oldest" | "newest") || "oldest";
  const pageParam = parseInt(searchParams.get("page") || "1", 10);

  const [statusFilter, setStatusFilter] = useState<KycSubmissionStatus | "ALL">(
    statusParam,
  );
  const [subtypeFilter, setSubtypeFilter] = useState<string>(subtypeParam);
  const [search, setSearch] = useState(searchParam);
  const [sortOrder, setSortOrder] = useState<"oldest" | "newest">(sortParam);
  const [page, setPage] = useState(pageParam);

  const [summary, setSummary] = useState<AdminKycSummary | null>(null);
  const [queue, setQueue] = useState<AdminKycQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync state with URL
  const updateUrl = useCallback(
    (newParams: {
      status?: string;
      investorType?: string;
      search?: string;
      sort?: string;
      page?: number;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newParams.status !== undefined) {
        if (newParams.status === KycSubmissionStatus.SUBMITTED) params.delete("status");
        else params.set("status", newParams.status);
      }
      if (newParams.investorType !== undefined) {
        if (newParams.investorType === "ALL") params.delete("investorType");
        else params.set("investorType", newParams.investorType);
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

      router.push(`/admin/kyc?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Fetch Summary statistics
  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/kyc/summary");
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch (err) {
      console.error("Failed to fetch KYC summary:", err);
    }
  }, []);

  // Fetch Queue items
  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (subtypeFilter !== "ALL") params.set("investorType", subtypeFilter);
      if (search.trim()) params.set("search", search.trim());
      if (sortOrder) params.set("sort", sortOrder);
      params.set("page", page.toString());
      params.set("pageSize", "10");

      const res = await fetch(`/api/admin/kyc?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load KYC queue");
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
  }, [statusFilter, subtypeFilter, search, sortOrder, page]);

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

  // Handler functions for controls
  const handleStatusChange = (newStatus: KycSubmissionStatus | "ALL") => {
    setStatusFilter(newStatus);
    setPage(1);
    updateUrl({ status: newStatus, page: 1 });
  };

  const handleSubtypeChange = (newSubtype: string) => {
    setSubtypeFilter(newSubtype);
    setPage(1);
    updateUrl({ investorType: newSubtype, page: 1 });
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
        title="KYC & Compliance Review Studio"
        description="Operational review workspace for investor identity verification and platform access decisions."
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
            Pending Review
          </p>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-primary">
              {summary?.pendingCount ?? "—"}
            </span>
            <span className="text-[11px] font-semibold text-warning">
              Requires action
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-success/30 bg-success/5 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Approved Investors
          </p>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-primary">
              {summary?.approvedCount ?? "—"}
            </span>
            <span className="text-[11px] font-semibold text-success">Authorized</span>
          </div>
        </div>

        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
            Rejected Submissions
          </p>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black tabular-nums text-primary">
              {summary?.rejectedCount ?? "—"}
            </span>
            <span className="text-[11px] font-semibold text-danger">Blocked</span>
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
            onClick={() => handleStatusChange(KycSubmissionStatus.SUBMITTED)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              statusFilter === KycSubmissionStatus.SUBMITTED
                ? "bg-primary text-white"
                : "text-secondary hover:bg-surface"
            }`}
          >
            Pending Review ({summary?.pendingCount ?? 0})
          </button>
          <button
            onClick={() => handleStatusChange(KycSubmissionStatus.APPROVED)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              statusFilter === KycSubmissionStatus.APPROVED
                ? "bg-success text-white"
                : "text-secondary hover:bg-surface"
            }`}
          >
            Approved ({summary?.approvedCount ?? 0})
          </button>
          <button
            onClick={() => handleStatusChange(KycSubmissionStatus.REJECTED)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              statusFilter === KycSubmissionStatus.REJECTED
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
            All Submissions ({summary?.totalCount ?? 0})
          </button>
        </div>

        {/* Search, Subtype & Sort Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">
              Search Investor
            </label>
            <input
              type="text"
              placeholder="Search by investor name or email..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full text-xs border border-line rounded-lg p-2 focus:ring-accent focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">
              Investor Subtype
            </label>
            <select
              aria-label="Investor subtype"
              value={subtypeFilter}
              onChange={(e) => handleSubtypeChange(e.target.value)}
              className="w-full text-xs border border-line rounded-lg p-2 focus:ring-accent focus:border-accent"
            >
              <option value="ALL">All Subtypes</option>
              <option value={InvestorType.FLIPPER}>FLIPPER</option>
              <option value={InvestorType.SYNDICATE}>SYNDICATE</option>
              <option value={InvestorType.BOTH}>BOTH</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-muted uppercase mb-1">
              Sort Order
            </label>
            <select
              aria-label="Sort order"
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
          Loading compliance queue...
        </div>
      ) : error ? (
        <div className="bg-danger/5 border border-danger/30 p-4 rounded-xl text-danger text-xs">
          {error}
        </div>
      ) : queue.length === 0 ? (
        <div className="bg-white p-12 rounded-xl border border-line text-center space-y-2">
          <p className="text-sm font-semibold text-primary">No submissions found</p>
          <p className="text-xs text-muted">
            No KYC submissions match your selected status, subtype, or search criteria.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line text-xs">
              <thead className="bg-surface">
                <tr>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Investor
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Subtype
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Attempt
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Submission Status
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Profile Authorization
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Submitted / Waiting
                  </th>
                  <th className="px-4 py-3 text-left font-bold uppercase tracking-wider text-muted">
                    Docs
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
                        <div className="font-bold text-primary">{item.investorName}</div>
                        <div className="text-[11px] text-muted">{item.investorEmail}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold text-accent">
                        {item.investorType ?? "NOT_SET"}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-surface border border-line text-muted">
                          #{item.attemptNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.submissionStatus} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.profileKycStatus} />
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
                      <td className="px-4 py-3 font-semibold text-primary">
                        {item.documentCount} doc(s)
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/kyc/${item.id}`}
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
