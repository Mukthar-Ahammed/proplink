import * as Sentry from "@sentry/nextjs";
import { getServerEnv, validateRuntimeEnv } from "@/env";
import { scrubSentryEvent } from "@/lib/security/sentry-scrub";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") validateRuntimeEnv();
  const env = getServerEnv();
  if (!env.SENTRY_DSN) return;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    enableLogs: true,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export const onRequestError = Sentry.captureRequestError;
