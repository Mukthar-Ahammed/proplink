import "server-only";

import { getServerEnv } from "@/env";

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

const env = getServerEnv();
const FROM = env.EMAIL_FROM ?? "PropLink UK <onboarding@resend.dev>";

class ResendMailer implements Mailer {
  constructor(private apiKey: string) {}

  async send(mail: Mail): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        ...(mail.html ? { html: mail.html } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`Resend API error ${res.status}`);
    }
  }
}

class MockMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    console.info(
      JSON.stringify({
        event: "email.mock_delivery",
        subjectLength: mail.subject.length,
        textLength: mail.text.length,
        hasHtml: Boolean(mail.html),
      }),
    );
  }
}

function createMailer(): Mailer {
  if (env.EMAIL_PROVIDER === "resend") {
    if (!env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is required for the Resend email provider");
    }
    return new ResendMailer(env.RESEND_API_KEY);
  }
  return new MockMailer();
}

export const mailer = createMailer();

const BASE_URL = env.APP_ORIGIN ?? "http://localhost:3000";

export async function sendVerificationEmail(to: string, token: string) {
  const url = `${BASE_URL}/verify-email?token=${token}`;
  await mailer.send({
    to,
    subject: "Verify your PropLink UK email",
    text: `Welcome to PropLink UK.\n\nVerify your email address by opening this link (valid 24 hours):\n${url}\n\nIf you did not create this account, ignore this email.`,
  });
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const url = `${BASE_URL}/reset-password?token=${token}`;
  await mailer.send({
    to,
    subject: "Reset your PropLink UK password",
    text: `A password reset was requested for this address.\n\nSet a new password here (link valid 1 hour):\n${url}\n\nIf this wasn't you, ignore this email — your password is unchanged.`,
  });
}

// Task 2.3 — admin moderation notifications.

export async function sendListingApprovedEmail(to: string, listingTitle: string) {
  await mailer.send({
    to,
    subject: `Your listing "${listingTitle}" is now live on PropLink UK`,
    text: `Good news — your listing "${listingTitle}" has been approved and is now live on PropLink UK.`,
  });
}

export async function sendListingRejectedEmail(
  to: string,
  listingTitle: string,
  reason: string,
) {
  await mailer.send({
    to,
    subject: `Your listing "${listingTitle}" needs changes before it can go live`,
    text: `Your listing "${listingTitle}" was reviewed and could not be approved as submitted.\n\nReason: ${reason}\n\nPlease make the requested changes and resubmit it for review from your agent portal.`,
  });
}

// Task 2.5 — public property detail page enquiry notification.

export async function sendNewEnquiryEmail(params: {
  to: string;
  listingTitle: string;
  fromName: string;
  fromEmail: string;
  contactPhone: string | null;
  message: string;
}) {
  await mailer.send({
    to: params.to,
    subject: `New enquiry on "${params.listingTitle}"`,
    text: `${params.fromName} (${params.fromEmail}) sent an enquiry about "${params.listingTitle}" on PropLink UK.${
      params.contactPhone ? `\nPreferred phone: ${params.contactPhone}` : ""
    }\n\nMessage:\n${params.message}\n\nReply directly to this email, or view the enquiry in your PropLink UK agent portal.`,
  });
}

// Phase 1 Task 3 — Agent invitation (ADR-023). The token is in the URL
// fragment, which browsers never send to the server or in a Referer header.

export async function sendAgentInviteEmail(params: {
  to: string;
  inviteUrl: string;
  expiresAt: Date;
}) {
  const expires = params.expiresAt.toUTCString();
  await mailer.send({
    to: params.to,
    subject: "You're invited to join PropLink UK as an agent",
    text: `PropLink UK has invited you to create an agent account.\n\nAccept the invitation and set your password here:\n${params.inviteUrl}\n\nThis link works once, only for this email address, and expires on ${expires}.\n\nIf you were not expecting this invitation, ignore this email.`,
  });
}

/** True when emails are only logged (development): nothing is actually sent. */
export function isMockMailer(): boolean {
  return env.EMAIL_PROVIDER !== "resend";
}

// Phase 1 Task 5 — existing (pre-invite) Agents are asked to sign in and
// confirm their account. No token: the confirmation happens after sign-in.
export async function sendAgentMigrationNotice(params: { to: string; name: string }) {
  await mailer.send({
    to: params.to,
    subject: "Action needed: confirm your PropLink UK agent account",
    text: `Hello ${params.name},\n\nPropLink UK now admits agents by invitation. Your existing account stays active, but you need to confirm it so PropLink can authorise it for new features.\n\nSign in and confirm your account here:\n${BASE_URL}/agent/confirm\n\nIt takes less than a minute. If you no longer use PropLink, you can ignore this email.`,
  });
}
