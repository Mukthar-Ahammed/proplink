/**
 * In-app e-signature contract (Phase 3 Task 5 groundwork, implemented in
 * Phase 4 Task 6, ADR-048; business Q16-Q17: agreements are signed in the
 * app via the Solicitor). The Solicitor's agreement goes to every party as
 * one envelope; per-signer events arrive by verified webhook; the signed PDF
 * comes back to PropLink and is stored privately, hashed and versioned.
 */

export type SignerRole = "LANDLORD" | "AGENT" | "INVESTOR" | "SOLICITOR";

export type ESignSigner = {
  profileId: string;
  role: SignerRole;
  email: string;
  name: string;
};

export type ESignRequest = {
  /** The agreement's PDF (a clean upload from the Phase 1 pipeline). */
  document: { bytes: Uint8Array; fileName: string };
  title: string;
  /** Where the request came from, e.g. a project agreement. */
  context: { type: "CHAT_THREAD" | "MANDATE" | "PROJECT_AGREEMENT"; id: string };
  signers: ESignSigner[];
  /** Provider test mode (no legal effect); always on outside production. */
  testMode: boolean;
};

export type ESignStatus =
  "SENT" | "VIEWED" | "SIGNED" | "DECLINED" | "EXPIRED" | "VOIDED";

/** A verified provider event, normalised. */
export type ESignEvent = {
  /** Stable per event: the replay key. */
  eventId: string;
  envelopeId: string;
  occurredAt: Date;
  /** SIGNED/DECLINED with a signer: that signer; ALL_SIGNED: the envelope. */
  type: "SIGNED" | "DECLINED" | "ALL_SIGNED" | "EXPIRED" | "VOIDED" | "OTHER";
  providerSignerId: string | null;
};

export class ESignWebhookError extends Error {}

export interface ESignProvider {
  readonly name: "mock" | "dropbox_sign";
  /**
   * Creates an envelope; returns the provider's id and each signer's provider
   * id, in the order given.
   */
  createEnvelope(request: ESignRequest): Promise<{
    envelopeId: string;
    signerIds: string[];
  }>;
  /**
   * A short-lived link for one signer to sign now, or null when the provider
   * emails each signer their own link (Dropbox Sign non-embedded).
   */
  signingUrl(
    envelopeId: string,
    providerSignerId: string,
    returnPath: string,
  ): Promise<string | null>;
  /** Sends a signer a fresh signing email or link (expired links, Q44). */
  remind(envelopeId: string, signerEmail: string): Promise<void>;
  /** Cancels an envelope that should no longer be signed. */
  cancel(envelopeId: string): Promise<void>;
  /** Verifies a callback (throws ESignWebhookError) and normalises it. */
  parseWebhook(rawBody: string, headers: Headers): ESignEvent;
  /** The completed, signed document. */
  downloadSigned(envelopeId: string): Promise<Uint8Array>;
}
