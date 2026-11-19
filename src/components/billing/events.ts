/**
 * Window event that opens the subscription popup from anywhere on the page
 * (e.g. a locked portal tab). A plain DOM event so the nav and the popup stay
 * decoupled: the popup is rendered once by the portal layout and listens.
 */
export const OPEN_SUBSCRIPTION_EVENT = "proplink:open-subscription";
