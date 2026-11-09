import type { Instrumentation } from "next";

/** Error monitoring is off unless SENTRY_DSN is set; nothing is imported (nor loaded) otherwise. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) await import("./sentry.server.config");
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};
