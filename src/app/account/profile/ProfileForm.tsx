"use client";

import { useActionState, useState } from "react";

import { saveProfileAction, type ProfileFormState } from "./actions";

const INPUT =
  "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body focus:border-accent focus:outline-none";

type Initial = {
  headline: string;
  bio: string;
  location: string;
  experience: string;
  specialisms: string;
  visibility: "PUBLIC" | "PRIVATE" | "MEMBERS";
};

const FIELDS = [
  { name: "headline", label: "Headline or company", max: 120, multiline: false },
  { name: "location", label: "Location", max: 100, multiline: false },
  {
    name: "specialisms",
    label: "Specialisms (comma-separated, up to 10)",
    max: 1000,
    multiline: false,
  },
  { name: "bio", label: "About", max: 2000, multiline: true },
  { name: "experience", label: "Experience", max: 2000, multiline: true },
] as const;

export function ProfileForm({
  initial,
  isInvestor,
}: {
  initial: Initial;
  isInvestor: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveProfileAction, {
    kind: "idle",
  } as ProfileFormState);
  const [photoId, setPhotoId] = useState("");
  const [photoStatus, setPhotoStatus] = useState<string | null>(null);

  async function uploadPhoto(file: File) {
    setPhotoStatus("Uploading and scanning…");
    const response = await fetch("/api/uploads/files", {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-Upload-Purpose": "profile_photo",
        "X-Proplink-Request": "1",
      },
      body: file,
    });
    const body = (await response.json().catch(() => ({}))) as {
      fileId?: string;
      previewable?: boolean;
      error?: string;
    };
    if (!response.ok || !body.fileId) {
      setPhotoStatus(body.error ?? "Upload failed");
      return;
    }
    if (!body.previewable) {
      setPhotoStatus("Use a JPEG, PNG or WebP image for your photo.");
      return;
    }
    setPhotoId(body.fileId);
    setPhotoStatus("Photo ready. Save your profile to use it.");
  }

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-1">
        <label htmlFor="photo" className="block text-sm font-medium text-primary">
          Photo or logo
        </label>
        <input
          id="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadPhoto(file);
          }}
          className="text-sm"
        />
        <input type="hidden" name="photoFileId" value={photoId} />
        {photoStatus && (
          <p role="status" className="text-xs text-muted">
            {photoStatus}
          </p>
        )}
      </div>
      {FIELDS.map((field) => (
        <div key={field.name} className="space-y-1">
          <label htmlFor={field.name} className="block text-sm font-medium text-primary">
            {field.label}
          </label>
          {field.multiline ? (
            <textarea
              id={field.name}
              name={field.name}
              rows={4}
              maxLength={field.max}
              defaultValue={initial[field.name]}
              className={INPUT}
            />
          ) : (
            <input
              id={field.name}
              name={field.name}
              maxLength={field.max}
              defaultValue={initial[field.name]}
              className={INPUT}
            />
          )}
        </div>
      ))}
      {!isInvestor && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-primary">
            Who can see your profile
          </legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              value="MEMBERS"
              defaultChecked={initial.visibility !== "PUBLIC"}
              className="mt-1"
            />
            <span>PropLink members only: people signed in to PropLink.</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              value="PUBLIC"
              defaultChecked={initial.visibility === "PUBLIC"}
              className="mt-1"
            />
            <span>Public: anyone with the link. Never your email or phone.</span>
          </label>
        </fieldset>
      )}
      {isInvestor && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-primary">
            Who can see your profile
          </legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              value="PRIVATE"
              defaultChecked={initial.visibility === "PRIVATE"}
              className="mt-1"
            />
            <span>Private: hidden, except from the agent on a project you join.</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="visibility"
              value="PUBLIC"
              defaultChecked={initial.visibility === "PUBLIC"}
              className="mt-1"
            />
            <span>
              Public: an anonymous ID and general activity only. Never your name, email or
              phone.
            </span>
          </label>
        </fieldset>
      )}
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
        {state.kind === "saved" && (
          <p role="status" className="text-sm text-success">
            Saved.
          </p>
        )}
        {state.kind === "error" && (
          <p role="alert" className="text-sm text-danger">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
