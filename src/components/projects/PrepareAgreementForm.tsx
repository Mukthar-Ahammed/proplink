"use client";

import { useActionState, useState } from "react";

import { prepareAgreementAction } from "@/components/projects/agreementActions";
import type { ProjectFormState } from "@/components/projects/ProjectTermsForm";

const IDLE: ProjectFormState = { kind: "idle" };
const input =
  "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body";

/**
 * The Solicitor prepares an agreement (Phase 4 Task 6): the PDF goes through
 * the secure upload pipeline (scanned, private) first; the parties default
 * to every live pledge, the Agent, and the Landlord in a JV.
 */
export function PrepareAgreementForm({
  projectId,
  path,
  isJointVenture,
}: {
  projectId: string;
  path: string;
  isJointVenture: boolean;
}) {
  const [state, action, pending] = useActionState(prepareAgreementAction, IDLE);
  const [fileId, setFileId] = useState("");
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  async function upload(file: File) {
    setUploadStatus("Uploading and scanning…");
    setFileId("");
    try {
      const response = await fetch("/api/uploads/files", {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/pdf",
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
        setUploadStatus(body.error ?? "Upload failed. Please try again.");
        return;
      }
      setFileId(body.fileId);
      setUploadStatus("Uploaded and scanned.");
    } catch {
      setUploadStatus("Upload failed. Please try again.");
    }
  }

  return (
    <form action={action} className="space-y-3" data-testid="prepare-agreement">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="draftFileId" value={fileId} />
      <label className="block text-sm font-medium text-primary">
        Agreement PDF
        <input
          type="file"
          accept="application/pdf"
          required
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          className="mt-1 block text-sm"
        />
        {uploadStatus && (
          <span className="mt-1 block text-xs font-normal text-muted" role="status">
            {uploadStatus}
          </span>
        )}
      </label>
      <label className="block text-sm font-medium text-primary">
        Title
        <input name="title" required maxLength={200} className={input} />
      </label>
      <label className="block text-sm font-medium text-primary">
        Loss allocation, as written in the agreement
        <textarea name="lossAllocation" required rows={3} className={input} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium text-primary">
          Cancellation payment (£, optional)
          <input name="cancellationPayment" inputMode="decimal" className={input} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm text-primary">
          <input
            type="checkbox"
            name="includeLandlord"
            defaultChecked={isJointVenture}
            disabled={isJointVenture}
          />
          The Landlord is a party
        </label>
      </div>
      <label className="block text-sm font-medium text-primary">
        Cancellation terms (optional)
        <textarea name="cancellationTerms" rows={2} className={input} />
      </label>
      <label className="block text-sm font-medium text-primary">
        Other terms (optional)
        <textarea name="otherTerms" rows={2} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={pending || !fileId}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Preparing…" : "Prepare draft"}
        </button>
        {state.kind !== "idle" && (
          <p
            role={state.kind === "error" ? "alert" : "status"}
            className={
              state.kind === "error" ? "text-sm text-danger" : "text-sm text-success"
            }
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
