import type { MetadataRoute } from "next";
import { robotsRules, siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", ...robotsRules() }], sitemap: `${siteUrl()}/sitemap.xml` };
}
