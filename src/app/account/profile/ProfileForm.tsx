"use client";

import { useActionState, useState } from "react";

import { cn } from "@/lib/cn";
import { saveProfileAction, type ProfileFormState } from "./actions";

const INPUT =
  "mt-1.5 w-full rounded-2xl border border-line bg-white px-4 py-3 text-sm text-body transition-colors placeholder:text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20";

const CARD = "rounded-[1.75rem] border border-line bg-white p-6 sm:p-7";

type Visibility = "PUBLIC" | "PRIVATE" | "MEMBERS";

type Initial = {
  headline: string;
  bio: string;
  location: string;
  experience: string;
  specialisms: string;
  visibility: Visibility;
};

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-semibold text-primary">{title}</h2>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </div>
  );
}

function Field({
  name,
  label,
  hint,
  max,
  multiline = false,
  placeholder,
  defaultValue,
}: {
  name: keyof Omit<Initial, "visibility">;
  label: string;
  hint?: string;
  max: number;
  multiline?: boolean;
  placeholder?: string;
  defaultValue: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-primary">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          rows={5}
          maxLength={max}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={cn(INPUT, "resize-y leading-relaxed")}
        />
      ) : (
        <input
          id={name}
          name={name}
          maxLength={max}
          placeholder={placeholder}
          defaultValue={defaultValue}
          className={INPUT}
        />
      )}
      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** A radio drawn as a selectable card; the native input stays for a11y. */
function VisibilityOption({
  value,
  title,
  body,
  defaultChecked,
}: {
  value: Visibility;
  title: string;
  body: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="group relative flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4 transition-colors hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-pale/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/30">
      <input
        type="radio"
        name="visibility"
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line bg-white transition-colors peer-checked:border-accent peer-checked:bg-accent"
      >
        <span className="size-2 rounded-full bg-white" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-primary">{title}</span>
        <span className="mt-0.5 block text-sm text-muted">{body}</span>
      </span>
    </label>
  );
}

/**
 * Profile editor form (Phase 1 Task 8, ADR-032), shared by every role. Laid out
 * as section cards (ADR-071) with a sticky save bar; field names and the save
 * action are unchanged.
 */
export function ProfileForm({
  initial,
  isInvestor,
  avatar,
}: {
  initial: Initial;
  isInvestor: boolean;
  /** Current photo URL or the initial to show in its place. */
  avatar: { photoUrl: string | null; initial: string };
}) {
  const [state, formAction, pending] = useActionState(saveProfileAction, {
    kind: "idle",
  } as ProfileFormState);
  const [photoId, setPhotoId] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
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
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoStatus("Photo ready. Save your profile to use it.");
  }

  const shownPhoto = photoPreview ?? avatar.photoUrl;

  return (
    <form action={formAction} className="space-y-5">
      <section className={CARD}>
        <SectionHeading
          title="Photo or logo"
          hint={
            isInvestor
              ? "Shown only to you and the Agent on a project you join."
              : "A clear headshot or your company logo."
          }
        />
        <div className="flex flex-wrap items-center gap-5">
          {shownPhoto ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed image route / local preview
            <img
              src={shownPhoto}
              alt=""
              className="size-20 rounded-full border border-line object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-20 place-items-center rounded-full bg-pale text-2xl font-semibold text-accent"
            >
              {avatar.initial}
            </span>
          )}
          <div>
            <label
              htmlFor="photo"
              className="inline-flex h-11 cursor-pointer items-center rounded-full border border-line bg-white px-5 text-sm font-semibold text-primary transition-colors hover:border-accent has-[:focus-visible]:ring-2"
            >
              {shownPhoto ? "Change image" : "Upload image"}
            </label>
            <input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Photo or logo"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadPhoto(file);
              }}
              className="sr-only"
            />
            <p className="mt-2 text-xs text-muted">
              {photoStatus ?? "JPEG, PNG or WebP. Scanned before it is used."}
            </p>
            <input type="hidden" name="photoFileId" value={photoId} />
          </div>
        </div>
      </section>

      <section className={CARD}>
        <SectionHeading
          title="About you"
          hint="The basics people see first on your profile."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="headline"
            label="Headline or company"
            max={120}
            placeholder={
              isInvestor ? "e.g. Refurbishment investor" : "e.g. Director, Acme Estates"
            }
            defaultValue={initial.headline}
          />
          <Field
            name="location"
            label="Location"
            max={100}
            placeholder="e.g. Manchester"
            defaultValue={initial.location}
          />
          <div className="sm:col-span-2">
            <Field
              name="specialisms"
              label="Specialisms"
              hint="Separate with commas, up to 10 — e.g. HMOs, land development, probate."
              max={1000}
              defaultValue={initial.specialisms}
            />
          </div>
        </div>
      </section>

      <section className={CARD}>
        <SectionHeading
          title="Your story"
          hint="Up to 2,000 characters each. Plain text."
        />
        <div className="space-y-5">
          <Field
            name="bio"
            label="About"
            max={2000}
            multiline
            placeholder="What you do and what you look for in a project."
            defaultValue={initial.bio}
          />
          <Field
            name="experience"
            label="Experience"
            max={2000}
            multiline
            placeholder="Past projects, years in property, qualifications."
            defaultValue={initial.experience}
          />
        </div>
      </section>

      <section className={CARD}>
        <fieldset>
          <legend className="text-base font-semibold text-primary">
            Who can see your profile
          </legend>
          <p className="mt-1 mb-5 text-sm text-muted">
            Your email and phone are never shown.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {isInvestor ? (
              <>
                <VisibilityOption
                  value="PRIVATE"
                  title="Private"
                  body="Hidden, except from the Agent on a project you join."
                  defaultChecked={initial.visibility === "PRIVATE"}
                />
                <VisibilityOption
                  value="PUBLIC"
                  title="Public (anonymous)"
                  body="An anonymous ID and general activity only. Never your name, email or phone."
                  defaultChecked={initial.visibility === "PUBLIC"}
                />
              </>
            ) : (
              <>
                <VisibilityOption
                  value="MEMBERS"
                  title="PropLink members only"
                  body="People signed in to PropLink."
                  defaultChecked={initial.visibility !== "PUBLIC"}
                />
                <VisibilityOption
                  value="PUBLIC"
                  title="Public"
                  body="Anyone with the link. Never your email or phone."
                  defaultChecked={initial.visibility === "PUBLIC"}
                />
              </>
            )}
          </div>
        </fieldset>
      </section>

      <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-full border border-line bg-white/90 py-2 pr-2 pl-5 shadow-lg sm:pl-6 shadow-primary/[0.06] backdrop-blur-md">
        <p className="min-w-0 truncate text-xs sm:text-sm">
          {state.kind === "saved" ? (
            <span role="status" className="font-semibold text-success">
              Saved.
            </span>
          ) : state.kind === "error" ? (
            <span role="alert" className="font-semibold text-danger">
              {state.message}
            </span>
          ) : (
            <span className="text-muted">Changes apply when you save.</span>
          )}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="h-11 shrink-0 rounded-full bg-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}
