import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/security/sentry-scrub";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
