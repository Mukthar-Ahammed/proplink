import "server-only";

import { getServerEnv } from "@/env";
import { saveToOutbox } from "@/services/email/devOutbox";

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
    // TEMPORARY until Resend is configured: keep the email readable at
    // /dev/mail (development only; never in production).
    await saveToOutbox(mail);
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

// Phase 2 Task 3 — Admin review decisions on a Landlord's private listing.
// The listing stays private either way; only verified Agents see approved ones.

export async function sendLandlordListingApprovedEmail(params: {
  to: string;
  listingTitle: string;
  listingId: string;
}) {
  await mailer.send({
    to: params.to,
    subject: `Your property "${params.listingTitle}" passed review`,
    text: `Good news: PropLink has reviewed "${params.listingTitle}" and approved it.\n\nVerified agents can now see it and send you proposals. It stays private: it never appears in public search.\n\nView it: ${BASE_URL}/landlord/listings/${params.listingId}`,
  });
}

export async function sendLandlordListingRejectedEmail(params: {
  to: string;
  listingTitle: string;
  listingId: string;
  reason: string;
}) {
  await mailer.send({
    to: params.to,
    subject: `Your property "${params.listingTitle}" needs changes`,
    text: `PropLink reviewed "${params.listingTitle}" and could not approve it yet.\n\nWhat to change: ${params.reason}\n\nEdit it and submit it again: ${BASE_URL}/landlord/listings/${params.listingId}`,
  });
}

// Phase 2 Task 5 — Agent proposals and their Q&A. No personal details or
// figures in the email; the reader signs in to see them.

export async function sendNewProposalEmail(params: {
  to: string;
  listingTitle: string;
  listingId: string;
}) {
  await mailer.send({
    to: params.to,
    subject: `New agent proposal for "${params.listingTitle}"`,
    text: `A verified agent sent a proposal for "${params.listingTitle}".\n\nCompare proposals side by side and ask questions: ${BASE_URL}/landlord/listings/${params.listingId}/proposals`,
  });
}

export async function sendProposalQuestionEmail(params: {
  to: string;
  listingTitle: string;
  listingId: string;
}) {
  await mailer.send({
    to: params.to,
    subject: `The landlord asked about your proposal for "${params.listingTitle}"`,
    text: `The landlord has a question about your proposal for "${params.listingTitle}".\n\nAnswer it here: ${BASE_URL}/agent/marketplace/${params.listingId}`,
  });
}

export async function sendProposalAnswerEmail(params: {
  to: string;
  listingTitle: string;
  listingId: string;
}) {
  await mailer.send({
    to: params.to,
    subject: `An agent answered your question about "${params.listingTitle}"`,
    text: `An agent answered your question about their proposal for "${params.listingTitle}".\n\nRead it: ${BASE_URL}/landlord/listings/${params.listingId}/proposals`,
  });
}

// Phase 2 Task 6 — exclusive mandates. One plain notice per event; the
// reader signs in for the details.

export type MandateNotice =
  | "offered"
  | "accepted"
  | "declined"
  | "offer_withdrawn"
  | "terminated"
  | "closed"
  | "proposal_declined"
  | "ending_soon"
  | "expired";

const MANDATE_COPY: Record<MandateNotice, { subject: string; body: string }> = {
  offered: {
    subject: "A landlord chose you for an exclusive mandate",
    body: "A landlord chose your proposal for an exclusive mandate. Accept or decline it in your Agent portal.",
  },
  accepted: {
    subject: "Your agent accepted the mandate",
    body: "The agent you chose accepted the exclusive mandate. It is now active.",
  },
  declined: {
    subject: "Your agent declined the mandate",
    body: "The agent you chose declined the mandate. You can choose another proposal.",
  },
  offer_withdrawn: {
    subject: "A landlord withdrew their mandate offer",
    body: "The landlord withdrew the mandate they offered you.",
  },
  terminated: {
    subject: "A mandate was terminated",
    body: "An exclusive mandate you are part of was terminated. The reason is in your portal.",
  },
  proposal_declined: {
    subject: "A landlord declined your proposal",
    body: "The landlord compared proposals and declined yours.",
  },
  closed: {
    subject: "A mandate was closed",
    body: "The landlord closed the mandate at the end of the agreed contract.",
  },
  // OD-28: mandates end automatically at the agreed end date.
  ending_soon: {
    subject: "A mandate ends in 7 days",
    body: "An exclusive mandate you are part of reaches the end of its agreed contract period in 7 days. To renew, the landlord can choose the same agent again after it ends.",
  },
  expired: {
    subject: "A mandate ended",
    body: "An exclusive mandate you are part of reached the end of its agreed contract period and ended. The listing is back in the private pool.",
  },
};

export async function sendMandateEmail(params: {
  to: string;
  notice: MandateNotice;
  listingTitle: string;
  path: string;
}) {
  const copy = MANDATE_COPY[params.notice];
  await mailer.send({
    to: params.to,
    subject: `${copy.subject}: "${params.listingTitle}"`,
    text: `${copy.body}\n\n"${params.listingTitle}": ${BASE_URL}${params.path}`,
  });
}

// Phase 2 Task 8 — a private listing opened to verified Agents (new, or back
// in the pool after a mandate ended). Area only: no title, address or owner.

export async function sendPrivateListingEmail(params: {
  to: string;
  area: string;
  kind: string;
  listingId: string;
  returned: boolean;
}) {
  await mailer.send({
    to: params.to,
    subject: params.returned
      ? `A private ${params.kind} in ${params.area} is open to agents again`
      : `New private ${params.kind} in ${params.area} on PropLink`,
    text: `${
      params.returned
        ? "A landlord's property is open to proposals again after a mandate ended."
        : "A landlord's property passed PropLink review and is open to verified agents."
    }\n\nSee it and send a proposal: ${BASE_URL}/agent/marketplace/${params.listingId}`,
  });
}

// Phase 3 Task 1 — subscription payment failed (mandatory notice).

export async function sendPaymentFailedEmail(params: { to: string; graceDays: number }) {
  await mailer.send({
    to: params.to,
    subject: "Your PropLink subscription payment failed",
    text: `We could not take your latest subscription payment. Our payment provider will retry automatically.\n\nPlease update your payment details within ${params.graceDays} days to keep chatting without interruption. After that, your chats become read-only until the subscription is renewed.\n\nManage billing: ${BASE_URL}/account/billing`,
  });
}

// Phase 3 — chat. Emails never contain message text (confidentiality).

export async function sendChatAuthorisedEmail(params: { to: string; threadId: string }) {
  await mailer.send({
    to: params.to,
    subject: "PropLink opened a conversation for you",
    text: `PropLink authorised a new conversation for you.\n\nOpen it: ${BASE_URL}/messages/${params.threadId}`,
  });
}

export async function sendNewChatMessageEmail(params: { to: string; threadId: string }) {
  await mailer.send({
    to: params.to,
    subject: "You have a new message on PropLink",
    text: `You have a new message. For privacy, messages are shown only in PropLink.\n\nRead it: ${BASE_URL}/messages/${params.threadId}`,
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

// Phase 4 Task 5 — a project's Solicitor account (ADR-047).
export async function sendSolicitorInviteEmail(params: {
  to: string;
  inviteUrl: string;
  expiresAt: Date;
  projectTitle: string;
}) {
  const expires = params.expiresAt.toUTCString();
  await mailer.send({
    to: params.to,
    subject: `PropLink UK: your Solicitor account for "${params.projectTitle}"`,
    text: `PropLink UK has appointed you as the Solicitor for the project "${params.projectTitle}" and invites you to create its Solicitor account.\n\nAccept the invitation and set your password here:\n${params.inviteUrl}\n\nThe account gives access to this one project only. Two-factor authentication is required before you can use it.\n\nThis link works once, only for this email address, and expires on ${expires}.\n\nIf you were not expecting this invitation, ignore this email.`,
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

// Phase 4 — investor projects. Plain notices; details are only in PropLink.

export type ProjectNotice =
  | "published"
  | "lead_nominated"
  | "lead_accepted"
  | "lead_declined"
  | "lead_withdrawn"
  | "lead_approved"
  | "lead_rejected"
  | "project_open"
  | "update"
  | "ledger_correction"
  | "settled";

const PROJECT_COPY: Record<ProjectNotice, { subject: string; body: string }> = {
  published: {
    subject: "A new investment project is open for interest",
    body: "An agent published a project you can review. Pledges are expressions of interest until an agreement is signed; capital is at risk.",
  },
  lead_nominated: {
    subject: "You were nominated as Lead Investor",
    body: "The project's agent nominated you as its Lead Investor. Accept or decline in PropLink; PropLink then reviews the nomination.",
  },
  lead_accepted: {
    subject: "Your Lead Investor nominee accepted",
    body: "The investor you nominated accepted. PropLink will review and confirm the Lead.",
  },
  lead_declined: {
    subject: "Your Lead Investor nominee declined",
    body: "The investor you nominated declined. You can nominate another interested investor.",
  },
  lead_withdrawn: {
    subject: "A Lead Investor nomination was withdrawn",
    body: "The agent withdrew your nomination as Lead Investor.",
  },
  lead_approved: {
    subject: "The Lead Investor is confirmed",
    body: "PropLink confirmed the project's Lead Investor. The project is now open for co-investor pledges.",
  },
  lead_rejected: {
    subject: "A Lead Investor nomination was not approved",
    body: "PropLink did not approve the Lead Investor nomination. The agent can nominate another investor.",
  },
  project_open: {
    subject: "A project you follow is open for pledges",
    body: "A project you expressed interest in confirmed its Lead Investor and is open for pledges (expressions of interest until signed).",
  },
  update: {
    subject: "There is an update on your project",
    body: "There is a new update on a project you are part of.",
  },
  ledger_correction: {
    subject: "A correction was made to your project ledger",
    body: "PropLink approved a correction to a ledger entry that affects you. The original entry is kept; the correction is shown beside it. Your statement is updated.",
  },
  settled: {
    subject: "Your project has been settled",
    body: "The Solicitor recorded the settlement under the signed agreement. Your distributions and statement are ready in PropLink. Payments are made by the Solicitor outside PropLink.",
  },
};

export async function sendProjectEmail(params: {
  to: string;
  notice: ProjectNotice;
  projectTitle: string;
  path: string;
}) {
  const copy = PROJECT_COPY[params.notice];
  await mailer.send({
    to: params.to,
    subject: `${copy.subject}: "${params.projectTitle}"`,
    text: `${copy.body}\n\n"${params.projectTitle}": ${BASE_URL}${params.path}`,
  });
}

// Phase 5 Task 3 (ADR-056): saved-search alert. Plain text; titles and towns
// only (public listing data); the unsubscribe link needs no sign-in.

export async function sendSavedSearchAlertEmail(params: {
  to: string;
  searchName: string;
  listings: { id: string; title: string; city: string }[];
  unsubscribeToken: string;
}) {
  const lines = params.listings
    .map((l) => `- ${l.title}, ${l.city}: ${BASE_URL}/marketplace/${l.id}`)
    .join("\n");
  await mailer.send({
    to: params.to,
    subject: `New listings for "${params.searchName}"`,
    text: `New properties match your saved search "${params.searchName}" on PropLink UK:\n\n${lines}\n\nStop these alerts: ${BASE_URL}/alerts/unsubscribe/${params.unsubscribeToken}`,
  });
}
