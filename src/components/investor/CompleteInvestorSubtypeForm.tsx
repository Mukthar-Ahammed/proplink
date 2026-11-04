"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { completeInvestorOnboardingAction } from "@/app/(auth)/actions";

const investorSubtypes = [
  {
    value: "FLIPPER",
    label: "Property Flipper",
    description: "Buy properties, renovate them and prepare them for resale.",
  },
  {
    value: "SYNDICATE",
    label: "Syndicate Investor",
    description: "Join property investment opportunities with other investors.",
  },
  {
    value: "BOTH",
    label: "Both",
    description: "Access both property flipping and syndicate investment opportunities.",
  },
] as const;

export function CompleteInvestorSubtypeForm() {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<"FLIPPER" | "SYNDICATE" | "BOTH">("FLIPPER");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await completeInvestorOnboardingAction(selectedType);
      if (res.kind === "success") {
        router.refresh();
      } else {
        setError(res.message || "Unable to save your investor type.");
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
      <div className="text-center sm:text-left">
        <h2 className="text-xl font-bold text-primary sm:text-2xl">Complete your investor profile</h2>
        <p className="mt-1.5 text-sm text-muted">
          Choose how you plan to use PropLink. This preference sets your investor portal workspace.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-6">
        <fieldset>
          <legend className="sr-only">Investor Type Selection</legend>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {investorSubtypes.map((subtype) => (
              <label
                key={subtype.value}
                className={`flex cursor-pointer flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                  selectedType === subtype.value
                    ? "border-accent bg-pale/40 font-semibold text-primary shadow-sm ring-2 ring-accent"
                    : "border-line bg-surface hover:border-secondary hover:bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-primary">{subtype.label}</span>
                    <input
                      type="radio"
                      name="investorType"
                      value={subtype.value}
                      checked={selectedType === subtype.value}
                      onChange={() => setSelectedType(subtype.value)}
                      className="accent-accent"
                    />
                  </div>
                  <p className="mt-2 text-xs font-normal leading-relaxed text-muted">
                    {subtype.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3.5 text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted">
            Note: Subtype selection is permanent for initial onboarding.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save and continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
