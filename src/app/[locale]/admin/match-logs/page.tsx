import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createServiceSupabase } from "@/lib/db/service";
import type { ResultCard } from "@/lib/match/card";

export const dynamic = "force-dynamic";

type Row = {
  id: string; created_at: string; locale: string; mode: string; input: { description?: string }; feedback: number | null;
  match_session_iterations: { n: number; refinements: string[]; results: ResultCard[] | null; latency_ms: number | null; cost_usd: number | null; specs: unknown }[];
};

/** Admin only (enforced by the middleware): what people asked, what we understood, what we answered, how fast and how much it cost. */
export default async function MatchLogsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("admin.matchLogs");

  const sb = createServiceSupabase();
  const { data } = await sb
    .from("match_sessions")
    .select("id, created_at, locale, mode, input, feedback, match_session_iterations(n, refinements, results, latency_ms, cost_usd, specs)")
    .order("created_at", { ascending: false })
    .limit(100);
  const rows = (data ?? []) as Row[];

  return (
    <div>
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-text-muted">{t("lead")}</p>
      <div className="mt-6 overflow-x-auto rounded-md border border-border bg-surface">
        <table className="w-full text-start text-sm" data-testid="match-log-table">
          <thead className="bg-surface-muted text-text-muted">
            <tr>
              {["date", "locale", "brief", "top", "feedback", "latency", "cost"].map((k) => (
                <th key={k} scope="col" className="px-3 py-2 text-start font-medium">{t(`cols.${k}` as never)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const last = [...r.match_session_iterations].sort((a, b) => a.n - b.n).at(-1);
              const top = last?.results?.[0];
              return (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="px-3 py-2">{r.locale}</td>
                  <td className="max-w-md px-3 py-2">
                    <details>
                      <summary className="cursor-pointer">{(r.input.description ?? "").slice(0, 80)}</summary>
                      <pre className="mt-2 overflow-x-auto rounded-sm bg-surface-muted p-2 text-xs" dir="ltr">{JSON.stringify(last?.specs ?? null, null, 1)}</pre>
                    </details>
                  </td>
                  <td className="px-3 py-2">{top ? `${top.sku} · ${top.pct}%` : "–"}</td>
                  <td className="px-3 py-2">{r.feedback === 1 ? "👍" : r.feedback === -1 ? "👎" : "–"}</td>
                  <td className="px-3 py-2" dir="ltr">{last?.latency_ms ?? "–"} ms</td>
                  <td className="px-3 py-2" dir="ltr">{last?.cost_usd ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-text-muted">{t("empty")}</p>}
      </div>
    </div>
  );
}
