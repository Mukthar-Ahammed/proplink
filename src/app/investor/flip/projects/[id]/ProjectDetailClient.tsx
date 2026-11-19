"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FlipperCostCategory, FlipperMilestoneStatus } from "@/generated/prisma/enums";
import { FlipperProjectDetail } from "@/services/flipper/flipperProjectService";

export function ProjectDetailClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<FlipperProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add Cost Modal
  const [showCostModal, setShowCostModal] = useState(false);
  const [costCategory, setCostCategory] = useState<FlipperCostCategory>(
    FlipperCostCategory.MATERIALS,
  );
  const [costDescription, setCostDescription] = useState("");
  const [costAmountInput, setCostAmountInput] = useState("");
  const [costSubmitting, setCostSubmitting] = useState(false);

  // Add Milestone Modal
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDesc, setMilestoneDesc] = useState("");
  const [milestoneSubmitting, setMilestoneSubmitting] = useState(false);

  const fetchProject = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/investor/flip/projects/${projectId}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to load refurbishment project");
      }
      const data = await res.json();
      setProject(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error loading project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchProject();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchProject]);

  const handleAddCost = async () => {
    const amountGbp = parseFloat(costAmountInput);
    if (isNaN(amountGbp) || amountGbp <= 0) {
      alert("Please enter a valid positive cost amount in £.");
      return;
    }
    if (!costDescription.trim()) {
      alert("Please enter a cost description.");
      return;
    }

    setCostSubmitting(true);
    try {
      const res = await fetch(`/api/investor/flip/projects/${projectId}/costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: costCategory,
          description: costDescription.trim(),
          amountGBP: Math.round(amountGbp * 100),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add cost");

      setShowCostModal(false);
      setCostDescription("");
      setCostAmountInput("");
      fetchProject();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error adding cost");
    } finally {
      setCostSubmitting(false);
    }
  };

  const handleDeleteCost = async (costId: string) => {
    if (!confirm("Are you sure you want to delete this cost entry?")) return;
    try {
      const res = await fetch(
        `/api/investor/flip/projects/${projectId}/costs?costId=${costId}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to delete cost");
      }
      fetchProject();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error deleting cost");
    }
  };

  const handleAddMilestone = async () => {
    if (!milestoneTitle.trim()) {
      alert("Please enter a milestone title.");
      return;
    }

    setMilestoneSubmitting(true);
    try {
      const res = await fetch(`/api/investor/flip/projects/${projectId}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: milestoneTitle.trim(),
          description: milestoneDesc.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to add milestone");

      setShowMilestoneModal(false);
      setMilestoneTitle("");
      setMilestoneDesc("");
      fetchProject();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error adding milestone");
    } finally {
      setMilestoneSubmitting(false);
    }
  };

  const handleToggleMilestone = async (
    milestoneId: string,
    currentStatus: FlipperMilestoneStatus,
  ) => {
    const nextStatus =
      currentStatus === FlipperMilestoneStatus.COMPLETED
        ? FlipperMilestoneStatus.TODO
        : FlipperMilestoneStatus.COMPLETED;

    try {
      const res = await fetch(`/api/investor/flip/projects/${projectId}/milestones`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ milestoneId, status: nextStatus }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to update milestone");
      }
      fetchProject();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error updating milestone");
    }
  };

  if (loading) {
    return (
      <div className="py-12 text-center text-muted text-sm">
        Loading refurbishment project...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="p-4 bg-danger/10 text-danger rounded-lg text-sm space-y-2">
        <div>{error || "Project not found"}</div>
        <Link
          href="/investor/flip"
          className="text-xs text-danger underline font-semibold"
        >
          ← Return to Flipper Workspace
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Navigation breadcrumb */}
      <div className="flex items-center justify-between">
        <Link
          href="/investor/flip"
          className="text-xs text-accent hover:underline font-semibold"
        >
          ← Back to Flipper Workspace
        </Link>
        <span className="px-3 py-1 bg-pale text-accent rounded-full text-xs font-bold">
          Project Status: {project.status}
        </span>
      </div>

      {/* Property Title & Location */}
      <div className="bg-white p-6 rounded-xl border border-line shadow-sm space-y-2">
        <h1 className="text-2xl font-bold text-primary">{project.propertyTitle}</h1>
        <p className="text-sm text-muted">
          {project.city}, {project.postcode} • Agreed Acquisition Price:{" "}
          <strong className="text-primary">
            £{(project.agreedPriceGBP / 100).toLocaleString("en-GB")}
          </strong>
        </p>
      </div>

      {/* Budget Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-line shadow-sm space-y-1">
          <div className="text-xs font-semibold text-muted uppercase">
            Planned Refurb Budget
          </div>
          <div className="text-xl font-extrabold text-primary">
            £{(project.plannedBudgetGBP / 100).toLocaleString("en-GB")}
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-line shadow-sm space-y-1">
          <div className="text-xs font-semibold text-muted uppercase">
            Recorded Actual Costs
          </div>
          <div className="text-xl font-extrabold text-accent">
            £{(project.totalCostsGBP / 100).toLocaleString("en-GB")}
          </div>
        </div>

        <div
          className={`p-5 rounded-xl border shadow-sm space-y-1 ${
            project.isOverBudget
              ? "bg-danger/10 border-danger/30 text-danger"
              : "bg-success/10 border-success/30 text-success"
          }`}
        >
          <div className="text-xs font-semibold uppercase">
            {project.isOverBudget ? "Over Budget By" : "Remaining Budget"}
          </div>
          <div className="text-xl font-extrabold">
            £{Math.abs(project.remainingBudgetGBP / 100).toLocaleString("en-GB")}
          </div>
        </div>
      </div>

      {/* Grid: Costs Ledger & Milestones */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost Ledger Card */}
        <div className="bg-white p-5 rounded-xl border border-line shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <h2 className="font-bold text-primary text-base">
              Cost Ledger ({project.costs.length})
            </h2>
            <button
              onClick={() => setShowCostModal(true)}
              className="px-3 py-1.5 bg-accent hover:bg-accent-strong text-white text-xs font-bold rounded-lg shadow-sm"
            >
              + Add Cost Item
            </button>
          </div>

          {project.costs.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted italic">
              No costs recorded yet. Add materials, labour, or fee items to track your
              refurbishment spend.
            </div>
          ) : (
            <div className="space-y-2">
              {project.costs.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-3 border border-line rounded-lg hover:bg-surface transition-colors text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-primary">{c.description}</div>
                    <div className="text-[10px] text-muted">
                      <span className="font-bold text-muted">{c.category}</span> •
                      Incurred {new Date(c.incurredAt).toLocaleDateString("en-GB")}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="font-bold text-primary text-sm">
                      £{(c.amountGBP / 100).toLocaleString("en-GB")}
                    </div>
                    <button
                      onClick={() => handleDeleteCost(c.id)}
                      className="text-danger hover:text-danger font-bold"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Milestones Card */}
        <div className="bg-white p-5 rounded-xl border border-line shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b pb-3">
            <h2 className="font-bold text-primary text-base">Refurbishment Milestones</h2>
            <button
              onClick={() => setShowMilestoneModal(true)}
              className="px-3 py-1.5 bg-accent hover:bg-accent-strong text-white text-xs font-bold rounded-lg shadow-sm"
            >
              + Add Milestone
            </button>
          </div>

          {project.milestones.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted italic">
              No project milestones created yet. Add key targets (e.g. Rip Out, Plumbing,
              Decorating).
            </div>
          ) : (
            <div className="space-y-2">
              {project.milestones.map((m) => (
                <div
                  key={m.id}
                  className={`flex items-start justify-between p-3 border rounded-lg text-xs transition-colors ${
                    m.status === FlipperMilestoneStatus.COMPLETED
                      ? "bg-success/10 border-success/30 text-success"
                      : "bg-white border-line text-primary"
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <input
                      type="checkbox"
                      checked={m.status === FlipperMilestoneStatus.COMPLETED}
                      onChange={() => handleToggleMilestone(m.id, m.status)}
                      className="mt-0.5 rounded border-line text-accent focus:ring-accent"
                    />
                    <div>
                      <div
                        className={`font-semibold ${
                          m.status === FlipperMilestoneStatus.COMPLETED
                            ? "line-through text-muted"
                            : ""
                        }`}
                      >
                        {m.title}
                      </div>
                      {m.description && (
                        <div className="text-[10px] text-muted">{m.description}</div>
                      )}
                    </div>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                      m.status === FlipperMilestoneStatus.COMPLETED
                        ? "bg-success/20 text-success"
                        : "bg-surface text-body"
                    }`}
                  >
                    {m.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Notice for Phase 8 Handoff */}
      <div className="p-4 bg-surface border border-line rounded-xl text-xs text-muted space-y-1">
        <div className="font-bold text-primary">Phase 8 Resale Handoff Notice</div>
        <p>
          Once your refurbishment is complete, Phase 8 will allow you to generate a new
          resale listing for your renovated property. Resale listing creation remains
          locked until Phase 8.
        </p>
      </div>

      {/* Add Cost Modal */}
      {showCostModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 border border-line">
            <h3 className="font-bold text-primary text-base">
              Add Refurbishment Cost Item
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-body mb-1">Category</label>
                <select
                  value={costCategory}
                  onChange={(e) => setCostCategory(e.target.value as FlipperCostCategory)}
                  className="w-full text-xs border-line rounded-md"
                >
                  {Object.values(FlipperCostCategory).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-body mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Kitchen units, Plumber invoice #123"
                  value={costDescription}
                  onChange={(e) => setCostDescription(e.target.value)}
                  className="w-full text-xs border-line rounded-md"
                />
              </div>

              <div>
                <label className="block font-semibold text-body mb-1">Amount (£)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="e.g. 1450.00"
                  value={costAmountInput}
                  onChange={(e) => setCostAmountInput(e.target.value)}
                  className="w-full text-xs border-line rounded-md"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCostModal(false)}
                className="px-3 py-1.5 bg-line text-primary text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCost}
                disabled={costSubmitting}
                className="px-4 py-1.5 bg-accent text-white text-xs font-bold rounded-lg"
              >
                {costSubmitting ? "Adding..." : "Save Cost Item"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Milestone Modal */}
      {showMilestoneModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-5 space-y-4 border border-line">
            <h3 className="font-bold text-primary text-base">Add Project Milestone</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-body mb-1">
                  Milestone Title
                </label>
                <input
                  type="text"
                  placeholder="e.g. Electrical Rewire, New Bathroom Fitted"
                  value={milestoneTitle}
                  onChange={(e) => setMilestoneTitle(e.target.value)}
                  className="w-full text-xs border-line rounded-md"
                />
              </div>

              <div>
                <label className="block font-semibold text-body mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Additional details..."
                  value={milestoneDesc}
                  onChange={(e) => setMilestoneDesc(e.target.value)}
                  className="w-full text-xs border-line rounded-md"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowMilestoneModal(false)}
                className="px-3 py-1.5 bg-line text-primary text-xs font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleAddMilestone}
                disabled={milestoneSubmitting}
                className="px-4 py-1.5 bg-accent text-white text-xs font-bold rounded-lg"
              >
                {milestoneSubmitting ? "Adding..." : "Save Milestone"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
