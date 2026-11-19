import type { AuthActionResult } from "@/app/(auth)/actions";

/**
 * Shown when an auth Server Action call fails before the action can answer.
 * Deliberately generic: it must not reveal whether an account exists.
 */
export const AUTH_ACTION_UNAVAILABLE_MESSAGE =
  "Too many attempts, or the service is temporarily unavailable. Please wait a minute and try again.";

/** Cooldown applied to the form after an unanswered auth request. */
export const AUTH_ACTION_UNAVAILABLE_COOLDOWN_SECONDS = 60;

/**
 * Calls an auth Server Action and never lets it reject.
 *
 * The proxy rate-limits `/login`, `/admin/login`, `/register` and the password
 * reset routes before any Server Action runs. When it blocks a request it
 * answers with JSON (429, 503 or 403), which React cannot read as an action
 * result, so the action call rejects. A network failure rejects the same way.
 * Without this wrapper the form shows nothing and the browser logs an
 * unhandled rejection; with it the form shows a generic "limited" message and
 * starts its cooldown.
 */
export async function runAuthAction<T extends AuthActionResult>(
  call: () => Promise<T>,
): Promise<T | AuthActionResult> {
  try {
    return await call();
  } catch {
    return {
      kind: "limited",
      message: AUTH_ACTION_UNAVAILABLE_MESSAGE,
      cooldownSeconds: AUTH_ACTION_UNAVAILABLE_COOLDOWN_SECONDS,
    };
  }
}
