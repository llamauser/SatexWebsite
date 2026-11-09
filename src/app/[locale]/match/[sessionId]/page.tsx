import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { MatchResults, type ResultView } from "@/components/match/MatchResults";
import { routing } from "@/i18n/routing";
import { createServerSupabase } from "@/lib/db/server";
import { createServiceSupabase } from "@/lib/db/service";
import { supabaseEnv } from "@/lib/db/env";
import { getPublicSettings, storageUrl } from "@/lib/data/public";
import type { Refinement } from "@/lib/match/refine";
import { emptySpec, type Spec } from "@/lib/match/schema";
import { isOwner, loadSession } from "@/lib/match/service";

type Props = { params: Promise<{ locale: string; sessionId: string }> };
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "match.results" });
  return { title: t("title"), robots: { index: false } };
}

export default async function MatchSessionPage({ params }: Props) {
  const { locale, sessionId } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  let sb;
  try {
    sb = createServiceSupabase();
  } catch {
    notFound();
  }
  const session = await loadSession(sb, sessionId);
  const iteration = session?.iterations.at(-1);
  if (!session || !iteration) notFound();

  // anyone with the link can read the results; only the owner can refine or vote
  let userId: string | null = null;
  if (supabaseEnv()) {
    try {
      userId = (await (await createServerSupabase()).auth.getUser()).data.user?.id ?? null;
    } catch {
      userId = null;
    }
  }
  const owner = isOwner(session, { userId, token: (await cookies()).get("satex_match")?.value ?? null });
  const settings = await getPublicSettings();
  const results: ResultView[] = (iteration.results ?? []).map((r) => ({ ...r, imageUrl: r.imagePath ? storageUrl(r.imagePath) : null }));

  return (
    <main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6 lg:px-8">
      <BlobBackground />
      <MatchResults
        sessionId={session.id}
        input={session.input}
        spec={(iteration.specs ?? session.iterations[0]?.specs ?? emptySpec()) as Spec}
        results={results}
        activeRefinements={iteration.refinements as Refinement[]}
        canRefine={owner}
        feedback={session.feedback}
        currency={settings.currency}
      />
    </main>
  );
}
