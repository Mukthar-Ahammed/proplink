"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlipperResaleStatus } from "@/generated/prisma/enums";
import type { AdminResaleDetail } from "@/services/admin/flipperResaleAdminService";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AdminBreadcrumbs } from "@/components/admin/AdminBreadcrumbs";
import { formatPenceGBP } from "@/components/listings/wizardTypes";

const RESALE_REJECTION_PRESETS = [
  "PRICE_UNREALISTIC",
  "INCOMPLETE_DESCRIPTION",
  "PROJECT_UNRESOLVED",
  "DOCUMENTATION_MISSING",
  "OTHER",
] as const;

export function ResaleReviewStudioClient({
  resaleId,
  initialData,
  currentAdminUserId,
}: {
  resaleId: string;
  initialData: AdminResaleDetail;
  currentAdminUserId: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<AdminResaleDetail>(initialData);

  // Decision Modal state
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionPreset, setRejectionPreset] = useState<string>("PRICE_UNREALISTIC");
  const [rejectionExplanation, setRejectionExplanation] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [actionProcessing, setActionProcessing] = useState(false);
  const [publishedPropertyId, setPublishedPropertyId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  const refreshDetail = async () => {
    try {
      const res = await fetch(`/api/admin/resales/${resaleId}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
      }
    } catch (err) {
      console.error("Failed to refresh resale detail:", err);
    }
  };

  const handleApprove = async () => {
    setActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/admin/resales/${resaleId}/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error?.includes("no longer pending") || json.error?.includes("race condition")) {
          setActionFeedback({
            type: "warning",
            message: "This resale submission has already been reviewed by another Admin. Refreshing state...",
          });
          await refreshDetail();
          setShowApproveModal(false);
          return;
        }
        throw new Error(json.error || "Approval failed");
      }

      setPublishedPropertyId(json.resalePropertyId ?? null);
      setActionFeedback({
        type: "success",
        message: `Flipper Resale APPROVED! Distinct resale Property created and published LIVE (Property ID: ${json.resalePropertyId ?? "Created"}).`,
      });
      setShowApproveModal(false);
      await refreshDetail();
      router.refresh();
    } catch (err: unknown) {
      setActionFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Approval failed",
      });
    } finally {
      setActionProcessing(false);
    }
  };

  const handleReject = async () => {
    const fullReason =
      rejectionPreset === "OTHER"
        ? rejectionExplanation.trim()
        : `${rejectionPreset}: ${rejectionExplanation.trim() || "Requirements not met."}`;

    if (fullReason.length < 5) {
      setActionFeedback({
        type: "error",
        message: "Please provide a valid rejection explanation (minimum 5 characters).",
      });
      return;
    }

    setActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/admin/resales/${resaleId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejectionReason: fullReason,
          internalNotes: internalNotes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error?.includes("no longer pending") || json.error?.includes("race condition")) {
          setActionFeedback({
            type: "warning",
            message: "This resale submission has already been reviewed by another Admin. Refreshing state...",
          });
          await refreshDetail();
          setShowRejectModal(false);
          return;
        }
        throw new Error(json.error || "Rejection failed");
      }

      setActionFeedback({
        type: "success",
        message: "Flipper Resale REJECTED. Investor notified with user-visible explanation.",
      });
      setShowRejectModal(false);
      await refreshDetail();
      router.refresh();
    } catch (err: unknown) {
      setActionFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Rejection failed",
      });
    } finally {
      setActionProcessing(false);
    }
  };

  const isPending = detail.status === FlipperResaleStatus.SUBMITTED;
  const isSelfInvestor = detail.investorUserId === currentAdminUserId;

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <AdminBreadcrumbs
        items={[
          { label: "Admin", href: "/admin" },
          { label: "Flipper Resales", href: "/admin/resales" },
          { label: `Resale Review: ${detail.propertyTitle}` },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-primary">Flipper Resale Governance Studio</h1>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-accent/10 text-accent uppercase">
              Subtype: {detail.investorType ?? "FLIPPER"}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Investor: <strong className="text-primary">{detail.investorName}</strong> ({detail.investorEmail}) — Resale ID: <code className="text-xs">{detail.id}</code>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={detail.status} />
          <Link
            href="/admin/resales"
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-white hover:bg-surface text-secondary transition-colors"
          >
            ← Back to Resales Queue
          </Link>
        </div>
      </div>

      {/* Feedback Banner */}
      {actionFeedback && (
        <div
          className={`p-4 rounded-lg text-sm border font-medium space-y-1 ${
            actionFeedback.type === "success"
              ? "bg-success/10 border-success/30 text-success"
              : actionFeedback.type === "warning"
              ? "bg-warning/10 border-warning/30 text-warning"
              : "bg-danger/10 border-danger/30 text-danger"
          }`}
        >
          <div>{actionFeedback.message}</div>
          {publishedPropertyId && (
            <div className="text-xs font-semibold underline text-primary">
              Distinct Resale Property ID: {publishedPropertyId}
            </div>
          )}
        </div>
      )}

      {/* Main Studio Grid: 2 Columns on Desktop, Stacked on Mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── LEFT COLUMN: Resale Particulars & Original Media (7 Cols) ───────── */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Resale Listing Marketing Particulars
            </h2>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Estimated Asking Price</span>
                <span className="font-extrabold text-primary text-sm">
                  {formatPenceGBP(detail.estimatedAskingPriceGBP * 100)}
                </span>
              </div>
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Location</span>
                <span className="font-bold text-primary">{detail.city}, {detail.postcode}</span>
              </div>
            </div>

            <div>
              <span className="text-[10px] text-muted font-bold uppercase block mb-1">Marketing Description</span>
              <div className="p-3 bg-surface border border-line rounded-lg text-xs text-secondary leading-relaxed whitespace-pre-wrap">
                {detail.description || "No description provided."}
              </div>
            </div>

            <div>
              <span className="text-[10px] text-muted font-bold uppercase block mb-1">Investor Declaration</span>
              <div className="p-3 bg-surface border border-line rounded-lg text-xs italic text-secondary leading-relaxed">
                &quot;{detail.declaration || "No declaration provided."}&quot;
              </div>
            </div>

            {/* Media Information Notice */}
            <div className="p-3 bg-surface border border-line rounded-lg text-xs space-y-1">
              <span className="font-bold text-primary uppercase text-[10px]">Media Source Disclosure</span>
              <p className="text-muted leading-relaxed">
                Media assets for this resale listing are copied from the original acquisition property. Original acquisition property ID: <code className="text-xs">{detail.propertyId}</code>.
              </p>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Governance Context, Economics & Decisions (5 Cols) ─ */}
        <div className="lg:col-span-5 space-y-4">
          {/* Section 1: Governance & Eligibility Context */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Governance & Eligibility Context
            </h2>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-surface p-2 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Investor Subtype</span>
                <span className="font-bold text-accent">{detail.investorType ?? "FLIPPER"}</span>
              </div>
              <div className="bg-surface p-2 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">KYC State</span>
                <span className="font-bold text-success">APPROVED</span>
              </div>
              <div className="bg-surface p-2 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Acquisition</span>
                <span className="font-bold text-success">COMPLETED</span>
              </div>
              <div className="bg-surface p-2 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Refurb Project</span>
                <span className="font-bold text-success">{detail.projectStatus}</span>
              </div>
            </div>
          </div>

          {/* Section 2: Financial Economics Breakdown */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Estimated Financial Economics
            </h2>

            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2 bg-surface rounded border border-line">
                <span className="text-muted">Agreed Acquisition Purchase Price:</span>
                <span className="font-bold text-primary">£{detail.agreedPriceGBP.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface rounded border border-line">
                <span className="text-muted">Total Refurbishment Capex:</span>
                <span className="font-bold text-primary">£{detail.totalCostsGBP.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-surface rounded border border-line">
                <span className="text-muted">Estimated Target Resale Price:</span>
                <span className="font-bold text-primary">£{detail.estimatedAskingPriceGBP.toLocaleString()}</span>
              </div>
              <div className="flex justify-between items-center p-2.5 bg-success/10 border border-success/30 rounded">
                <span className="font-bold text-success">Estimated Advisory Profit:</span>
                <span className="font-black text-success text-sm">£{detail.estimatedProfitGBP.toLocaleString()}</span>
              </div>
            </div>

            <p className="text-[10px] text-muted italic bg-surface p-2 rounded border border-line">
              * Note: Estimated / Advisory / Not realised profit. Calculated as target resale price minus purchase price and capex ledger. Not guaranteed by PropLink.
            </p>
          </div>

          {/* Section 3: Compliance Decision */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Resale Moderation Decision
            </h2>

            {!isPending ? (
              <div className="p-4 bg-surface border border-line rounded-lg space-y-2 text-xs">
                <div className="font-bold text-primary">Review Completed</div>
                <div className="text-muted">
                  Status: <strong className="text-primary">{detail.status}</strong>
                </div>
                {detail.reviewedAt && (
                  <div className="text-muted">
                    Decided on: {new Date(detail.reviewedAt).toLocaleString("en-GB")}
                  </div>
                )}
                {detail.rejectionReason && (
                  <div className="text-danger bg-danger/5 p-2 rounded border border-danger/20 font-medium">
                    <strong>Investor-Visible Rejection Reason:</strong> {detail.rejectionReason}
                  </div>
                )}
                {detail.internalNotes && (
                  <div className="text-secondary bg-warning/10 p-2 rounded border border-warning/30 font-medium">
                    <strong>Confidential Internal Notes:</strong> {detail.internalNotes}
                  </div>
                )}
              </div>
            ) : isSelfInvestor ? (
              <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning font-semibold">
                ⚠️ Anti-Self Approval Policy: You cannot approve or reject a resale listing created by your own Investor account. Decision controls are disabled.
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  Approving will publish a <strong>distinct new Property</strong> onto the marketplace with <code>listingSource = FLIPPER_RESALE</code> and <code>agentProfileId = null</code>. The original acquisition listing remains historical and unchanged.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setShowApproveModal(true)}
                    className="py-2.5 px-4 bg-success hover:bg-success/90 text-white font-bold rounded-lg shadow-xs text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>✓</span> Approve Resale
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    className="py-2.5 px-4 bg-danger hover:bg-danger/90 text-white font-bold rounded-lg shadow-xs text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>✕</span> Reject Resale
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── APPROVAL CONFIRMATION MODAL ─────────────────────────────────────── */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-line">
            <h3 className="text-base font-bold text-primary">Confirm Flipper Resale Approval</h3>
            <p className="text-xs text-muted leading-relaxed">
              Are you sure you want to approve resale listing for <strong className="text-primary">{detail.propertyTitle}</strong>?
              <br /><br />
              This will create a <strong>distinct new Property</strong> with:
              <br />• <code>listingSource = FLIPPER_RESALE</code>
              <br />• <code>status = LIVE</code>
              <br />• <code>agentProfileId = null</code>
              <br /><br />
              The original acquisition property ID (<code className="text-xs">{detail.propertyId}</code>) will remain historical and completely unchanged.
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowApproveModal(false)}
                disabled={actionProcessing}
                className="px-4 py-2 text-xs font-semibold bg-surface border border-line hover:bg-gray-100 text-secondary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApprove}
                disabled={actionProcessing}
                className="px-4 py-2 text-xs font-bold bg-success hover:bg-success/90 text-white rounded-lg shadow-xs transition-colors"
              >
                {actionProcessing ? "Processing..." : "Confirm & Publish Resale"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECTION MODAL ─────────────────────────────────────────────────── */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 border border-line">
            <h3 className="text-base font-bold text-danger">Reject Flipper Resale</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-primary mb-1 uppercase text-[10px]">
                  Rejection Category Presets
                </label>
                <select
                  value={rejectionPreset}
                  onChange={(e) => setRejectionPreset(e.target.value)}
                  className="w-full text-xs border border-line rounded-lg p-2 focus:ring-accent focus:border-accent"
                >
                  {RESALE_REJECTION_PRESETS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-primary mb-1 uppercase text-[10px]">
                  Investor-Visible Explanation <span className="text-danger">* (Required)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Provide feedback explaining why the resale listing was rejected..."
                  value={rejectionExplanation}
                  onChange={(e) => setRejectionExplanation(e.target.value)}
                  className="w-full text-xs border border-line rounded-lg p-2.5 focus:ring-accent focus:border-accent"
                />
              </div>

              <div>
                <label className="block font-bold text-muted mb-1 uppercase text-[10px]">
                  Confidential Internal Notes <span className="text-muted/60">(Admin Only)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="Internal audit notes (never shown to investor)..."
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  className="w-full text-xs border border-line rounded-lg p-2.5 focus:ring-accent focus:border-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setShowRejectModal(false)}
                disabled={actionProcessing}
                className="px-4 py-2 text-xs font-semibold bg-surface border border-line hover:bg-gray-100 text-secondary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={actionProcessing}
                className="px-4 py-2 text-xs font-bold bg-danger hover:bg-danger/90 text-white rounded-lg shadow-xs transition-colors"
              >
                {actionProcessing ? "Processing..." : "Confirm Rejection"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
