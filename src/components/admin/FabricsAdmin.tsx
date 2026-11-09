"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { localized, type I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { tableCls, tdCls, thCls } from "./ui";
import { useStaffRole } from "./useRole";

interface Row {
  id: string; slug: string; sku: string; name: I18nField; gsm: number; base_price_per_m: number | string;
  is_active: boolean; is_featured: boolean; is_demo: boolean; categories: { name: I18nField } | null;
}

/** The fabric list: search, filter, switch a fabric on or off. Admins also create, edit and import. */
export function FabricsAdmin() {
  const t = useTranslations("admin.fabrics");
  const locale = useLocale();
  const role = useStaffRole();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<"all" | "active" | "inactive">("all");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setFailed(true);
    const { data, error } = await sb.from("fabrics").select("id, slug, sku, name, gsm, base_price_per_m, is_active, is_featured, is_demo, categories(name)").order("created_at", { ascending: false }).limit(1000);
    if (error) return setFailed(true);
    setRows(data as unknown as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function toggle(row: Row) {
    setBusy(row.id);
    const sb = await loadBrowserSupabase();
    await sb?.from("fabrics").update({ is_active: !row.is_active }).eq("id", row.id);
    await load();
    setBusy(null);
  }

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) =>
    (state === "all" || (state === "active") === r.is_active) &&
    (q === "" || r.sku.toLowerCase().includes(q) || r.slug.includes(q) || Object.values(r.name ?? {}).some((n) => n.toLowerCase().includes(q))));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        {role === "admin" && (
          <div className="flex gap-3">
            <Link href="/admin/fabrics/import" className={buttonStyles({ variant: "secondary" })} data-testid="import-fabrics">{t("import")}</Link>
            <Link href="/admin/fabrics/new" className={buttonStyles()} style={{ background: "var(--primary-gradient)" }} data-testid="new-fabric">{t("new")}</Link>
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")}
          className="h-11 w-full max-w-sm rounded-full border border-border bg-surface px-4" data-testid="fabric-search"
        />
        <select value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label={t("state")} className="h-11 rounded-full border border-border bg-surface px-3" data-testid="fabric-state">
          <option value="all">{t("all")}</option>
          <option value="active">{t("active")}</option>
          <option value="inactive">{t("inactive")}</option>
        </select>
        {rows && <span className="text-sm text-text-muted" data-testid="fabric-count">{t("count", { n: shown.length })}</span>}
      </div>

      {failed && <div className="mt-6"><Alert>{t("error")}</Alert></div>}
      {rows === null && !failed && <p className="mt-6 text-text-muted">{t("loading")}</p>}
      {rows && (
        <div className="mt-4 overflow-x-auto rounded-md border border-border bg-surface">
          <table className={tableCls} data-testid="fabric-table">
            <thead className="bg-surface-muted text-text-muted">
              <tr>{(["sku", "name", "category", "gsm", "price", "status"] as const).map((k) => <th key={k} scope="col" className={thCls}>{t(`cols.${k}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} data-testid="fabric-row" data-sku={r.sku}>
                  <td className={tdCls} dir="ltr">{r.sku}</td>
                  <td className={tdCls}>
                    {role === "admin" ? <Link href={`/admin/fabrics/${r.id}`} className="font-medium hover:text-primary" data-testid="fabric-edit">{localized(r.name, locale)}</Link> : <span className="font-medium">{localized(r.name, locale)}</span>}
                    {r.is_demo && <span className="ms-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-muted">{t("demo")}</span>}
                    {r.is_featured && <span className="ms-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{t("featured")}</span>}
                  </td>
                  <td className={tdCls}>{r.categories ? localized(r.categories.name, locale) : "–"}</td>
                  <td className={tdCls} dir="ltr">{r.gsm}</td>
                  <td className={tdCls} dir="ltr">{Number(r.base_price_per_m).toFixed(2)}</td>
                  <td className={tdCls}>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={r.is_active} disabled={role !== "admin" || busy === r.id} onChange={() => void toggle(r)} className="size-4 accent-[var(--primary)]" aria-label={t("toggle", { sku: r.sku })} data-testid="fabric-active" />
                      <span className="text-xs text-text-muted">{r.is_active ? t("active") : t("inactive")}</span>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-6 text-center text-text-muted" data-testid="fabrics-empty">{t("empty")}</p>}
        </div>
      )}
    </div>
  );
}
