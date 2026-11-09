"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import { coerceSetting, CURRENCIES, defOf, displayValue, GROUPS, SETTINGS, type SettingDef } from "@/lib/admin/settings";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { Check, Section } from "./ui";
import { useStaffRole } from "./useRole";

type Values = Record<string, unknown>;
type Msg = { kind: "success" | "error" | "info"; text: string } | null;
const LANGS = ["fr", "en", "ar"] as const;

/** Business settings (company, commerce, limits, notifications) and the "Purge demo data" action. */
export function SettingsAdmin() {
  const t = useTranslations("admin.settings");
  const role = useStaffRole();
  const [stored, setStored] = useState<Values | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [purging, setPurging] = useState(false);
  const [purged, setPurged] = useState<Record<string, number> | null>(null);
  const [monitoring, setMonitoring] = useState<"idle" | "busy" | "off" | "sent" | "error">("idle");

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return;
    const { data } = await sb.from("app_settings").select("key, value");
    const values: Values = Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
    setStored(values);
    setForm(Object.fromEntries(SETTINGS.map((d) => [d.key, d.type === "i18n" ? { fr: "", en: "", ar: "", ...((values[d.key] as object) ?? {}) } : d.type === "bool" ? values[d.key] === true : displayValue(d, values[d.key])])));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function saveGroup(group: (typeof GROUPS)[number]) {
    setMsg(null);
    const defs = SETTINGS.filter((d) => d.group === group);
    const found: Record<string, string> = {};
    const updates: { key: string; value: unknown }[] = [];
    for (const d of defs) {
      const r = coerceSetting(d, form[d.key]);
      if (!r.ok) found[d.key] = r.issue;
      else if (JSON.stringify(r.value) !== JSON.stringify(stored?.[d.key])) updates.push({ key: d.key, value: r.value });
    }
    setErrors((e) => ({ ...Object.fromEntries(Object.entries(e).filter(([k]) => !defs.some((d) => d.key === k))), ...found }));
    if (Object.keys(found).length > 0) return setMsg({ kind: "error", text: t("fixErrors") });
    if (updates.length === 0) return setMsg({ kind: "info", text: t("nothingToSave") });
    setSaving(group);
    const sb = (await loadBrowserSupabase())!;
    const results = await Promise.all(updates.map((u) => sb.from("app_settings").update({ value: u.value }).eq("key", u.key)));
    setSaving(null);
    if (results.some((r) => r.error)) return setMsg({ kind: "error", text: t("saveError") });
    setMsg({ kind: "success", text: t("saved", { n: updates.length }) });
    await load();
  }

  async function testMonitoring() {
    setMonitoring("busy");
    try {
      const res = await fetch("/api/admin/sentry-test", { method: "POST" });
      const body = (await res.json()) as { sent?: boolean };
      setMonitoring(!res.ok ? "error" : body.sent ? "sent" : "off");
    } catch {
      setMonitoring("error");
    }
  }

  async function purge() {
    setPurging(true);
    setMsg(null);
    const sb = (await loadBrowserSupabase())!;
    const { data, error } = await sb.rpc("purge_demo_data");
    setPurging(false);
    setConfirm("");
    if (error) return setMsg({ kind: "error", text: t("purgeError") });
    setPurged(data as Record<string, number>);
  }

  if (role !== "loading" && role !== "admin") return <Alert>{t("adminOnly")}</Alert>;
  if (stored === null) return <p className="text-text-muted">{t("loading")}</p>;

  const field = (d: SettingDef) => {
    const err = errors[d.key] ? loose(t)(`issue.${errors[d.key]}`) : undefined;
    const label = loose(t)(`keys.${d.key}`);
    const testId = `setting-${d.key}`;
    if (d.type === "bool") return <Check key={d.key} label={label} checked={form[d.key] === true} onChange={(e) => setForm({ ...form, [d.key]: e.target.checked })} data-testid={testId} />;
    if (d.type === "i18n") {
      const value = form[d.key] as Record<string, string>;
      return (
        <div key={d.key} className="grid gap-3 sm:grid-cols-3 sm:col-span-2">
          {LANGS.map((l) => <Input key={l} label={`${label} (${l.toUpperCase()})`} dir={l === "ar" ? "rtl" : "ltr"} value={value[l] ?? ""} onChange={(e) => setForm({ ...form, [d.key]: { ...value, [l]: e.target.value } })} error={l === "fr" ? err : undefined} data-testid={`${testId}-${l}`} />)}
        </div>
      );
    }
    if (d.type === "locale") return <Select key={d.key} label={label} value={String(form[d.key] ?? "")} onChange={(e) => setForm({ ...form, [d.key]: e.target.value })} error={err} data-testid={testId}>{LANGS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</Select>;
    if (d.type === "currency") return <Select key={d.key} label={label} value={String(form[d.key] ?? "")} onChange={(e) => setForm({ ...form, [d.key]: e.target.value })} error={err} data-testid={testId}>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</Select>;
    return (
      <Input key={d.key} label={`${label}${d.type === "percent" ? " (%)" : ""}`} value={String(form[d.key] ?? "")} dir={d.type === "text" ? undefined : "ltr"}
        inputMode={d.type === "number" || d.type === "percent" ? "decimal" : undefined} onChange={(e) => setForm({ ...form, [d.key]: e.target.value })} error={err} data-testid={testId} />
    );
  };

  return (
    <div className="space-y-6" data-testid="settings-admin">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
      {GROUPS.map((g) => (
        <Section key={g} title={loose(t)(`groups.${g}`)} testId={`group-${g}`}>
          <div className="grid gap-4 sm:grid-cols-2">{SETTINGS.filter((d) => d.group === g && defOf(d.key)).map(field)}</div>
          <Button type="button" loading={saving === g} onClick={() => void saveGroup(g)} data-testid={`save-${g}`}>{t("save")}</Button>
        </Section>
      ))}

      <Section title={t("monitoring.title")} hint={t("monitoring.hint")} testId="monitoring">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" loading={monitoring === "busy"} onClick={() => void testMonitoring()} data-testid="sentry-test">{t("monitoring.test")}</Button>
          {monitoring !== "idle" && monitoring !== "busy" && <span role="status" className={monitoring === "sent" ? "text-sm text-success" : "text-sm text-warning"} data-testid="sentry-result">{t(`monitoring.${monitoring}`)}</span>}
        </div>
      </Section>

      <Section title={t("danger")} hint={t("purgeHint")} testId="purge-demo">
        {purged ? (
          <Alert kind="success"><span data-testid="purge-result">{t("purged", { fabrics: purged.fabrics ?? 0, clients: purged.clients ?? 0, quotes: purged.quotes ?? 0, orders: purged.orders ?? 0, kept: purged.fabrics_kept ?? 0 })}</span></Alert>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Input label={t("purgeConfirm", { word: "PURGE" })} value={confirm} dir="ltr" onChange={(e) => setConfirm(e.target.value)} data-testid="purge-input" />
            <Button type="button" variant="secondary" loading={purging} disabled={confirm !== "PURGE"} onClick={() => void purge()} data-testid="purge-button">{t("purge")}</Button>
          </div>
        )}
      </Section>
    </div>
  );
}
