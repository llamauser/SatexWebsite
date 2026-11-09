"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { localized, type I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { formatCountdown, remaining } from "@/lib/reservations/rules";
import { tableCls, tdCls, thCls } from "./ui";

interface Row {
  id: string; meters: number | string; expires_at: string; client_id: string; reminded_at: string | null;
  clients: { company_name: string } | null; fabric_colors: { code: string; name: I18nField; fabrics: { sku: string; name: I18nField } } | null;
}

/** Active reservations: who holds how many meters until when, and a button to release them. */
export function ReservationsAdmin() {
  const t = useTranslations("admin.reservations");
  const locale = useLocale();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setFailed(true);
    const { data, error } = await sb.from("stock_reservations").select("id, meters, expires_at, client_id, reminded_at, clients(company_name), fabric_colors(code, name, fabrics(sku, name))").eq("status", "active").order("expires_at").limit(500);
    if (error) return setFailed(true);
    setRows(data as unknown as Row[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);

  async function release(id: string) {
    setBusy(id);
    const sb = (await loadBrowserSupabase())!;
    await sb.rpc("cancel_reservation", { p_id: id });
    setBusy(null);
    await load();
  }

  return (
    <div className="space-y-6" data-testid="reservations-admin">
      <div><h1 className="font-display text-3xl font-bold">{t("title")}</h1><p className="mt-1 text-sm text-text-muted">{t("lead")}</p></div>
      {failed && <Alert>{t("error")}</Alert>}
      {rows === null && !failed && <p className="text-text-muted">{t("loading")}</p>}
      {rows && (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className={tableCls} data-testid="reservation-table">
            <thead className="bg-surface-muted text-text-muted"><tr>{(["client", "fabric", "meters", "left", ""] as const).map((k, i) => <th key={i} scope="col" className={thCls}>{k ? t(`cols.${k}`) : <span className="sr-only">{t("release")}</span>}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const left = remaining(r.expires_at, now);
                return (
                  <tr key={r.id} data-testid="reservation-row" data-id={r.id}>
                    <td className={tdCls}><Link href={`/admin/clients/${r.client_id}`} className="hover:text-primary">{r.clients?.company_name ?? "–"}</Link></td>
                    <td className={tdCls}>{r.fabric_colors && <><span className="font-medium" dir="ltr">{r.fabric_colors.fabrics.sku}</span> · {localized(r.fabric_colors.fabrics.name, locale)}<span className="block text-xs text-text-muted">{localized(r.fabric_colors.name, locale)} ({r.fabric_colors.code})</span></>}</td>
                    <td className={tdCls} dir="ltr">{Number(r.meters)}</td>
                    <td className={tdCls} dir="ltr" data-testid="reservation-left" data-soon={left.soon}>{left.expired ? t("expired") : formatCountdown(left)}</td>
                    <td className={tdCls}><Button type="button" variant="secondary" loading={busy === r.id} onClick={() => void release(r.id)} data-testid="release-reservation">{t("release")}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="p-6 text-center text-text-muted" data-testid="reservations-empty">{t("empty")}</p>}
        </div>
      )}
    </div>
  );
}
