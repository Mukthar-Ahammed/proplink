"use client";

import { useState, useTransition, type RefObject } from "react";

import { draftWithAiAction } from "../actions";

type Draft = { description: string; defects: string; requiredWork: string };

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";

/**
 * Optional helper inside the listing form (business Q5). The Landlord types
 * a few words; the AI drafts the description, defects and work fields; the
 * Landlord reviews the draft, puts it into the form, edits and saves.
 * The boxes here have no `name`, so they are never saved with the listing.
 */
export function AiAssistantPanel({
  formRef,
}: {
  formRef: RefObject<HTMLFormElement | null>;
}) {
  const [condition, setCondition] = useState("");
  const [defects, setDefects] = useState("");
  const [work, setWork] = useState("");
  const [extra, setExtra] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function formValue(name: string): string {
    const form = formRef.current;
    if (!form) return "";
    const value = new FormData(form).get(name);
    return typeof value === "string" ? value : "";
  }

  function generate() {
    setMessage(null);
    startTransition(async () => {
      const result = await draftWithAiAction({
        propertyKind: formValue("propertyKind"),
        propertyType: formValue("propertyType"),
        location: formValue("city"),
        desiredOutcome: formValue("desiredOutcome"),
        condition,
        defects,
        requiredWork: work,
        extra,
      });
      if (result.ok) {
        setDraft(result.draft);
      } else {
        setMessage(result.error);
      }
    });
  }

  function applyDraft() {
    const form = formRef.current;
    if (!form || !draft) return;
    for (const [name, value] of Object.entries(draft)) {
      const field = form.elements.namedItem(name);
      if (field instanceof HTMLTextAreaElement && value) field.value = value;
    }
    setDraft(null);
    setMessage("Draft added to the form. Check it, edit anything, then save.");
  }

  return (
    <details className="rounded-lg border border-line bg-surface p-4">
      <summary className="cursor-pointer text-sm font-semibold text-primary">
        Draft the description with the AI assistant (optional)
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-xs text-muted">
          Type a few words in each box. The assistant only uses what you write here and in
          the type, town and outcome above. Do not include names, phone numbers or email
          addresses. You review the draft before anything goes into your listing.
        </p>
        {(
          [
            [
              "Condition",
              condition,
              setCondition,
              "e.g. empty two years, needs full refurb",
            ],
            [
              "Known defects",
              defects,
              setDefects,
              "e.g. damp in back bedroom, slipped roof tiles",
            ],
            ["Work needed", work, setWork, "e.g. new kitchen, rewire, replace windows"],
          ] as const
        ).map(([label, value, set, placeholder]) => (
          <label key={label} className="block space-y-1 text-sm font-medium text-primary">
            {label}
            <input
              value={value}
              onChange={(event) => set(event.target.value)}
              maxLength={300}
              placeholder={placeholder}
              className={INPUT}
            />
          </label>
        ))}
        <label className="block space-y-1 text-sm font-medium text-primary">
          Anything else
          <textarea
            value={extra}
            onChange={(event) => setExtra(event.target.value)}
            maxLength={600}
            rows={2}
            className={INPUT}
          />
        </label>
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60"
        >
          {pending ? "Writing…" : "Write a draft"}
        </button>
        {message && (
          <p role="status" className="text-sm text-muted">
            {message}
          </p>
        )}
        {draft && (
          <div className="space-y-3 rounded-lg border border-line bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              AI draft: review before using
            </p>
            {(
              [
                ["Description", draft.description],
                ["Known defects", draft.defects],
                ["Work required", draft.requiredWork],
              ] as const
            )
              .filter(([, text]) => text)
              .map(([label, text]) => (
                <div key={label}>
                  <p className="text-sm font-medium text-primary">{label}</p>
                  <p className="whitespace-pre-line text-sm text-body">{text}</p>
                </div>
              ))}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={applyDraft}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Put this draft into the form
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary"
              >
                Discard
              </button>
            </div>
            <p className="text-xs text-muted">
              Filling the form replaces what is in those boxes. Nothing is saved until you
              press Save draft.
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
