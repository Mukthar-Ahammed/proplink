/**
 * What each subscription is for, in the owner's words (Clarification
 * Answers §D, Q10): the subscription lets these roles chat, once PropLink
 * authorises each chat. Nothing else in the business model needs one.
 * `includes` is the popup's checklist; every line restates that rule.
 */
export const PLAN_COPY: Record<
  string,
  { title: string; body: string; includes: string[] }
> = {
  AGENT: {
    title: "Agent",
    body: "Chat with Landlords about their properties, with investors on your projects, and with Buyers on your listings.",
    includes: [
      "Chat with Landlords about their properties",
      "Chat with investors on your projects",
      "Chat with Buyers on your listings",
    ],
  },
  LEAD_INVESTOR: {
    title: "Lead Investor",
    body: "Chat with the Agent and your Co-Investors on the projects you lead.",
    includes: ["Chat with the Agent on projects you lead", "Chat with your Co-Investors"],
  },
  CO_INVESTOR: {
    title: "Co-Investor",
    body: "Chat with the Agent and the Lead Investor on the projects you join.",
    includes: ["Chat with the Agent on projects you join", "Chat with the Lead Investor"],
  },
};
