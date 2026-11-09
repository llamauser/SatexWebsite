import { describe, expect, it } from "vitest";
import { scrubEvent, scrubUrl } from "@/lib/monitoring/scrub";
import { alternatesFor, breadcrumbLd, jsonLdString, localizedPath, organizationLd, productLd, robotsRules, siteUrl, STATIC_PAGES } from "@/lib/seo";
import { buildCsp, cameraPermissionsPolicy, securityHeaders } from "@/lib/security-headers";

describe("site URL and canonical links", () => {
  it("uses the configured URL without a trailing slash, and a local default", () => {
    expect(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://satex.example///" } as never)).toBe("https://satex.example");
    expect(siteUrl({} as never)).toBe("http://localhost:3000");
  });
  it("the home page is /fr, other pages keep their path", () => {
    expect(localizedPath("fr", "/")).toBe("/fr");
    expect(localizedPath("ar", "/catalog/linen")).toBe("/ar/catalog/linen");
  });
  it("canonical plus one alternate per language and an x-default", () => {
    const a = alternatesFor("en", "/catalog");
    expect(a.canonical).toMatch(/\/en\/catalog$/);
    expect(Object.keys(a.languages as object)).toEqual(["fr", "en", "ar", "x-default"]);
    expect((a.languages as Record<string, string>)["x-default"]).toMatch(/\/fr\/catalog$/);
    expect((alternatesFor("fr", "/").languages as Record<string, string>).ar).toMatch(/\/ar$/);
  });
  it("the sitemap lists public pages only", () => {
    const paths = STATIC_PAGES.map((p) => p.path);
    expect(paths).toContain("/catalog");
    expect(paths.some((p) => /account|admin|auth|api/.test(p))).toBe(false);
  });
});

describe("robots rules", () => {
  it("keep private areas and search results out", () => {
    const r = robotsRules();
    expect(r.allow).toBe("/");
    for (const p of ["/api/", "/*/account", "/*/admin", "/*/auth/", "/*/match/"]) expect(r.disallow).toContain(p);
  });
});

describe("structured data", () => {
  it("cannot close its own script tag", () => {
    const s = jsonLdString({ name: "</script><script>alert(1)</script>", line: `a${String.fromCharCode(0x2028)}b` });
    expect(s).not.toContain("</script>");
    expect(s).not.toContain("<");
    expect(s).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(s).name).toBe("</script><script>alert(1)</script>");
  });
  it("organization", () => {
    expect(organizationLd({ name: "SATEX", url: "https://x/fr", email: "a@b.c", foundedYear: 1995 })).toMatchObject({
      "@type": "Organization", name: "SATEX", foundingDate: "1995", contactPoint: { email: "a@b.c" },
    });
    expect(organizationLd({ name: "S", url: "u" })).not.toHaveProperty("contactPoint");
  });
  it("a product has offers only when a price is known", () => {
    const base = { name: "Lin", sku: "L1", url: "u", brand: "SATEX", currency: "EUR", inStock: true };
    const priced = productLd({ ...base, lowPrice: 8.5, highPrice: 12 }) as { offers: Record<string, string> };
    expect(priced.offers).toMatchObject({ "@type": "AggregateOffer", priceCurrency: "EUR", lowPrice: "8.50", highPrice: "12.00", availability: "https://schema.org/InStock" });
    expect(productLd({ ...base, lowPrice: null, highPrice: null })).not.toHaveProperty("offers");
    expect((productLd({ ...base, lowPrice: 1, highPrice: null, inStock: false }) as { offers: Record<string, string> }).offers.availability).toBe("https://schema.org/OutOfStock");
  });
  it("breadcrumbs are numbered from 1", () => {
    const b = breadcrumbLd([{ name: "A", url: "ua" }, { name: "B", url: "ub" }]) as { itemListElement: { position: number }[] };
    expect(b.itemListElement.map((i) => i.position)).toEqual([1, 2]);
  });
});

describe("Content-Security-Policy", () => {
  const prod = buildCsp({ supabaseUrl: "https://abc.supabase.co/", dev: false });
  it("production: no eval, nothing framed, no plugins", () => {
    expect(prod).not.toContain("unsafe-eval");
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain("object-src 'none'");
    expect(prod).toContain("base-uri 'self'");
    expect(prod).toContain("form-action 'self'");
    expect(prod).toContain("default-src 'self'");
  });
  it("allows Supabase (data, images, realtime) and the monitoring and analytics services", () => {
    expect(prod).toMatch(/connect-src [^;]*https:\/\/abc\.supabase\.co/);
    expect(prod).toMatch(/connect-src [^;]*wss:\/\/abc\.supabase\.co|connect-src [^;]*wss:\/\/\*\.supabase\.co/);
    expect(prod).toMatch(/img-src [^;]*https:\/\/abc\.supabase\.co/);
    expect(prod).toContain("https://*.ingest.sentry.io");
    expect(prod).toContain("https://va.vercel-scripts.com");
  });
  it("a local Supabase gets its http and ws origins", () => {
    const local = buildCsp({ supabaseUrl: "http://127.0.0.1:54321" });
    expect(local).toContain("http://127.0.0.1:54321");
    expect(local).toContain("ws://127.0.0.1:54321");
  });
  it("only development may use eval", () => {
    expect(buildCsp({ dev: true })).toContain("'unsafe-eval'");
  });
  it("an unusable Supabase URL is ignored, not copied into the policy", () => {
    expect(buildCsp({ supabaseUrl: "not a url" })).not.toContain("not a url");
  });
});

describe("security headers", () => {
  const names = (production: boolean) => securityHeaders({ production }).map((h) => h.key);
  it("the set is complete; HSTS only in production", () => {
    expect(names(false)).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy", "X-Frame-Options"]));
    expect(names(false)).not.toContain("Strict-Transport-Security");
    expect(names(true)).toContain("Strict-Transport-Security");
  });
  it("values", () => {
    const get = (k: string) => securityHeaders({ production: true }).find((h) => h.key === k)!.value;
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get("Strict-Transport-Security")).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(get("Permissions-Policy")).toContain("camera=()");
    expect(cameraPermissionsPolicy).toContain("camera=(self)");
  });
});

describe("error reports carry no personal data", () => {
  it("removes cookies, bodies, sensitive headers, e-mail and IP, and tokens in URLs", () => {
    const e = scrubEvent({
      user: { id: "u1", email: "a@b.c", ip_address: "1.2.3.4" },
      request: { url: "https://x/fr/auth/callback?code=abc123&next=/fr", cookies: { sb: "x" }, data: { password: "secret" }, query_string: "code=abc", headers: { Authorization: "Bearer t", Cookie: "c", "User-Agent": "UA", "x-forwarded-for": "1.1.1.1" } },
      breadcrumbs: [{ message: "GET https://x/?access_token=zzz", data: { url: "https://x/y?token=qqq&a=1", status: 200 } }],
    });
    expect(e.user).toEqual({ id: "u1" });
    expect(e.request).toEqual({ url: "https://x/fr/auth/callback?code=[removed]&next=/fr", headers: { "User-Agent": "UA" } });
    expect(e.breadcrumbs![0]).toEqual({ message: "GET https://x/?access_token=[removed]", data: { url: "https://x/y?token=[removed]&a=1", status: 200 } });
  });
  it("copes with empty events", () => {
    expect(scrubEvent({})).toEqual({});
    expect(scrubEvent({ user: { email: "a@b.c" } }).user).toEqual({});
    expect(scrubUrl("https://x/?q=1")).toBe("https://x/?q=1");
  });
});
