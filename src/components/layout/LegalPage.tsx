import { TriangleAlert } from "lucide-react";
import { fillLegal, LEGAL, type LegalDoc } from "@/content/legal";
import { getPublicSettings } from "@/lib/data/public";
import { BlobBackground } from "./BlobBackground";

export async function LegalPage({ doc, locale }: { doc: LegalDoc; locale: "fr" | "en" | "ar" }) {
  const content = LEGAL[doc][locale];
  const settings = await getPublicSettings();
  const vars = { company: settings.companyName, email: settings.contactEmail };
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <BlobBackground />
      <h1 className="font-display text-4xl font-bold">{content.title}</h1>
      <p className="mt-2 text-sm text-text-muted">{content.updated}</p>
      <p role="note" className="mt-6 flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        {content.notice}
      </p>
      {content.sections.map((s, i) => (
        <section key={s.title} className="mt-8" aria-labelledby={`sec-${i}`}>
          <h2 id={`sec-${i}`} className="font-display text-xl font-semibold">
            {i + 1}. {s.title}
          </h2>
          {s.body.map((p) => (
            <p key={p} className="mt-2 text-text-muted">
              {fillLegal(p, vars)}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
