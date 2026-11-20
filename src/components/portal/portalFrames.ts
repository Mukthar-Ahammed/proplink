/**
 * Each role portal's banner masthead, in one place so the portal layout and
 * pages that live outside the portal's route tree but wear its frame
 * (Messages, ADR-081) show exactly the same header. Clicking the Messages tab
 * then only swaps the content under the tabs.
 */
export type PortalFrame = {
  eyebrow: string;
  title: string;
  titleTail: string;
  standfirst: string;
  banner: { src: string };
};

export const AGENT_FRAME: PortalFrame = {
  eyebrow: "Agent portal",
  title: "Your stock,",
  titleTail: "your record",
  standfirst:
    "Private landlord stock, verified mandates and investor projects, in one place.",
  banner: { src: "/banners/agent%20banner.png" },
};

export const INVESTOR_FRAME: PortalFrame = {
  eyebrow: "Investor portal",
  title: "Your syndicates,",
  titleTail: "your position",
  standfirst: "Expressions of interest, funding progress and the projects behind them.",
  banner: { src: "/banners/investor%20portal%20banner.png" },
};

export const LANDLORD_FRAME: PortalFrame = {
  eyebrow: "Landlord portal",
  title: "Your property,",
  titleTail: "privately",
  standfirst:
    "Listings stay private: only PropLink-verified agents see them, after our review.",
  banner: { src: "/banners/landloard%20portal%20banner.png" },
};

export const BUYER_FRAME: PortalFrame = {
  eyebrow: "Buyer portal",
  title: "Find the",
  titleTail: "right defect",
  standfirst:
    "Every listing with disclosed defects and its EPC rating on the face of it.",
  banner: { src: "/banners/buyer%20portal%20banner.png" },
};
