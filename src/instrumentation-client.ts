import { scrubEvent } from "./lib/monitoring/scrub";

// Browser error monitoring, only when NEXT_PUBLIC_SENTRY_DSN is set. The SDK is loaded in its own chunk after the page has
// finished loading, so it never weighs on the first load or on the Lighthouse score.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn && typeof window !== "undefined") {
  window.addEventListener("load", () => {
    setTimeout(() => {
      void import("@sentry/nextjs").then((Sentry) =>
        Sentry.init({
          dsn,
          environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
          tracesSampleRate: 0,
          beforeSend: (event) => scrubEvent(event as never) as never,
        }),
      );
    }, 1500);
  });
}
