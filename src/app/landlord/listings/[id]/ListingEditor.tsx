"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  attachFileAction,
  deleteDraftAction,
  saveListingAction,
  submitListingAction,
  withdrawListingAction,
  type FormState,
} from "../actions";
import { BUTTON, CHOICE, INPUT, LABEL, SECONDARY } from "../ui";

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
      <label htmlFor={name} className={LABEL}>
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
    <form
      action={formAction}
      className="space-y-6 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-7"
    >
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
        <legend className={`${LABEL} mb-2`}>Property or land</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["PROPERTY", "A property"],
            ["LAND", "Development land"],
          ].map(([value, label]) => (
            <label key={value} className={CHOICE}>
              <input
                className="accent-accent"
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
        <legend className={`${LABEL} mb-2`}>What would you like to happen?</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["REFURBISHMENT", "Refurbishment"],
            ["DEVELOPMENT_JV", "Development joint venture"],
          ].map(([value, label]) => (
            <label key={value} className={CHOICE}>
              <input
                className="accent-accent"
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
  // Local preview of the photo being uploaded (an object URL: never leaves the
  // browser). Shown while it uploads and is scanned, and after it is added,
  // until the next pick; the attached list shows the stored copy.
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  async function upload(file: File) {
    setBusy(true);
    setStatus("Uploading and scanning…");
    setPreview(
      file.type.startsWith("image/")
        ? { url: URL.createObjectURL(file), name: file.name }
        : null,
    );
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
        setPreview(null);
        return;
      }
      const attached = await attachFileAction(listingId, body.fileId, kind);
      if (!attached.ok) {
        setStatus(attached.error ?? "Could not attach the file.");
        setPreview(null);
        return;
      }
      setStatus(`${KIND_LABEL[kind]} added.`);
      router.refresh();
    } catch {
      setStatus("Upload failed. Please try again.");
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-dashed border-accent/30 bg-pale/40 p-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
        <div className="space-y-1">
          <label htmlFor="file-kind" className={LABEL}>
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
          <label htmlFor="file-input" className={LABEL}>
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
            className="block w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-accent file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-accent-strong"
          />
        </div>
      </div>
      <p className="text-xs text-muted">
        Every file is scanned for malware and kept private. Only you, PropLink and (after
        approval) verified agents can open it.
      </p>
      {(status || preview) && (
        <div className="flex items-center gap-3">
          {preview && (
            <span className="relative shrink-0 overflow-hidden rounded-xl border border-line bg-surface">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL of the file just picked; next/image can't load blob: URLs. */}
              <img
                src={preview.url}
                alt={`Preview of ${preview.name}`}
                data-testid="upload-preview"
                className={`h-20 w-28 object-cover transition-opacity ${busy ? "opacity-60" : ""}`}
                width={112}
                height={80}
              />
              {busy && (
                <span
                  aria-hidden
                  className="absolute inset-0 m-auto h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent motion-reduce:animate-none"
                />
              )}
            </span>
          )}
          {status && (
            <p role="status" aria-live="polite" className="text-sm text-muted">
              {status}
            </p>
          )}
        </div>
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
      className="space-y-3 rounded-2xl border border-danger/30 bg-danger/5 p-5"
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
          className="rounded-full bg-danger px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
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
