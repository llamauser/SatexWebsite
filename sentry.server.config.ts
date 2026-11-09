import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "./src/lib/monitoring/scrub";

// Loaded by instrumentation.ts only when SENTRY_DSN is set. Errors only (no performance tracing), no personal data.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0,
  beforeSend: (event) => scrubEvent(event as never) as never,
});
