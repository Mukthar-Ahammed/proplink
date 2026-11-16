"use client";

import { useActionState } from "react";

import { createAnnouncementAction, type AnnouncementFormState } from "./actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";
const LABEL = "block text-sm font-medium text-primary";

const AUDIENCES = [
  { value: "AGENT", label: "Agents" },
  { value: "INVESTOR", label: "Investors" },
  { value: "LANDLORD", label: "Landlords" },
  { value: "BUYER", label: "Buyers" },
] as const;

export function AnnouncementForm({ defaultStart }: { defaultStart: string }) {
  const [state, formAction, pending] = useActionState(createAnnouncementAction, {
    kind: "idle",
  } as AnnouncementFormState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="kind" className={LABEL}>
            Type
          </label>
          <select id="kind" name="kind" className={INPUT} defaultValue="UPDATE">
            <option value="UPDATE">Platform update</option>
            <option value="BANNER">Promotional banner</option>
          </select>
        </div>
        <fieldset>
          <legend className={LABEL}>Shown to</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {AUDIENCES.map((audience) => (
              <label key={audience.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="audienceRoles"
                  value={audience.value}
                  defaultChecked={audience.value === "AGENT"}
                />
                {audience.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div>
        <label htmlFor="title" className={LABEL}>
          Title
        </label>
        <input
          id="title"
          name="title"
          required
          minLength={3}
          maxLength={120}
          className={INPUT}
        />
      </div>
      <div>
        <label htmlFor="body" className={LABEL}>
          Message
        </label>
        <textarea
          id="body"
          name="body"
          required
          maxLength={1000}
          rows={4}
          className={INPUT}
        />
        <p className="mt-1 text-xs text-muted">
          Plain text only. Links and the characters &lt; and &gt; are not allowed.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="startsAt" className={LABEL}>
            Starts (UTC)
          </label>
          <input
            id="startsAt"
            name="startsAt"
            type="datetime-local"
            required
            defaultValue={defaultStart}
            className={INPUT}
          />
        </div>
        <div>
          <label htmlFor="endsAt" className={LABEL}>
            Ends (UTC, optional)
          </label>
          <input id="endsAt" name="endsAt" type="datetime-local" className={INPUT} />
        </div>
      </div>
      {state.kind === "error" && (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      )}
      {state.kind === "created" && (
        <p role="status" className="text-sm text-success">
          Announcement saved.
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Saving…" : "Publish announcement"}
      </button>
    </form>
  );
}
