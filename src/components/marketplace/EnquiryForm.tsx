"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { RateLimitCountdown } from "@/components/security/RateLimitCountdown";
import { readApiError } from "@/lib/security/rate-limit-client";

interface EnquiryFormProps {
  propertyId: string;
  sessionUser: { name: string; email: string } | null;
}

/**
 * Public `/marketplace/[id]` "Post Enquiry" form (Task 2.5 brief). `Enquiry.
 * fromUserId` is a required column (`prisma/schema.prisma`) — there is no
 * anonymous-enquiry path, so a logged-out visitor sees a login prompt instead
 * of the form. The "name" field the brief describes is read-only, sourced from
 * the session (there is nowhere to persist an edited one — the account IS
 * the identity behind `fromUserId`); `contactPhone` is the one genuinely
 * optional/editable extra, folded into the stored message server-side
 * (`enquiryService.ts`) since `Enquiry` has no dedicated column for it.
 */
export function EnquiryForm({ propertyId, sessionUser }: EnquiryFormProps) {
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number>();
  const [turnstileToken, setTurnstileToken] = useState<string>();
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  if (!sessionUser) {
    return (
      <div className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
        <Link href="/login" className="text-accent underline">
          Log in
        </Link>{" "}
        to contact the agent about this property.
      </div>
    );
  }

  const canSubmit = message.trim().length >= 10;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setRetryAfterSeconds(undefined);
    try {
      const res = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          message: message.trim(),
          ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
          turnstileToken,
        }),
      });
      if (!res.ok) {
        const apiError = await readApiError(res);
        setError(apiError.message);
        setRetryAfterSeconds(apiError.retryAfterSeconds);
        return;
      }
      toast("Enquiry sent", "success");
      setMessage("");
      setContactPhone("");
      setTurnstileToken(undefined);
      setTurnstileResetKey((key) => key + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Post enquiry"
      className="max-w-lg space-y-3 rounded-lg border border-line bg-white p-4"
    >
      <div>
        <span className="block text-xs font-medium uppercase tracking-wide text-muted">
          From
        </span>
        <p className="mt-0.5 text-sm text-body">
          {sessionUser.name} &lt;{sessionUser.email}&gt;
        </p>
      </div>

      <div>
        <label htmlFor="enquiry-message" className="block text-sm font-medium text-body">
          Message
        </label>
        <textarea
          id="enquiry-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          required
          placeholder="I'd like to know more about this property…"
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="enquiry-phone" className="block text-sm font-medium text-body">
          Contact phone <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="enquiry-phone"
          type="tel"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          placeholder="07700 900123"
          className="mt-1 w-full rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none"
        />
      </div>

      <TurnstileWidget onToken={setTurnstileToken} resetKey={turnstileResetKey} />

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
          {retryAfterSeconds ? (
            <RateLimitCountdown key={retryAfterSeconds} seconds={retryAfterSeconds} />
          ) : null}
        </p>
      )}

      <Button type="submit" disabled={!canSubmit || submitting}>
        {submitting ? "Sending…" : "Post enquiry"}
      </Button>
    </form>
  );
}
