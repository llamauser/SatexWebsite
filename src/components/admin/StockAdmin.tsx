"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import { localized, type I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { loose } from "@/lib/i18n-loose";
import { Section, tableCls, tdCls, thCls } from "./ui";

interface Lot {
  id: string; lot_code: string; meters: number | string; location: string | null; received_at: string | null; department_id: string | null; color_id: string;
  fabric_colors: { code: string; name: I18nField; hex: string; fabrics: { sku: string; name: I18nField } };
  departments: { name: I18nField } | null;
}
interface ColorOption { id: string; code: string; name: I18nField; fabrics: { sku: string; name: I18nField } }
interface Dept { id: string; name: I18nField }
interface Movement { id: string; type: string; meters: number | string; reason: string | null; created_at: string }
type Msg = { kind: "success" | "error"; text: string } | null;

const nextCode = () => `L-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
const parse = (v: string) => Number(v.trim().replace(",", "."));

/** Stock lots: receive a lot, adjust meters (always with a reason), move a lot to another department, read its history. */
export function StockAdmin() {
  const t = useTranslations("admin.stock");
  const locale = useLocale();
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [colors, setColors] = useState<ColorOption[]>([]);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recv, setRecv] = useState({ colorId: "", code: nextCode(), meters: "", deptId: "", location: "" });
  const [adj, setAdj] = useState<Record<string, { delta: string; reason: string }>>({});
  const [history, setHistory] = useState<Record<string, Movement[] | undefined>>({});

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return;
    const [l, c, d] = await Promise.all([
      sb.from("stock_lots").select("id, lot_code, meters, location, received_at, department_id, color_id, fabric_colors(code, name, hex, fabrics(sku, name)), departments(name)").order("created_at", { ascending: false }).limit(500),
      sb.from("fabric_colors").select("id, code, name, fabrics(sku, name)").order("code").limit(2000),
      sb.from("departments").select("id, name").order("sort"),
    ]);
    setLots((l.data ?? []) as unknown as Lot[]);
    setColors((c.data ?? []) as unknown as ColorOption[]);
    setDepts((d.data ?? []) as unknown as Dept[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const fail = (text: string) => setMsg({ kind: "error", text });
  const errorText = (message: string) => (/reason is required/.test(message) ? t("reasonRequired") : /meters_check|violates check/.test(message) ? t("tooMuch") : /lot_code/.test(message) ? t("codeTaken") : t("error"));

  async function receive() {
    setMsg(null);
    const meters = parse(recv.meters);
    if (!recv.colorId || !recv.code.trim() || !(meters > 0)) return fail(t("receiveInvalid"));
    setBusy("receive");
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.rpc("receive_lot", { p_color_id: recv.colorId, p_lot_code: recv.code.trim(), p_meters: meters, p_department_id: recv.deptId || null, p_location: recv.location.trim() || null });
    setBusy(null);
    if (error) return fail(errorText(error.message));
    setMsg({ kind: "success", text: t("received", { code: recv.code.trim() }) });
    setRecv({ colorId: recv.colorId, code: nextCode(), meters: "", deptId: recv.deptId, location: "" });
    await load();
  }

  async function adjust(lot: Lot) {
    setMsg(null);
    const a = adj[lot.id] ?? { delta: "", reason: "" };
    const delta = parse(a.delta);
    if (!Number.isFinite(delta) || delta === 0) return fail(t("deltaInvalid"));
    if (!a.reason.trim()) return fail(t("reasonRequired"));
    setBusy(lot.id);
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.rpc("adjust_stock", { p_lot_id: lot.id, p_delta: delta, p_reason: a.reason.trim() });
    setBusy(null);
    if (error) return fail(errorText(error.message));
    setAdj((m) => ({ ...m, [lot.id]: { delta: "", reason: "" } }));
    setMsg({ kind: "success", text: t("adjusted", { code: lot.lot_code }) });
    setHistory((h) => ({ ...h, [lot.id]: undefined }));
    await load();
  }

  async function move(lot: Lot, deptId: string) {
    setMsg(null);
    setBusy(lot.id);
    const sb = (await loadBrowserSupabase())!;
    const { data: auth } = await sb.auth.getUser();
    const to = depts.find((d) => d.id === deptId);
    const { error } = await sb.from("stock_lots").update({ department_id: deptId || null }).eq("id", lot.id);
    if (!error) await sb.from("stock_movements").insert({ lot_id: lot.id, type: "transfer", meters: 0, reason: `moved to ${to ? localized(to.name, "fr") : "none"}`, actor_id: auth.user?.id });
    setBusy(null);
    if (error) return fail(t("error"));
    setMsg({ kind: "success", text: t("moved", { code: lot.lot_code }) });
    setHistory((h) => ({ ...h, [lot.id]: undefined }));
    await load();
  }

  async function showHistory(lot: Lot) {
    if (history[lot.id]) return setHistory((h) => ({ ...h, [lot.id]: undefined }));
    const sb = (await loadBrowserSupabase())!;
    const { data } = await sb.from("stock_movements").select("id, type, meters, reason, created_at").eq("lot_id", lot.id).order("created_at", { ascending: false }).limit(30);
    setHistory((h) => ({ ...h, [lot.id]: (data ?? []) as Movement[] }));
  }

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (lots ?? []).filter((l) => q === "" || l.lot_code.toLowerCase().includes(q) || l.fabric_colors.fabrics.sku.toLowerCase().includes(q) || l.fabric_colors.code.toLowerCase().includes(q) || Object.values(l.fabric_colors.fabrics.name ?? {}).some((n) => n.toLowerCase().includes(q))), [lots, q]);
  const total = shown.reduce((s, l) => s + Number(l.meters), 0);
  const dateTime = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <Section title={t("receiveTitle")} testId="receive-lot">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select label={t("color")} value={recv.colorId} onChange={(e) => setRecv({ ...recv, colorId: e.target.value })} data-testid="recv-color">
            <option value="">{t("choose")}</option>
            {colors.map((c) => <option key={c.id} value={c.id}>{c.fabrics.sku} · {localized(c.fabrics.name, locale)} · {localized(c.name, locale)} ({c.code})</option>)}
          </Select>
          <Input label={t("lotCode")} value={recv.code} dir="ltr" onChange={(e) => setRecv({ ...recv, code: e.target.value })} data-testid="recv-code" />
          <Input label={t("meters")} inputMode="decimal" value={recv.meters} dir="ltr" onChange={(e) => setRecv({ ...recv, meters: e.target.value })} data-testid="recv-meters" />
          <Select label={t("department")} value={recv.deptId} onChange={(e) => setRecv({ ...recv, deptId: e.target.value })}>
            <option value="">–</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{localized(d.name, locale)}</option>)}
          </Select>
          <Input label={t("location")} value={recv.location} onChange={(e) => setRecv({ ...recv, location: e.target.value })} />
        </div>
        <Button type="button" loading={busy === "receive"} onClick={() => void receive()} data-testid="recv-submit">{t("receive")}</Button>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 w-full max-w-sm rounded-full border border-border bg-surface px-4" data-testid="lot-search" />
        {lots && <span className="text-sm text-text-muted" data-testid="lot-total">{t("totals", { lots: shown.length, meters: Math.round(total * 100) / 100 })}</span>}
      </div>

      <div className="overflow-x-auto rounded-md border border-border bg-surface">
        <table className={tableCls} data-testid="lot-table">
          <thead className="bg-surface-muted text-text-muted"><tr>{(["lot", "fabric", "meters", "department", "adjust"] as const).map((k) => <th key={k} scope="col" className={thCls}>{t(`cols.${k}`)}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {shown.map((l) => {
              const a = adj[l.id] ?? { delta: "", reason: "" };
              const h = history[l.id];
              return (
                <tr key={l.id} data-testid="lot-row" data-lot={l.lot_code}>
                  <td className={tdCls}><span dir="ltr" className="font-medium">{l.lot_code}</span><span className="block text-xs text-text-muted">{l.received_at ?? ""}</span></td>
                  <td className={tdCls}>
                    <span className="flex items-center gap-2"><span className="size-4 rounded-full border border-border" style={{ background: l.fabric_colors.hex }} aria-hidden />{l.fabric_colors.fabrics.sku} · {localized(l.fabric_colors.name, locale)} ({l.fabric_colors.code})</span>
                    <span className="block text-xs text-text-muted">{localized(l.fabric_colors.fabrics.name, locale)}</span>
                  </td>
                  <td className={tdCls} dir="ltr" data-testid="lot-meters">{Number(l.meters)}</td>
                  <td className={tdCls}>
                    <select value={l.department_id ?? ""} onChange={(e) => void move(l, e.target.value)} disabled={busy === l.id} aria-label={t("department")} className="h-9 rounded-sm border border-border bg-surface px-2" data-testid="lot-dept">
                      <option value="">–</option>
                      {depts.map((d) => <option key={d.id} value={d.id}>{localized(d.name, locale)}</option>)}
                    </select>
                    {l.location && <span className="block text-xs text-text-muted">{l.location}</span>}
                  </td>
                  <td className={tdCls}>
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={a.delta} inputMode="decimal" dir="ltr" placeholder="+10 / -2.5" aria-label={t("delta")} onChange={(e) => setAdj((m) => ({ ...m, [l.id]: { ...a, delta: e.target.value } }))} className="h-9 w-24 rounded-sm border border-border bg-surface px-2" data-testid="adj-delta" />
                      <input value={a.reason} placeholder={t("reason")} aria-label={t("reason")} onChange={(e) => setAdj((m) => ({ ...m, [l.id]: { ...a, reason: e.target.value } }))} className="h-9 w-40 rounded-sm border border-border bg-surface px-2" data-testid="adj-reason" />
                      <Button type="button" variant="secondary" loading={busy === l.id} onClick={() => void adjust(l)} data-testid="adj-submit">{t("apply")}</Button>
                      <button type="button" onClick={() => void showHistory(l)} className="text-xs underline" data-testid="lot-history">{t("history")}</button>
                    </div>
                    {h && (
                      <ul className="mt-2 space-y-1 text-xs text-text-muted" data-testid="lot-movements">
                        {h.map((m) => <li key={m.id}><span dir="ltr">{dateTime(m.created_at)}</span> · {loose(t)(`movement.${m.type}`)} · <span dir="ltr">{Number(m.meters) > 0 ? "+" : ""}{Number(m.meters)}</span> m{m.reason ? ` · ${m.reason}` : ""}</li>)}
                      </ul>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {lots === null && <p className="p-6 text-center text-text-muted">{t("loading")}</p>}
        {lots && shown.length === 0 && <p className="p-6 text-center text-text-muted" data-testid="lots-empty">{t("empty")}</p>}
      </div>
    </div>
  );
}
