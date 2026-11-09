/** SEO helpers (docs/11-non-functional.md §4, docs/09-i18n.md): site URL, canonical + hreflang, JSON-LD. Pure. */
import type { Metadata } from "next";

export const LOCALES = ["fr", "en", "ar"] as const;
export const DEFAULT_LOCALE = "fr";

/** Public URL of the site, without a trailing slash. */
export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

/** "/fr/catalog/linen" for ("fr", "/catalog/linen"); the home page is "/fr". */
export const localizedPath = (locale: string, path: string) => `/${locale}${path === "/" ? "" : path}`;

/** Canonical URL and hreflang alternates of a page. `path` has no locale ("/catalog", "/"). */
export function alternatesFor(locale: string, path: string): NonNullable<Metadata["alternates"]> {
  const base = siteUrl();
  return {
    canonical: `${base}${localizedPath(locale, path)}`,
    languages: {
      ...Object.fromEntries(LOCALES.map((l) => [l, `${base}${localizedPath(l, path)}`])),
      "x-default": `${base}${localizedPath(DEFAULT_LOCALE, path)}`,
    },
  };
}

/** JSON-LD must not be able to close its own <script> tag. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .split(String.fromCharCode(0x2028)).join("\\u2028")
    .split(String.fromCharCode(0x2029)).join("\\u2029");
}

export function organizationLd(o: { name: string; url: string; email?: string; phone?: string; foundedYear?: number; logo?: string; description?: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: o.name,
    url: o.url,
    ...(o.logo ? { logo: o.logo } : {}),
    ...(o.description ? { description: o.description } : {}),
    ...(o.foundedYear ? { foundingDate: String(o.foundedYear) } : {}),
    ...(o.email || o.phone ? { contactPoint: { "@type": "ContactPoint", contactType: "sales", ...(o.email ? { email: o.email } : {}), ...(o.phone ? { telephone: o.phone } : {}) } } : {}),
  };
}

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

/** Product with offers: only when prices are public (a price shown to search engines must be a price shown to visitors). */
export function productLd(p: { name: string; description?: string; sku: string; url: string; image?: string; brand: string; currency: string; lowPrice: number | null; highPrice: number | null; inStock: boolean }) {
  const offers = p.lowPrice === null ? undefined : {
    "@type": "AggregateOffer",
    priceCurrency: p.currency,
    lowPrice: p.lowPrice.toFixed(2),
    highPrice: (p.highPrice ?? p.lowPrice).toFixed(2),
    availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    url: p.url,
  };
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    sku: p.sku,
    ...(p.description ? { description: p.description } : {}),
    ...(p.image ? { image: p.image } : {}),
    brand: { "@type": "Brand", name: p.brand },
    ...(offers ? { offers } : {}),
  };
}

/** Pages that must stay out of search results (sign-in, account, admin, results of a private search). */
export const NOINDEX: Metadata["robots"] = { index: false, follow: false };

/** Robots rules (docs/11 §4). Paths carry a locale prefix, so the rules use wildcards. */
export function robotsRules() {
  return {
    allow: "/",
    disallow: ["/api/", "/*/account", "/*/admin", "/*/auth/", "/*/match/", "/*/forbidden"],
  };
}

/** Static public pages of the sitemap (path without locale). */
export const STATIC_PAGES: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/catalog", priority: 0.9, changeFrequency: "daily" },
  { path: "/match", priority: 0.7, changeFrequency: "monthly" },
  { path: "/showroom", priority: 0.7, changeFrequency: "weekly" },
  { path: "/about", priority: 0.5, changeFrequency: "yearly" },
  { path: "/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.2, changeFrequency: "yearly" },
];
