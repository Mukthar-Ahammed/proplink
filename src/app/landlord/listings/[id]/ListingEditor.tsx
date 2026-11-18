"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import {
  attachFileAction,
  deleteDraftAction,
  saveListingAction,
  submitListingAction,
  withdrawListingAction,
  type FormState,
} from "../actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";
const BUTTON =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60";
const SECONDARY =
  "rounded-lg border border-line px-4 py-2 text-sm font-semibold text-primary disabled:opacity-60";

export type EditableFields = {
  id: string;
  title: string;
  addressLine1: string;
  city: string;
  postcode: string;
  propertyKind: string;
  propertyType: string;
  description: string;
  defects: string;
  requiredWork: string;
  landAreaSqm: string;
  desiredOutcome: string;
};

function Feedback({ state, saved }: { state: FormState; saved: string }) {
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-sm text-danger">
        {state.message}
      </p>
    );
  }
  if (state.kind === "saved") {
    return (
      <p role="status" className="text-sm text-success">
        {saved}
      </p>
    );
  }
  return null;
}

function Field({
  name,
  label,
  hint,
  defaultValue,
  max,
  multiline,
  inputMode,
  autoComplete,
}: {
  name: keyof EditableFields;
  label: string;
  hint?: string;
  defaultValue: string;
  max: number;
  multiline?: boolean;
  inputMode?: "numeric" | "text";
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium text-primary">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          rows={5}
          maxLength={max}
          defaultValue={defaultValue}
          className={INPUT}
        />
      ) : (
        <input
          id={name}
          name={name}
          maxLength={max}
          defaultValue={defaultValue}
          inputMode={inputMode}
          autoComplete={autoComplete}
          className={INPUT}
        />
      )}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** TRD LL-1 fields. Saving keeps everything as typed if validation fails. */
export function ListingFieldsForm({ initial }: { initial: EditableFields }) {
  const [state, formAction, pending] = useActionState(saveListingAction, {
    kind: "idle",
  } as FormState);
  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="id" value={initial.id} />
      <Field name="title" label="Title" defaultValue={initial.title} max={120} />
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <Field
            name="addressLine1"
            label="Address"
            defaultValue={initial.addressLine1}
            max={200}
            autoComplete="address-line1"
          />
        </div>
        <Field
          name="city"
          label="Town or city"
          defaultValue={initial.city}
          max={100}
          autoComplete="address-level2"
        />
        <Field
          name="postcode"
          label="Postcode"
          defaultValue={initial.postcode}
          max={10}
          autoComplete="postal-code"
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary">Property or land</legend>
        <div className="flex flex-wrap gap-6">
          {[
            ["PROPERTY", "A property"],
            ["LAND", "Development land"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="propertyKind"
                value={value}
                defaultChecked={initial.propertyKind === value}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="propertyType"
          label="Type (optional)"
          hint="e.g. terraced house, flat, warehouse, paddock"
          defaultValue={initial.propertyType}
          max={60}
        />
        <Field
          name="landAreaSqm"
          label="Land area in square metres"
          hint="Required for development land"
          defaultValue={initial.landAreaSqm}
          max={9}
          inputMode="numeric"
        />
      </div>
      <Field
        name="description"
        label="Description"
        defaultValue={initial.description}
        max={5000}
        multiline
      />
      <Field
        name="defects"
        label="Known defects"
        hint="Damp, roof, structural issues, anything an agent should know"
        defaultValue={initial.defects}
        max={3000}
        multiline
      />
      <Field
        name="requiredWork"
        label="Work required"
        defaultValue={initial.requiredWork}
        max={3000}
        multiline
      />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-primary">
          What would you like to happen?
        </legend>
        <div className="flex flex-wrap gap-6">
          {[
            ["REFURBISHMENT", "Refurbishment"],
            ["DEVELOPMENT_JV", "Development joint venture"],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="desiredOutcome"
                value={value}
                defaultChecked={initial.desiredOutcome === value}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-4">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? "Saving…" : "Save draft"}
        </button>
        <Feedback state={state} saved="Saved." />
      </div>
    </form>
  );
}

const KIND_LABEL: Record<string, string> = {
  OWNERSHIP_DOCUMENT: "Ownership document",
  PHOTO: "Photo",
  DOCUMENT: "Other document",
};

/** Uploads go through the secure pipeline, then attach to the listing. */
export function FileUploader({ listingId }: { listingId: string }) {
  const router = useRouter();
  const [kind, setKind] = useState("OWNERSHIP_DOCUMENT");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    setStatus("Uploading and scanning…");
    try {
      const response = await fetch("/api/uploads/files", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
          "X-Upload-Purpose": "document",
          "X-Proplink-Request": "1",
        },
        body: file,
      });
      const body = (await response.json().catch(() => ({}))) as {
        fileId?: string;
        error?: string;
      };
      if (!response.ok || !body.fileId) {
        setStatus(body.error ?? "Upload failed. Please try again.");
        return;
      }
      const attached = await attachFileAction(listingId, body.fileId, kind);
      if (!attached.ok) {
        setStatus(attached.error ?? "Could not attach the file.");
        return;
      }
      setStatus(`${KIND_LABEL[kind]} added.`);
      router.refresh();
    } catch {
      setStatus("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="file-kind" className="block text-sm font-medium text-primary">
            What is it?
          </label>
          <select
            id="file-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className={INPUT}
          >
            <option value="OWNERSHIP_DOCUMENT">
              Ownership document (title deeds, Land Registry title)
            </option>
            <option value="PHOTO">Photo</option>
            <option value="DOCUMENT">Other document (survey, plans)</option>
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="file-input" className="block text-sm font-medium text-primary">
            File
          </label>
          <input
            id="file-input"
            type="file"
            disabled={busy}
            accept={kind === "PHOTO" ? "image/jpeg,image/png,image/webp" : undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
            className="text-sm"
          />
        </div>
      </div>
      <p className="text-xs text-muted">
        Every file is scanned for malware and kept private. Only you, PropLink and (after
        approval) verified agents can open it.
      </p>
      {status && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {status}
        </p>
      )}
    </div>
  );
}

export function SubmitListing({ id, label }: { id: string; label: string }) {
  const [state, formAction, pending] = useActionState(submitListingAction, {
    kind: "idle",
  } as FormState);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Submitting…" : label}
      </button>
      <Feedback state={state} saved="Submitted to PropLink review." />
    </form>
  );
}

/** Destructive actions confirm in the page, naming the property (design spec §6). */
export function ConfirmAction({
  id,
  title,
  action,
}: {
  id: string;
  title: string;
  action: "withdraw" | "delete";
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(
    action === "withdraw" ? withdrawListingAction : deleteDraftAction,
    { kind: "idle" } as FormState,
  );
  const verb = action === "withdraw" ? "Withdraw" : "Delete draft";
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className={SECONDARY}>
        {verb}
      </button>
    );
  }
  return (
    <form
      action={formAction}
      className="space-y-3 rounded-lg border border-danger/40 bg-danger/5 p-4"
      role="alertdialog"
      aria-labelledby={`confirm-${action}`}
    >
      <input type="hidden" name="id" value={id} />
      <p id={`confirm-${action}`} className="text-sm font-semibold text-primary">
        {action === "withdraw"
          ? `Withdraw “${title}”? Agents will no longer see it. You can list it again later.`
          : `Delete the draft “${title}”? This can't be undone.`}
      </p>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Working…" : verb}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={SECONDARY}>
          Cancel
        </button>
      </div>
      <Feedback state={state} saved="Done." />
    </form>
  );
}
