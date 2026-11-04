"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PropertyStatus } from "@/generated/prisma/enums";
import type { ModerationListing } from "@/services/listings/moderationService";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AdminBreadcrumbs } from "@/components/admin/AdminBreadcrumbs";
import { formatPenceGBP } from "@/components/listings/wizardTypes";

export function ListingReviewStudioClient({
  propertyId,
  initialData,
  currentAdminUserId,
}: {
  propertyId: string;
  initialData: ModerationListing;
  currentAdminUserId: string;
}) {
  const router = useRouter();
  const [listing, setListing] = useState<ModerationListing>(initialData);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  // Decision Modal state
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [actionProcessing, setActionProcessing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  const refreshListing = async () => {
    try {
      const res = await fetch(`/api/admin/listings/${propertyId}`);
      if (res.ok) {
        const data = await res.json();
        setListing(data);
      }
    } catch (err) {
      console.error("Failed to refresh listing:", err);
    }
  };

  const handleApprove = async () => {
    setActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/admin/listings/${propertyId}/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Approval failed");
      }

      setActionFeedback({
        type: "success",
        message: "Listing APPROVED! Property status updated to LIVE on public marketplace.",
      });
      setShowApproveModal(false);
      await refreshListing();
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
    if (rejectionReason.trim().length < 5) {
      setActionFeedback({
        type: "error",
        message: "Please provide a valid rejection explanation (minimum 5 characters).",
      });
      return;
    }

    setActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/admin/listings/${propertyId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectionReason.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Rejection failed");
      }

      setActionFeedback({
        type: "success",
        message: "Listing REJECTED. Sent back to Agent DRAFT with rejection reason.",
      });
      setShowRejectModal(false);
      await refreshListing();
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

  const isPending = listing.status === PropertyStatus.PENDING_REVIEW;
  const isSelfAgent = listing.agentProfile?.user.id === currentAdminUserId;
  const currentImage = listing.images[selectedImageIndex]?.url;

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <AdminBreadcrumbs
        items={[
          { label: "Admin", href: "/admin" },
          { label: "Listing Moderation", href: "/admin/moderation" },
          { label: `Review: ${listing.title}` },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-primary">Agent Listing Moderation Studio</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-surface border border-line text-muted uppercase">
              Source: {listing.listingSource}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Agent: <strong className="text-primary">{listing.agentProfile?.user.name ?? "Unknown"}</strong> ({listing.agentProfile?.agencyName ?? "Independent"}) — ID: <code className="text-xs">{listing.id}</code>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={listing.status} />
          <Link
            href="/admin/moderation"
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-white hover:bg-surface text-secondary transition-colors"
          >
            ← Back to Queue
          </Link>
        </div>
      </div>

      {/* Feedback Banner */}
      {actionFeedback && (
        <div
          className={`p-4 rounded-lg text-sm border font-medium ${
            actionFeedback.type === "success"
              ? "bg-success/10 border-success/30 text-success"
              : actionFeedback.type === "warning"
              ? "bg-warning/10 border-warning/30 text-warning"
              : "bg-danger/10 border-danger/30 text-danger"
          }`}
        >
          {actionFeedback.message}
        </div>
      )}

      {/* Main Studio Grid: 2 Columns on Desktop, Stacked on Mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ── LEFT COLUMN: Property & Media Gallery (7 Cols) ────────────────── */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Property Overview & Supplied Media
            </h2>

            {/* Main Image Viewer */}
            <div className="min-h-[360px] bg-gray-900 rounded-lg border border-line flex items-center justify-center overflow-hidden relative">
              {currentImage ? (
                /* eslint-disable-next-html-element-suppress */
                <img
                  src={currentImage}
                  alt={`Listing image ${selectedImageIndex + 1}`}
                  className="max-w-full max-h-[380px] object-contain rounded"
                />
              ) : (
                <div className="text-xs text-muted">No property images uploaded.</div>
              )}
            </div>

            {/* Gallery Thumbnails */}
            {listing.images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {listing.images.map((img, idx) => (
                  <button
                    key={img.url}
                    onClick={() => setSelectedImageIndex(idx)}
                    className={`h-16 w-20 rounded-lg overflow-hidden border-2 transition-all ${
                      selectedImageIndex === idx ? "border-accent shadow-xs" : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    {/* eslint-disable-next-html-element-suppress */}
                    <img src={img.url} alt={`Thumbnail ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            {/* Supporting Evidence Documents (Explicitly Labeled "Agent Supplied") */}
            <div className="pt-2 border-t border-line space-y-2 text-xs">
              <span className="font-bold text-muted uppercase text-[10px]">
                Supporting Evidence Documents (Agent Supplied)
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2.5 bg-surface rounded border border-line flex items-center justify-between">
                  <span>EPC Certificate:</span>
                  {listing.epcCertUrl ? (
                    <a href={listing.epcCertUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline font-semibold">
                      View Document ↗
                    </a>
                  ) : (
                    <span className="text-muted">Not provided</span>
                  )}
                </div>
                <div className="p-2.5 bg-surface rounded border border-line flex items-center justify-between">
                  <span>Floor Plan:</span>
                  {listing.floorPlanUrl ? (
                    <a href={listing.floorPlanUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline font-semibold">
                      View Document ↗
                    </a>
                  ) : (
                    <span className="text-muted">Not provided</span>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted italic">
                Note: All certificates and floor plans above are agent-supplied supporting evidence and have not been independently verified with external registries.
              </p>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN: Property Details & Decision Controls (5 Cols) ───── */}
        <div className="lg:col-span-5 space-y-4">
          {/* Section 1: Listing Particulars */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Listing Particulars
            </h2>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Asking Price</span>
                <span className="font-extrabold text-primary text-sm">{formatPenceGBP(listing.askingPriceGBP)}</span>
              </div>
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Property Type</span>
                <span className="font-bold text-primary">{listing.propertyType}</span>
              </div>
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Bedrooms</span>
                <span className="font-bold text-primary">{listing.bedrooms} Beds</span>
              </div>
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Target ROI</span>
                <span className="font-bold text-accent">{listing.targetRoiPct != null ? `${listing.targetRoiPct}%` : "—"}</span>
              </div>
            </div>

            <div className="bg-surface p-2.5 rounded border border-line text-xs">
              <span className="text-[10px] text-muted font-bold uppercase block">Full Address</span>
              <span className="font-medium text-primary">
                {listing.addressLine1}, {listing.city}, {listing.region}, {listing.postcode}
              </span>
            </div>

            <div>
              <span className="text-[10px] text-muted font-bold uppercase block mb-1">Description</span>
              <div className="p-3 bg-surface border border-line rounded-lg text-xs text-secondary leading-relaxed whitespace-pre-wrap">
                {listing.description}
              </div>
            </div>
          </div>

          {/* Section 2: Agent Context */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Agent & Agency Context
            </h2>
            <div className="text-xs space-y-1 text-secondary">
              <div>Agent Name: <strong className="text-primary">{listing.agentProfile?.user.name ?? "Platform"}</strong></div>
              <div>Agent Email: <strong className="text-primary">{listing.agentProfile?.user.email ?? "—"}</strong></div>
              <div>Agency Name: <strong className="text-accent">{listing.agentProfile?.agencyName ?? "Independent"}</strong></div>
            </div>
          </div>

          {/* Section 3: Compliance Decision */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Moderation Decision
            </h2>

            {!isPending ? (
              <div className="p-4 bg-surface border border-line rounded-lg space-y-2 text-xs">
                <div className="font-bold text-primary">Moderation Completed</div>
                <div className="text-muted">
                  Status: <strong className="text-primary">{listing.status}</strong>
                </div>
                {listing.rejectionReason && (
                  <div className="text-danger bg-danger/5 p-2 rounded border border-danger/20 font-medium">
                    <strong>Rejection Reason:</strong> {listing.rejectionReason}
                  </div>
                )}
              </div>
            ) : isSelfAgent ? (
              <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning font-semibold">
                ⚠️ Anti-Self Approval Policy: You cannot approve or reject a listing created by your own Agent account. Decision controls are disabled.
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  Review the property details, asking price, and supplied media. Approving will publish the property LIVE onto the public deal marketplace.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setShowApproveModal(true)}
                    className="py-2.5 px-4 bg-success hover:bg-success/90 text-white font-bold rounded-lg shadow-xs text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>✓</span> Approve Listing
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    className="py-2.5 px-4 bg-danger hover:bg-danger/90 text-white font-bold rounded-lg shadow-xs text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>✕</span> Reject Listing
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
            <h3 className="text-base font-bold text-primary">Confirm Listing Approval</h3>
            <p className="text-xs text-muted leading-relaxed">
              Are you sure you want to approve property <strong className="text-primary">{listing.title}</strong>?
              <br />
              This listing will transition to <strong className="text-success">LIVE</strong> and become immediately discoverable on the public PropLink marketplace.
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
                {actionProcessing ? "Processing..." : "Confirm & Publish LIVE"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECTION MODAL ─────────────────────────────────────────────────── */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 border border-line">
            <h3 className="text-base font-bold text-danger">Reject Listing</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-primary mb-1 uppercase text-[10px]">
                  Agent-Visible Rejection Reason <span className="text-danger">* (Required)</span>
                </label>
                <textarea
                  rows={3}
                  placeholder="Provide feedback explaining why the listing was rejected (e.g. Inaccurate asking price, missing EPC certificate)..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
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
