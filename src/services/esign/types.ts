/**
 * In-app e-signature contract (Phase 3 Task 5 groundwork, ADR-043; business
 * Q16-Q17: agreements are signed in the app via the Solicitor). Phase 4
 * implements a provider (and its mock) behind this interface; until then
 * `getESignProvider()` returns null and nothing offers signing.
 */

export type SignerRole = "LANDLORD" | "AGENT" | "INVESTOR" | "SOLICITOR";

export type ESignRequest = {
  /** A clean upload (Phase 1 pipeline) owned by the requester. */
  fileId: string;
  title: string;
  /** Where the request came from, e.g. a chat thread or a project agreement. */
  context: { type: "CHAT_THREAD" | "MANDATE" | "PROJECT_AGREEMENT"; id: string };
  signers: { profileId: string; role: SignerRole; email: string; name: string }[];
};

export type ESignStatus =
  "SENT" | "VIEWED" | "SIGNED" | "DECLINED" | "EXPIRED" | "VOIDED";

export interface ESignProvider {
  readonly name: "mock" | string;
  /** Creates an envelope; returns the provider's id. */
  createEnvelope(request: ESignRequest): Promise<{ envelopeId: string }>;
  /** A short-lived signing URL for one signer, opened in the app. */
  signingUrl(
    envelopeId: string,
    signerProfileId: string,
    returnUrl: string,
  ): Promise<string>;
  /** Verifies a provider callback and reports the new status. */
  parseWebhook(
    rawBody: string,
    headers: Headers,
  ): { envelopeId: string; status: ESignStatus };
  /** The completed, signed document (stored back through the upload pipeline). */
  downloadSigned(envelopeId: string): Promise<Uint8Array>;
}
