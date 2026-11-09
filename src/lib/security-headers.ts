/**
 * HTTP security headers (docs/11-non-functional.md §5). Plain functions with no imports so that next.config.ts can use them,
 * and so that they are unit-tested. The CSP allows what the site really loads: its own files, Supabase (data, images, realtime),
 * Vercel analytics and the error-monitoring service. No `unsafe-eval` in production.
 */
export interface CspOptions {
  supabaseUrl?: string | undefined;
  dev?: boolean;
}

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp({ supabaseUrl, dev = false }: CspOptions = {}): string {
  const supabase = origin(supabaseUrl);
  const supabaseWs = supabase ? supabase.replace(/^http/, "ws") : null;
  const list = (...v: (string | null | false)[]) => v.filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    // Next.js writes small inline scripts into every page; a nonce would force every page to be rendered per request.
    `script-src ${list("'self'", "'unsafe-inline'", dev && "'unsafe-eval'", "https://va.vercel-scripts.com")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${list("'self'", "data:", "blob:", supabase, "https://*.supabase.co")}`,
    "font-src 'self' data:",
    `connect-src ${list("'self'", supabase, supabaseWs, "https://*.supabase.co", "wss://*.supabase.co", "https://*.ingest.sentry.io", "https://*.ingest.de.sentry.io", "https://*.ingest.us.sentry.io", "https://vitals.vercel-insights.com", dev && "ws://localhost:*")}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export interface Header { key: string; value: string }

export function securityHeaders(opts: CspOptions & { production?: boolean } = {}): Header[] {
  const headers: Header[] = [
    { key: "Content-Security-Policy", value: buildCsp(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    // the camera is only needed by Snap & Match and the live tour (later phases): those pages get their own rule
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
  if (opts.production) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
  return headers;
}

/** Pages that may use the camera / microphone. */
export const CAMERA_PAGES = ["/:locale/snap", "/:locale/tour/:path*"] as const;
export const cameraPermissionsPolicy = "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()";
