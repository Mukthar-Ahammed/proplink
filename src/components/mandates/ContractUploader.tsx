"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Uploads the signed mandate contract through the secure pipeline (scanned,
 * private), then attaches it with the caller's server action (Phase 2 Task 6).
 */
export function ContractUploader({
  mandateId,
  attach,
  hasContract,
}: {
  mandateId: string;
  attach: (mandateId: string, fileId: string) => Promise<{ ok: boolean; error?: string }>;
  hasContract: boolean;
}) {
  const router = useRouter();
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
      const attached = await attach(mandateId, body.fileId);
      if (!attached.ok) {
        setStatus(attached.error ?? "Could not attach the contract.");
        return;
      }
      setStatus("Contract added.");
      router.refresh();
    } catch {
      setStatus("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-primary">
        {hasContract ? "Replace the signed contract" : "Add the signed contract (PDF)"}
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
          className="mt-1 block text-sm"
        />
      </label>
      {status && (
        <p role="status" className="text-sm text-muted">
          {status}
        </p>
      )}
    </div>
  );
}
