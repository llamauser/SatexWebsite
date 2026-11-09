import type { MetadataRoute } from "next";
import { getActiveFabricSlugs } from "@/lib/data/catalog";
import { alternatesFor, LOCALES, localizedPath, siteUrl, STATIC_PAGES } from "@/lib/seo";

export const revalidate = 3600;

/** Every public page in every language, with its translations as alternates; fabrics come from the database. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const entry = (path: string, priority: number, changeFrequency: "daily" | "weekly" | "monthly" | "yearly", lastModified?: string) =>
    LOCALES.map((locale) => ({
      url: `${base}${localizedPath(locale, path)}`,
      lastModified: lastModified ?? undefined,
      changeFrequency,
      priority,
      alternates: { languages: alternatesFor(locale, path).languages as Record<string, string> },
    }));
  const fabrics = await getActiveFabricSlugs();
  return [
    ...STATIC_PAGES.flatMap((p) => entry(p.path, p.priority, p.changeFrequency)),
    ...fabrics.flatMap((f) => entry(`/catalog/${f.slug}`, 0.8, "weekly", f.updatedAt)),
  ];
}
