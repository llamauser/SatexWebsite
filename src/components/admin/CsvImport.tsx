"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { checkCsv, TEMPLATE_CSV, type CsvPlan, type ImportRow } from "@/lib/admin/csv";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { Section, tableCls, tdCls, thCls } from "./ui";
import { useStaffRole } from "./useRole";

interface Outcome { created: number; updated: number; failed: { sku: string; reason: string }[] }

/** CSV import of fabrics: pick a file, read the report (nothing is saved yet), then apply the valid rows. */
export function CsvImport() {
  const t = useTranslations("admin.import");
  const role = useStaffRole();
  const [categories, setCategories] = useState<Map<string, string>>(new Map());
  const [existing, setExisting] = useState<Map<string, string>>(new Map()); // lower-case sku -> id
  const [text, setText] = useState<string | null>(null);
  const [plan, setPlan] = useState<CsvPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return;
      const [c, f] = await Promise.all([sb.from("categories").select("id, slug"), sb.from("fabrics").select("id, sku")]);
      setCategories(new Map(((c.data ?? []) as { id: string; slug: string }[]).map((x) => [x.slug, x.id])));
      setExisting(new Map(((f.data ?? []) as { id: string; sku: string }[]).map((x) => [x.sku.toLowerCase(), x.id])));
    })();
  }, []);

  // the report is recomputed when the lists arrive after the file was chosen
  useEffect(() => {
    if (text !== null) setPlan(checkCsv(text, { categories, existingSkus: new Set(existing.keys()) }));
  }, [text, categories, existing]);

  async function onFile(file: File) {
    setOutcome(null);
    setText(await file.text());
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setOutcome(null);
    const sb = (await loadBrowserSupabase())!;
    const result: Outcome = { created: 0, updated: 0, failed: [] };
    for (const row of plan.rows) {
      const fail = (reason: string) => result.failed.push({ sku: row.sku, reason });
      const id = await saveRow(sb, row, existing.get(row.sku.toLowerCase()));
      if (typeof id !== "string") { fail(id.error); continue; }
      if (row.action === "create") result.created++; else result.updated++;
    }
    setOutcome(result);
    setBusy(false);
    // refresh the SKU list so a second import of the same file updates instead of creating
    const f = await sb.from("fabrics").select("id, sku");
    setExisting(new Map(((f.data ?? []) as { id: string; sku: string }[]).map((x) => [x.sku.toLowerCase(), x.id])));
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "fabrics-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (role !== "loading" && role !== "admin") return <Alert>{t("adminOnly")}</Alert>;

  return (
    <div className="space-y-6" data-testid="csv-import">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <Link href="/admin/fabrics" className={buttonStyles({ variant: "ghost" })}>{t("back")}</Link>
      </div>

      <Section title={t("step1")} hint={t("columns")}>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={download} data-testid="download-template">{t("template")}</Button>
          <a href="/samples/fabrics-sample.csv" download className={buttonStyles({ variant: "ghost" })} data-testid="download-sample">{t("sample")}</a>
        </div>
        <label className="block text-sm font-medium">
          {t("choose")}
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} className="mt-2 block w-full text-sm" data-testid="csv-file" />
        </label>
        <p className="text-xs text-text-muted">{t("photosNote")}</p>
      </Section>

      {plan && (
        <Section title={t("step2")} testId="csv-report">
          <p className="text-sm" data-testid="csv-summary">{t("summary", { total: plan.total, ok: plan.rows.length, bad: new Set(plan.errors.map((e) => e.line)).size })}</p>
          {plan.errors.length > 0 && (
            <ul className="space-y-1 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger" data-testid="csv-errors">
              {plan.errors.map((e, i) => (
                <li key={i} data-testid="csv-error">{t("errorLine", { line: e.line, field: e.field, problem: loose(t)(`issue.${e.issue}`), value: e.value ?? "" })}</li>
              ))}
            </ul>
          )}
          {plan.rows.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className={tableCls} data-testid="csv-rows">
                <thead className="bg-surface-muted text-text-muted"><tr>{(["line", "sku", "name", "action", "colors"] as const).map((k) => <th key={k} className={thCls}>{t(`cols.${k}`)}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {plan.rows.map((r) => (
                    <tr key={r.sku} data-testid="csv-row">
                      <td className={tdCls}>{r.line}</td><td className={tdCls} dir="ltr">{r.sku}</td><td className={tdCls}>{r.name.fr}</td>
                      <td className={tdCls}>{t(r.action === "create" ? "willCreate" : "willUpdate")}</td><td className={tdCls}>{r.colors.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div>
            <Button type="button" loading={busy} disabled={plan.rows.length === 0} onClick={() => void apply()} data-testid="csv-apply">{t("apply", { n: plan.rows.length })}</Button>
          </div>
        </Section>
      )}

      {outcome && (
        <Section title={t("step3")} testId="csv-outcome">
          <Alert kind={outcome.failed.length === 0 ? "success" : "info"}>{t("done", { created: outcome.created, updated: outcome.updated, failed: outcome.failed.length })}</Alert>
          {outcome.failed.map((f) => <p key={f.sku} className="text-sm text-danger">{f.sku} : {f.reason}</p>)}
        </Section>
      )}
    </div>
  );
}

/** Creates or updates one fabric with its colors and price tiers. Returns the fabric id, or the reason it failed. */
async function saveRow(sb: NonNullable<Awaited<ReturnType<typeof loadBrowserSupabase>>>, row: ImportRow, existingId: string | undefined): Promise<string | { error: string }> {
  const base = { ...row.fabric, name: row.name, category_id: row.categoryId };
  let id = existingId;
  if (id) {
    const { error } = await sb.from("fabrics").update(base).eq("id", id);
    if (error) return { error: error.message };
  } else {
    const { data, error } = await sb.from("fabrics").insert({ ...base, sku: row.sku, slug: row.slug }).select("id").single();
    if (error) return { error: error.message };
    id = data.id as string;
  }
  if (row.colors.length > 0) {
    // colors that already exist are kept as they are; new codes are added
    const { error } = await sb.from("fabric_colors").upsert(
      row.colors.map((c, i) => ({ fabric_id: id, code: c.code, name: { fr: c.name }, hex: c.hex, sort: i })),
      { onConflict: "fabric_id,code", ignoreDuplicates: true },
    );
    if (error) return { error: error.message };
  }
  if (row.tiers.length > 0) {
    await sb.from("fabric_price_tiers").delete().eq("fabric_id", id);
    const { error } = await sb.from("fabric_price_tiers").insert(row.tiers.map((x) => ({ ...x, fabric_id: id })));
    if (error) return { error: error.message };
  }
  return id;
}
