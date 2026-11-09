import { jsonLdString } from "@/lib/seo";

/** Structured data for search engines. The text is escaped so it can never close its own <script> tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(data) }} />;
}
