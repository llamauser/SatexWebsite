import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { CAMERA_PAGES, cameraPermissionsPolicy, securityHeaders } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Fabric photos live in Supabase Storage: allow its host for next/image.
function supabaseImagePattern() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const u = new URL(raw);
    return [
      {
        protocol: u.protocol.replace(":", "") as "http" | "https",
        hostname: u.hostname,
        ...(u.port ? { port: u.port } : {}),
        pathname: "/storage/v1/object/public/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  // `pnpm dev` writes to its own folder, so a production build (or the e2e tests) can never break a dev server that is running.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  images: { remotePatterns: supabaseImagePattern(), formats: ["image/avif", "image/webp"] },
  // The quote PDF is rendered on the server with react-pdf, which reads the font files at run time: make sure they ship with the route.
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    const opts = { supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV !== "production", production: process.env.NODE_ENV === "production" };
    return [
      { source: "/:path*", headers: securityHeaders(opts) },
      // later rules win for the same header: the camera pages relax only the Permissions-Policy
      ...CAMERA_PAGES.map((source) => ({ source, headers: [{ key: "Permissions-Policy", value: cameraPermissionsPolicy }] })),
    ];
  },
  outputFileTracingIncludes: { "/api/admin/quotes/[id]/send": ["./assets/fonts/**/*"] },
};

export default withNextIntl(nextConfig);
