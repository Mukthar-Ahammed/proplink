"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  KycSubmissionStatus,
} from "@/generated/prisma/enums";
import type { AdminKycSubmissionDetail } from "@/services/admin/kycAdminService";
import { KYC_REJECTION_REASONS } from "@/services/admin/kycConstants";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AdminBreadcrumbs } from "@/components/admin/AdminBreadcrumbs";

export function KycReviewStudioClient({
  submissionId,
  initialData,
  currentAdminUserId,
}: {
  submissionId: string;
  initialData: AdminKycSubmissionDetail;
  currentAdminUserId: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<AdminKycSubmissionDetail>(initialData);

  // Document preview state
  const [selectedDocId, setSelectedDocId] = useState<string | null>(
    initialData.documents[0]?.id ?? null,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Decision Modal state
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReasonCode, setRejectionReasonCode] = useState<string>("DOCUMENT_UNREADABLE");
  const [rejectionExplanation, setRejectionExplanation] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [actionProcessing, setActionProcessing] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error" | "warning";
    message: string;
  } | null>(null);

  // Refresh submission detail
  const refreshDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/kyc/${submissionId}`);
      if (res.ok) {
        const data = await res.json();
        setDetail(data);
      }
    } catch (err) {
      console.error("Failed to refresh detail:", err);
    }
  }, [submissionId]);

  // Load presigned URL whenever selected doc changes
  const loadDocumentPreview = useCallback(async (docId: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewUrl(null);
    try {
      const res = await fetch(`/api/admin/kyc/documents/${docId}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Document access denied");
      }
      setPreviewUrl(json.url);
    } catch (err: unknown) {
      setPreviewError(err instanceof Error ? err.message : "Failed to load document preview");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedDocId) return;
    const timer = window.setTimeout(() => {
      void loadDocumentPreview(selectedDocId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedDocId, loadDocumentPreview]);

  // Handle Approve
  const handleApprove = async () => {
    setActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/admin/kyc/${submissionId}/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error?.includes("no longer pending") || json.error?.includes("race condition")) {
          setActionFeedback({
            type: "warning",
            message: "This submission has already been reviewed by another Admin. Refreshing state...",
          });
          await refreshDetail();
          setShowApproveModal(false);
          return;
        }
        throw new Error(json.error || "Approval failed");
      }

      setActionFeedback({
        type: "success",
        message: "KYC Application APPROVED! Investor authorization updated to APPROVED.",
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

  // Handle Reject
  const handleReject = async () => {
    const fullReason =
      rejectionReasonCode === "OTHER"
        ? rejectionExplanation.trim()
        : `${rejectionReasonCode}: ${rejectionExplanation.trim() || "Requirements not met."}`;

    if (fullReason.length < 5) {
      setActionFeedback({
        type: "error",
        message: "Please provide a valid rejection explanation (at least 5 characters).",
      });
      return;
    }

    setActionProcessing(true);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/admin/kyc/${submissionId}/reject`, {
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
            message: "This submission has already been reviewed by another Admin. Refreshing state...",
          });
          await refreshDetail();
          setShowRejectModal(false);
          return;
        }
        throw new Error(json.error || "Rejection failed");
      }

      setActionFeedback({
        type: "success",
        message: "KYC Application REJECTED. Investor notified with user-visible explanation.",
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

  const selectedDoc = detail.documents.find((d) => d.id === selectedDocId);
  const isSelf = currentAdminUserId === detail.userId;
  const isPending = detail.submissionStatus === KycSubmissionStatus.SUBMITTED;

  const waitingAgeText = detail.submittedAt
    ? formatAge(new Date(detail.submittedAt).toISOString())
    : "Draft";

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <AdminBreadcrumbs
        items={[
          { label: "Admin", href: "/admin" },
          { label: "KYC Queue", href: "/admin/kyc" },
          { label: `Review: ${detail.investorName}` },
        ]}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-primary">Compliance Review Studio</h1>
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-surface border border-line text-muted">
              Attempt #{detail.attemptNumber}
            </span>
          </div>
          <p className="text-xs text-muted mt-1">
            Investor: <strong className="text-primary">{detail.investorName}</strong> ({detail.investorEmail}) — Submission ID: <code className="text-xs">{detail.id}</code>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={detail.submissionStatus} />
          <StatusBadge status={detail.profileKycStatus} />
          <Link
            href="/admin/kyc"
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
        {/* ── LEFT COLUMN: Document Review Studio (7 Cols) ────────────────── */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Attached Documents ({detail.documents.length})
            </h2>

            {/* Document Selector List */}
            {detail.documents.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted border border-dashed rounded-lg">
                No documents uploaded for this submission attempt.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 border-b border-line pb-3">
                {detail.documents.map((doc) => {
                  const active = doc.id === selectedDocId;
                  return (
                    <button
                      key={doc.id}
                      onClick={() => setSelectedDocId(doc.id)}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all text-left flex flex-col ${
                        active
                          ? "bg-accent/10 border-accent text-accent shadow-xs"
                          : "bg-surface border-line text-secondary hover:border-gray-300"
                      }`}
                    >
                      <span className="font-bold uppercase">{doc.kind}</span>
                      <span className="text-[10px] text-muted truncate max-w-[140px]">
                        {(doc.sizeBytes / 1024).toFixed(0)} KB · {doc.contentType.split("/")[1] ?? doc.contentType}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Document Inline Viewer Panel */}
            {selectedDoc && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-muted bg-surface p-2.5 rounded-lg border border-line">
                  <div>
                    <span className="font-bold text-primary">{selectedDoc.kind}</span> ({selectedDoc.contentType})
                  </div>
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline font-semibold"
                    >
                      Open full preview ↗
                    </a>
                  )}
                </div>

                <div className="min-h-[420px] bg-gray-900 rounded-lg border border-line flex items-center justify-center overflow-hidden relative">
                  {previewLoading ? (
                    <div className="text-xs text-gray-300 flex items-center gap-2">
                      <span className="animate-spin text-lg">⏳</span> Loading secure preview...
                    </div>
                  ) : previewError ? (
                    <div className="p-6 text-center text-xs text-red-300 space-y-2">
                      <p className="font-bold">Document preview unavailable</p>
                      <p className="text-gray-400">{previewError}</p>
                      <button
                        onClick={() => selectedDocId && loadDocumentPreview(selectedDocId)}
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded font-semibold transition-colors"
                      >
                        Retry Preview
                      </button>
                    </div>
                  ) : previewUrl ? (
                    selectedDoc.contentType.startsWith("image/") ? (
                      /* Image inline viewer */
                      <div className="w-full h-full p-2 flex items-center justify-center overflow-auto max-h-[500px]">
                        <Image
                          src={previewUrl}
                          alt={`${selectedDoc.kind} preview`}
                          width={600}
                          height={480}
                          unoptimized
                          className="max-w-full max-h-[480px] object-contain rounded shadow"
                        />
                      </div>
                    ) : selectedDoc.contentType === "application/pdf" ? (
                      /* PDF inline viewer */
                      <iframe
                        src={previewUrl}
                        title={`PDF Preview - ${selectedDoc.kind}`}
                        className="w-full h-[480px] rounded border-0"
                      />
                    ) : (
                      /* Generic File preview fallback */
                      <div className="p-8 text-center text-xs text-gray-300 space-y-3">
                        <p>Inline preview not supported for media type: {selectedDoc.contentType}</p>
                        <a
                          href={previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block px-4 py-2 bg-accent text-white rounded font-bold hover:bg-accent/90"
                        >
                          Download / View File
                        </a>
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT COLUMN: Investor Profile, Attempt History & Decision Controls (5 Cols) ─ */}
        <div className="lg:col-span-5 space-y-4">
          {/* Section 1: Investor Summary */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Investor Overview
            </h2>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Name</span>
                <span className="font-semibold text-primary">{detail.investorName}</span>
              </div>
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Subtype</span>
                <span className="font-bold text-accent">{detail.investorType ?? "NOT_SET"}</span>
              </div>
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Account</span>
                <span className={`font-semibold ${detail.accountActive ? "text-success" : "text-danger"}`}>
                  {detail.accountActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="bg-surface p-2.5 rounded border border-line">
                <span className="text-[10px] text-muted font-bold uppercase block">Waiting Time</span>
                <span className="font-semibold text-primary">{waitingAgeText}</span>
              </div>
            </div>
          </div>

          {/* Section 2: Declaration */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Investor Declaration
            </h2>
            <div className="p-3 bg-surface border border-line rounded-lg text-xs italic text-secondary leading-relaxed">
              &quot;{detail.declaration || "No declaration provided."}&quot;
            </div>
          </div>

          {/* Section 3: Attempt History */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Submission History ({detail.attemptsHistory.length})
            </h2>

            <div className="space-y-2 max-h-56 overflow-y-auto">
              {detail.attemptsHistory.map((att) => (
                <div
                  key={att.id}
                  className={`p-3 rounded-lg border text-xs space-y-1 transition-colors ${
                    att.isCurrent
                      ? "bg-accent/5 border-accent/40"
                      : "bg-surface border-line"
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-primary">Attempt #{att.attemptNumber}</span>
                      {att.isCurrent && (
                        <span className="text-[9px] font-bold bg-accent text-white px-1.5 py-0.2 rounded uppercase">
                          Current
                        </span>
                      )}
                    </div>
                    <StatusBadge status={att.status} />
                  </div>
                  <div className="text-[11px] text-muted">
                    {att.submittedAt
                      ? `Submitted: ${new Date(att.submittedAt).toLocaleDateString("en-GB")}`
                      : "Draft"}
                    {att.reviewedAt && ` · Reviewed: ${new Date(att.reviewedAt).toLocaleDateString("en-GB")}`}
                  </div>
                  {att.rejectionReason && (
                    <div className="text-[11px] text-danger bg-danger/5 p-1.5 rounded border border-danger/20">
                      <strong>Rejection:</strong> {att.rejectionReason}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Section 4: Decision Controls */}
          <div className="bg-white rounded-xl border border-line p-4 shadow-xs space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted">
              Compliance Decision
            </h2>

            {!isPending ? (
              <div className="p-4 bg-surface border border-line rounded-lg space-y-2 text-xs">
                <div className="font-bold text-primary">Review Completed</div>
                <div className="text-muted">
                  Decision outcome: <strong className="text-primary">{detail.submissionStatus}</strong>
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
            ) : isSelf ? (
              <div className="p-4 bg-warning/10 border border-warning/30 rounded-lg text-xs text-warning font-semibold">
                ⚠️ Anti-Self Approval Policy: As the owner of this submission, you cannot approve or reject your own KYC application. Decision controls are disabled.
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-muted">
                  Review the attached documents and investor declaration. Approval unlocks financial actions for <strong className="text-primary">{detail.investorType}</strong>. Rejection requires a safe explanation.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setShowApproveModal(true)}
                    className="py-2.5 px-4 bg-success hover:bg-success/90 text-white font-bold rounded-lg shadow-xs text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>✓</span> Approve KYC
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    className="py-2.5 px-4 bg-danger hover:bg-danger/90 text-white font-bold rounded-lg shadow-xs text-xs transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>✕</span> Reject KYC
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
            <h3 className="text-base font-bold text-primary">Confirm KYC Approval</h3>
            <p className="text-xs text-muted leading-relaxed">
              Are you sure you want to approve Investor <strong className="text-primary">{detail.investorName}</strong>?
              <br />
              This will update their Profile KYC Status to <strong className="text-success">APPROVED</strong> and unlock financial eligibility for <strong className="text-primary">{detail.investorType}</strong>.
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
                {actionProcessing ? "Processing..." : "Confirm & Authorize"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECTION MODAL ─────────────────────────────────────────────────── */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 space-y-4 border border-line">
            <h3 className="text-base font-bold text-danger">Reject KYC Submission</h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-primary mb-1 uppercase text-[10px]">
                  Rejection Category Presets
                </label>
                <select
                  value={rejectionReasonCode}
                  onChange={(e) => setRejectionReasonCode(e.target.value)}
                  className="w-full text-xs border border-line rounded-lg p-2 focus:ring-accent focus:border-accent"
                >
                  {KYC_REJECTION_REASONS.map((code) => (
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
                  placeholder="Provide a clear, safe explanation for the investor..."
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
