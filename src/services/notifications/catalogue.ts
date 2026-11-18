import { Role } from "@/generated/prisma/enums";

/**
 * Notification events (Phase 1 Task 10, ADR-029). Business Q12: "Agents are
 * customers of Landlords; Investors of Agents; Co-Investors of the Lead
 * Investor; Buyers of Agents. Notifications follow that chain and respect
 * per-user preferences." Each event names the roles that receive it along
 * that chain and the phase that delivers it. Later phases add senders, not
 * new preference plumbing.
 *
 * Mandatory events (account security, verification decisions, ledger
 * corrections, which business rules require us to notify) cannot be
 * switched off on any channel.
 */

export type NotificationChannel = "inApp" | "email";

export type NotificationEvent = {
  key: string;
  label: string;
  description: string;
  roles: readonly Role[];
  defaults: Record<NotificationChannel, boolean>;
  mandatory: boolean;
  /** Phase that sends it; shown to users as "coming soon" until then. */
  deliveredInPhase: number;
};

const ALL_SIGNED_IN: readonly Role[] = [
  Role.LANDLORD,
  Role.AGENT,
  Role.INVESTOR,
  Role.BUYER,
  Role.SOLICITOR,
  Role.ADVERTISER,
  Role.ADMIN,
];
const CHAT_ROLES: readonly Role[] = [
  Role.LANDLORD,
  Role.AGENT,
  Role.INVESTOR,
  Role.BUYER,
];

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  {
    key: "account.security",
    label: "Account and security",
    description: "Sign-in, password, suspension and reinstatement notices.",
    roles: ALL_SIGNED_IN,
    defaults: { inApp: true, email: true },
    mandatory: true,
    deliveredInPhase: 1,
  },
  {
    key: "verification.decision",
    label: "Verification results",
    description: "The outcome of your identity or company verification.",
    roles: [Role.LANDLORD, Role.INVESTOR, Role.AGENT],
    defaults: { inApp: true, email: true },
    mandatory: true,
    deliveredInPhase: 1,
  },
  {
    key: "platform.update",
    label: "PropLink updates",
    description: "Platform updates and announcements from PropLink.",
    roles: [Role.AGENT],
    defaults: { inApp: true, email: false },
    mandatory: false,
    deliveredInPhase: 1,
  },
  {
    key: "billing.payment",
    label: "Subscription payments",
    description: "A subscription payment failed and your access may become read-only.",
    roles: [Role.AGENT, Role.INVESTOR],
    defaults: { inApp: true, email: true },
    mandatory: true,
    deliveredInPhase: 3,
  },
  // Landlord → Agent link of the chain (Phase 2).
  {
    key: "listing.review_decision",
    label: "Listing review results",
    description: "PropLink approved your property listing or asked for changes.",
    roles: [Role.LANDLORD],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 2,
  },
  {
    key: "listing.private_listing",
    label: "New landlord listings",
    description: "A landlord's listing passed PropLink review and is open to agents.",
    roles: [Role.AGENT],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 2,
  },
  {
    key: "mandate.offer",
    label: "Agent offers on your listing",
    description: "An agent offered terms or a valuation for your listing.",
    roles: [Role.LANDLORD],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 2,
  },
  {
    key: "mandate.response",
    label: "Agent responses to your mandate",
    description: "The agent you chose accepted or declined, or a mandate ended.",
    roles: [Role.LANDLORD],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 2,
  },
  {
    key: "proposal.question",
    label: "Landlord questions on your proposals",
    description: "A landlord asked a question about one of your proposals.",
    roles: [Role.AGENT],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 2,
  },
  {
    key: "proposal.answer",
    label: "Agent answers",
    description: "An agent answered your question about their proposal.",
    roles: [Role.LANDLORD],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 2,
  },
  {
    key: "mandate.decision",
    label: "Mandate decisions",
    description: "A landlord accepted or declined your offer, or a mandate ended.",
    roles: [Role.AGENT],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 2,
  },
  // Chat along every allowed pair (Phase 3).
  {
    key: "chat.authorised",
    label: "Chat opened",
    description: "PropLink authorised a new conversation for you.",
    roles: CHAT_ROLES,
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 3,
  },
  {
    key: "chat.message",
    label: "New messages",
    description: "Someone sent you a message.",
    roles: CHAT_ROLES,
    defaults: { inApp: true, email: false },
    mandatory: false,
    deliveredInPhase: 3,
  },
  // Agent → Buyer link (existing retail flows).
  {
    key: "retail.enquiry",
    label: "Buyer enquiries",
    description:
      "A buyer enquired about, asked to view or made an offer on your listing.",
    roles: [Role.AGENT],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 3,
  },
  {
    key: "retail.response",
    label: "Replies from agents",
    description: "An agent responded to your enquiry, viewing request or offer.",
    roles: [Role.BUYER],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 3,
  },
  // Agent → Investor → Co-Investor links (Phase 4).
  {
    key: "project.published",
    label: "New investment opportunities",
    description: "An agent published a project you can review.",
    roles: [Role.INVESTOR],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 4,
  },
  {
    key: "project.update",
    label: "Project updates",
    description:
      "Status updates on projects you are part of, from the agent or solicitor.",
    roles: [Role.INVESTOR, Role.AGENT, Role.LANDLORD],
    defaults: { inApp: true, email: true },
    mandatory: false,
    deliveredInPhase: 4,
  },
  {
    key: "ledger.correction",
    label: "Ledger corrections",
    description: "A correction to a project ledger entry that affects you.",
    roles: [Role.INVESTOR, Role.AGENT, Role.LANDLORD],
    defaults: { inApp: true, email: true },
    mandatory: true,
    deliveredInPhase: 4,
  },
];

const BY_KEY = new Map(NOTIFICATION_EVENTS.map((event) => [event.key, event]));

export function getNotificationEvent(key: string): NotificationEvent | undefined {
  return BY_KEY.get(key);
}

export function eventsForRole(role: Role): NotificationEvent[] {
  return NOTIFICATION_EVENTS.filter((event) => event.roles.includes(role));
}
