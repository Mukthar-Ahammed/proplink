"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FlipperOfferStatus } from "@/generated/prisma/enums";
import { FlipperWorkspaceSummary } from "@/services/flipper/flipperService";

export function FlipperWorkspaceClient() {
  const [workspace, setWorkspace] = useState<FlipperWorkspaceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"OPPORTUNITIES" | "OFFERS" | "ACQUISITIONS">(
    "OPPORTUNITIES",
  );

  // Offer Submission Modal
  const [offerPropertyId, setOfferPropertyId] = useState<string | null>(null);
  const [offerPropertyTitle, setOfferPropertyTitle] = useState<string>("");
  const [offerAskingPrice, setOfferAskingPrice] = useState<number>(0);
  const [offerAmountInput, setOfferAmountInput] = useState<string>("");
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [offerFeedback, setOfferFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const fetchWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/investor/flip/workspace");
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load Flipper workspace");
      }
      const data = await res.json();
      setWorkspace(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchWorkspace();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchWorkspace]);

  const openOfferModal = (propertyId: string, title: string, pricePence: number) => {
    setOfferPropertyId(propertyId);
    setOfferPropertyTitle(title);
    setOfferAskingPrice(pricePence);
    setOfferAmountInput((pricePence / 100).toString());
    setOfferFeedback(null);
  };

  const closeOfferModal = () => {
    setOfferPropertyId(null);
    setOfferFeedback(null);
  };

  const handleOfferSubmit = async () => {
    if (!offerPropertyId) return;

    const parsedGbp = parseFloat(offerAmountInput);
    if (isNaN(parsedGbp) || parsedGbp <= 0) {
      setOfferFeedback({
        type: "error",
        message: "Please enter a valid positive offer amount in £.",
      });
      return;
    }

    const amountPence = Math.round(parsedGbp * 100);

    setOfferSubmitting(true);
    setOfferFeedback(null);
    try {
      const res = await fetch("/api/investor/flip/offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: offerPropertyId, amountGBP: amountPence }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to submit offer");

      setOfferFeedback({
        type: "success",
        message: "Acquisition offer successfully submitted to the agent!",
      });
      fetchWorkspace();
      setTimeout(closeOfferModal, 1500);
    } catch (err: unknown) {
      setOfferFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Offer submission failed",
      });
    } finally {
      setOfferSubmitting(false);
    }
  };

  const handleWithdrawOffer = async (offerId: string) => {
    if (!confirm("Are you sure you want to withdraw this acquisition offer?")) return;
    try {
      const res = await fetch(`/api/investor/flip/offers/${offerId}/withdraw`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to withdraw offer");
      fetchWorkspace();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error withdrawing offer");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-primary">Property Flipper Workspace</h1>
        <p className="text-sm text-muted">
          Track property opportunities, submit acquisition offers, and manage your
          refurbishment pipeline.
        </p>
      </div>

      {/* KYC Lock Warning Banner if not approved */}
      {workspace && !workspace.isKycApproved && (
        <div className="bg-warning/10 border border-warning/30 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2 text-warning font-bold text-sm">
              <span>🔒 KYC Identity Verification Required</span>
            </div>
            <p className="text-xs text-warning">
              You can evaluate property opportunities, but submitting binding Flipper
              acquisition offers requires approved identity verification.
            </p>
          </div>
          <Link
            href="/investor/kyc"
            className="px-4 py-2 bg-warning hover:bg-warning text-white text-xs font-bold rounded-lg transition-colors whitespace-nowrap shadow-sm"
          >
            Complete KYC Verification →
          </Link>
        </div>
      )}

      {/* Workspace Tabs */}
      <div className="bg-white p-4 rounded-xl border border-line shadow-sm space-y-4">
        <div className="flex border-b border-line space-x-4">
          <button
            onClick={() => setActiveTab("OPPORTUNITIES")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "OPPORTUNITIES"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-body"
            }`}
          >
            Evaluated Opportunities ({workspace?.opportunities.length ?? 0})
          </button>
          <button
            onClick={() => setActiveTab("OFFERS")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "OFFERS"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-body"
            }`}
          >
            Submitted Acquisition Offers ({workspace?.offers.length ?? 0})
          </button>
          <button
            onClick={() => setActiveTab("ACQUISITIONS")}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "ACQUISITIONS"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-body"
            }`}
          >
            Confirmed Acquisitions ({workspace?.acquisitions.length ?? 0})
          </button>
        </div>

        {/* Tab Contents */}
        {loading ? (
          <div className="py-12 text-center text-muted text-sm">
            Loading Flipper workspace...
          </div>
        ) : error ? (
          <div className="p-4 bg-danger/10 text-danger text-sm rounded-lg">{error}</div>
        ) : (
          <div>
            {/* Opportunities Tab */}
            {activeTab === "OPPORTUNITIES" && (
              <div className="space-y-4">
                {workspace?.opportunities.length === 0 ? (
                  <div className="text-center py-12 bg-surface rounded-lg border border-dashed border-line text-muted text-sm space-y-3">
                    <p>
                      No evaluated property opportunities in your Flipper workspace yet.
                    </p>
                    <Link
                      href="/buy"
                      className="inline-block px-4 py-2 bg-accent text-white text-xs font-bold rounded-lg hover:bg-accent-strong"
                    >
                      Browse Available Marketplace Properties →
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {workspace?.opportunities.map((opp) => (
                      <div
                        key={opp.id}
                        className="bg-white border border-line rounded-xl p-4 shadow-sm space-y-3 flex flex-col justify-between"
                      >
                        <div className="space-y-2">
                          <div className="flex justify-between items-start">
                            <h3 className="font-bold text-primary text-base">
                              {opp.propertyTitle}
                            </h3>
                            <span className="text-xs px-2 py-0.5 rounded font-semibold bg-pale text-accent">
                              {opp.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted">
                            {opp.city}, {opp.postcode} • {opp.propertyType}
                          </p>
                          <div className="text-lg font-extrabold text-accent">
                            £{(opp.askingPriceGBP / 100).toLocaleString("en-GB")}
                          </div>
                        </div>

                        <div className="pt-3 border-t border-line flex items-center justify-between gap-2">
                          <Link
                            href={`/buy/${opp.propertyId}`}
                            className="text-xs text-accent hover:underline font-medium"
                          >
                            View Property Details
                          </Link>
                          {workspace.isKycApproved ? (
                            <button
                              onClick={() =>
                                openOfferModal(
                                  opp.propertyId,
                                  opp.propertyTitle,
                                  opp.askingPriceGBP,
                                )
                              }
                              className="px-3 py-1.5 bg-accent hover:bg-accent-strong text-white text-xs font-bold rounded-lg shadow-sm"
                            >
                              Submit Acquisition Offer
                            </button>
                          ) : (
                            <Link
                              href="/investor/kyc"
                              className="px-3 py-1.5 bg-warning/10 text-warning hover:bg-warning/20 text-xs font-bold rounded-lg"
                            >
                              🔒 KYC Required
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Offers Tab */}
            {activeTab === "OFFERS" && (
              <div className="space-y-4">
                {workspace?.offers.length === 0 ? (
                  <div className="text-center py-12 bg-surface rounded-lg border border-dashed border-line text-muted text-sm">
                    No acquisition offers submitted yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-line rounded-lg">
                    <table className="min-w-full divide-y divide-line text-sm">
                      <thead className="bg-surface">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-muted">
                            Property
                          </th>
                          <th className="px-4 py-3 text-left font-semibold text-muted">
                            Offer Amount
                          </th>
                          <th className="px-4 py-3 text-left font-semibold text-muted">
                            Submitted Date
                          </th>
                          <th className="px-4 py-3 text-left font-semibold text-muted">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right font-semibold text-muted">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line bg-white">
                        {workspace?.offers.map((off) => (
                          <tr key={off.id}>
                            <td className="px-4 py-3 font-semibold text-primary">
                              {off.propertyTitle}
                            </td>
                            <td className="px-4 py-3 font-bold text-accent">
                              £{(off.amountGBP / 100).toLocaleString("en-GB")}
                            </td>
                            <td className="px-4 py-3 text-xs text-muted">
                              {new Date(off.submittedAt).toLocaleDateString("en-GB")}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-full ${
                                  off.status === FlipperOfferStatus.SUBMITTED
                                    ? "bg-pale text-accent"
                                    : off.status === FlipperOfferStatus.ACCEPTED
                                      ? "bg-success/10 text-success"
                                      : off.status === FlipperOfferStatus.REJECTED
                                        ? "bg-danger/10 text-danger"
                                        : "bg-surface text-primary"
                                }`}
                              >
                                {off.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              {off.status === FlipperOfferStatus.SUBMITTED && (
                                <button
                                  onClick={() => handleWithdrawOffer(off.id)}
                                  className="text-xs text-danger hover:text-danger font-semibold"
                                >
                                  Withdraw Offer
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Acquisitions Tab */}
            {activeTab === "ACQUISITIONS" && (
              <div className="space-y-4">
                {workspace?.acquisitions.length === 0 ? (
                  <div className="text-center py-12 bg-surface rounded-lg border border-dashed border-line text-muted text-sm">
                    No confirmed acquisitions yet. When an agent accepts your Flipper
                    offer, it will appear here.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {workspace?.acquisitions.map((acq) => (
                      <div
                        key={acq.id}
                        className="bg-white border-2 border-success/30 rounded-xl p-5 shadow-sm space-y-3"
                      >
                        <div className="flex justify-between items-start">
                          <h3 className="font-bold text-primary text-base">
                            {acq.propertyTitle}
                          </h3>
                          <span className="px-2.5 py-1 text-xs font-extrabold bg-success/10 text-success rounded-full">
                            {acq.status}
                          </span>
                        </div>
                        <div className="text-sm text-muted">
                          Agreed Price:{" "}
                          <strong className="text-success font-bold">
                            £{(acq.agreedPriceGBP / 100).toLocaleString("en-GB")}
                          </strong>
                        </div>
                        <div className="p-3 bg-success/10 rounded border border-success/30 text-xs text-success">
                          ✓ Flipper Acquisition Boundary Confirmed. Refurbishment tracking
                          and capex management will unlock in Phase 7.
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Offer Submission Modal */}
      {offerPropertyId && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-line">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-primary text-lg">
                  Submit Flipper Acquisition Offer
                </h3>
                <p className="text-xs text-muted">{offerPropertyTitle}</p>
              </div>
              <button
                onClick={closeOfferModal}
                className="text-muted hover:text-muted font-bold"
              >
                ✕
              </button>
            </div>

            {offerFeedback && (
              <div
                className={`p-3 rounded-md text-xs font-semibold ${
                  offerFeedback.type === "success"
                    ? "bg-success/10 text-success border border-success/30"
                    : "bg-danger/10 text-danger border border-danger/30"
                }`}
              >
                {offerFeedback.message}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  Asking Price
                </label>
                <div className="text-sm font-bold text-primary">
                  £{(offerAskingPrice / 100).toLocaleString("en-GB")}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-body mb-1">
                  Your Acquisition Offer Amount (£) <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  step="1000"
                  min="1"
                  value={offerAmountInput}
                  onChange={(e) => setOfferAmountInput(e.target.value)}
                  className="w-full text-sm border-line rounded-md shadow-sm focus:ring-accent focus:border-accent"
                  placeholder="e.g. 250000"
                />
              </div>

              <div className="p-3 bg-pale rounded text-xs text-accent border border-line">
                Notice: Submitting an acquisition offer signals intent to acquire for
                property refurbishment. No funds move at this stage.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={closeOfferModal}
                className="px-4 py-2 bg-line text-primary text-xs font-semibold rounded-lg hover:bg-line"
              >
                Cancel
              </button>
              <button
                onClick={handleOfferSubmit}
                disabled={offerSubmitting}
                className="px-4 py-2 bg-accent text-white text-xs font-bold rounded-lg hover:bg-accent-strong shadow-sm"
              >
                {offerSubmitting ? "Submitting..." : "Confirm & Submit Offer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
