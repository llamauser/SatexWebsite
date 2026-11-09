"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { StatusPill } from "@/components/quotes/StatusPill";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { Badge, ORDER_TONE } from "./Badge";
import { Section, TextArea, tableCls, tdCls, thCls } from "./ui";

interface ClientRow {
  id: string; company_name: string; country: string | null; created_at: string; is_demo: boolean;
  quotes: { count: number }[]; orders: { count: number }[]; sample_requests: { count: number }[]; profiles: { full_name: string | null; phone: string | null }[];
}

export function ClientsAdmin() {
  const t = useTranslations("admin.clients");
  const locale = useLocale();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setFailed(true);
      const { data, error } = await sb.from("clients").select("id, company_name, country, created_at, is_demo, quotes(count), orders(count), sample_requests(count), profiles!client_id(full_name, phone)").order("created_at", { ascending: false }).limit(1000);
      if (error) return setFailed(true);
      setRows(data as unknown as ClientRow[]);
    })();
  }, []);

  const q = query.trim().toLowerCase();
  const shown = (rows ?? []).filter((r) => q === "" || r.company_name.toLowerCase().includes(q) || r.profiles.some((p) => (p.full_name ?? "").toLowerCase().includes(q)));
  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso));
  const count = (c: { count: number }[]) => c[0]?.count ?? 0;

  return (
    <div className="space-y-6" data-testid="clients-admin">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} className="h-11 w-full max-w-sm rounded-full border border-border bg-surface px-4" data-testid="client-search" />
      {failed && <Alert>{t("error")}</Alert>}
      {rows === null && !failed && <p className="text-text-muted">{t("loading")}</p>}
      {rows && (
        <div className="overflow-x-auto rounded-md border border-border bg-surface">
          <table className={tableCls} data-testid="client-table">
            <thead className="bg-surface-muted text-text-muted"><tr>{(["company", "contact", "country", "quotes", "orders", "samples", "since"] as const).map((k) => <th key={k} scope="col" className={thCls}>{t(`cols.${k}`)}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} data-testid="client-row" data-company={r.company_name}>
                  <td className={tdCls}><Link href={`/admin/clients/${r.id}`} className="font-semibold hover:text-primary" data-testid="client-open">{r.company_name}</Link>{r.is_demo && <span className="ms-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text-muted">{t("demo")}</span>}</td>
                  <td className={tdCls}>{r.profiles[0]?.full_name ?? "–"}</td>
                  <td className={tdCls}>{r.country ?? "–"}</td>
                  <td className={tdCls} dir="ltr">{count(r.quotes)}</td><td className={tdCls} dir="ltr">{count(r.orders)}</td><td className={tdCls} dir="ltr">{count(r.sample_requests)}</td>
                  <td className={tdCls} dir="ltr">{date(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="p-6 text-center text-text-muted">{t("empty")}</p>}
        </div>
      )}
    </div>
  );
}

interface Detail {
  id: string; company_name: string; tax_id: string | null; website: string | null; country: string | null; notes_internal: string | null; created_at: string;
  profiles: { full_name: string | null; phone: string | null; preferred_locale: string }[];
  addresses: { kind: string; line1: string; line2: string | null; city: string; postal_code: string | null; country: string }[];
  quotes: { id: string; ref: string; status: string; total: number | string; currency: string; created_at: string; submitted_at: string | null }[];
  orders: { id: string; ref: string; status: string; total: number | string; currency: string; created_at: string }[];
  sample_requests: { id: string; ref: string; status: string; created_at: string }[];
}

/** One client: contacts, addresses, the history of quotes, orders and samples, and the team's private notes. */
export function ClientDetail({ id }: { id: string }) {
  const t = useTranslations("admin.client");
  const to = useTranslations("orders.status");
  const ts = useTranslations("samples.status");
  const locale = useLocale();
  const [client, setClient] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return setMissing(true);
    const { data } = await sb.from("clients").select("id, company_name, tax_id, website, country, notes_internal, created_at, profiles!client_id(full_name, phone, preferred_locale), addresses(kind, line1, line2, city, postal_code, country), quotes(id, ref, status, total, currency, created_at, submitted_at), orders(id, ref, status, total, currency, created_at), sample_requests(id, ref, status, created_at)").eq("id", id).maybeSingle();
    if (!data) return setMissing(true);
    const d = data as unknown as Detail;
    setClient(d);
    setNotes(d.notes_internal ?? "");
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function saveNotes() {
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.from("clients").update({ notes_internal: notes.trim() || null }).eq("id", id);
    setSaved(!error);
  }

  if (missing) return <Alert>{t("notFound")}</Alert>;
  if (!client) return <p className="text-text-muted">{t("loading")}</p>;
  const date = (iso: string) => new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: "medium" }).format(new Date(iso));
  const quotes = client.quotes.filter((q) => q.status !== "draft").sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-6" data-testid="client-detail">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold" data-testid="client-name">{client.company_name}</h1>
        <Link href="/admin/clients" className={buttonStyles({ variant: "ghost" })}>{t("back")}</Link>
      </div>

      <Section title={t("company")}>
        <dl className="grid gap-4 text-sm sm:grid-cols-4">
          {([["taxId", client.tax_id], ["website", client.website], ["country", client.country], ["since", date(client.created_at)]] as const).map(([k, v]) => <div key={k}><dt className="text-text-muted">{t(`fields.${k}`)}</dt><dd className="font-medium">{v || "–"}</dd></div>)}
        </dl>
        <ul className="space-y-1 text-sm">{client.profiles.map((p, i) => <li key={i}>{p.full_name || "–"}{p.phone ? ` · ${p.phone}` : ""} · {p.preferred_locale.toUpperCase()}</li>)}</ul>
        <ul className="space-y-1 text-sm text-text-muted">{client.addresses.map((a, i) => <li key={i}>{t(`address.${a.kind === "billing" ? "billing" : "shipping"}`)} : {[a.line1, a.line2, a.postal_code, a.city, a.country].filter(Boolean).join(", ")}</li>)}</ul>
      </Section>

      <Section title={t("quotes")} testId="client-quotes">
        {quotes.length === 0 ? <p className="text-sm text-text-muted">{t("none")}</p> : (
          <ul className="divide-y divide-border">{quotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="client-quote">
              <Link href={`/admin/quotes/${q.id}`} className="font-medium hover:text-primary" dir="ltr">{q.ref}</Link>
              <span className="flex items-center gap-3"><StatusPill status={q.status} /><span dir="ltr">{formatMoney(Number(q.total), q.currency, locale)}</span><span className="text-xs text-text-muted" dir="ltr">{date(q.submitted_at ?? q.created_at)}</span></span>
            </li>))}</ul>
        )}
      </Section>

      <Section title={t("orders")} testId="client-orders">
        {client.orders.length === 0 ? <p className="text-sm text-text-muted">{t("none")}</p> : (
          <ul className="divide-y divide-border">{client.orders.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2" data-testid="client-order">
              <Link href={`/admin/orders/${o.id}`} className="font-medium hover:text-primary" dir="ltr">{o.ref}</Link>
              <span className="flex items-center gap-3"><Badge label={loose(to)(o.status)} tone={ORDER_TONE[o.status]} /><span dir="ltr">{formatMoney(Number(o.total), o.currency, locale)}</span><span className="text-xs text-text-muted" dir="ltr">{date(o.created_at)}</span></span>
            </li>))}</ul>
        )}
      </Section>

      <Section title={t("samples")} testId="client-samples">
        {client.sample_requests.length === 0 ? <p className="text-sm text-text-muted">{t("none")}</p> : (
          <ul className="divide-y divide-border">{client.sample_requests.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2"><span className="font-medium" dir="ltr">{s.ref}</span><span className="flex items-center gap-3"><Badge label={loose(ts)(s.status)} /><span className="text-xs text-text-muted" dir="ltr">{date(s.created_at)}</span></span></li>))}</ul>
        )}
      </Section>

      <Section title={t("notes")} hint={t("notesHint")}>
        <TextArea label={t("notesLabel")} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(null); }} data-testid="client-notes" />
        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => void saveNotes()} data-testid="client-notes-save">{t("saveNotes")}</Button>
          {saved === true && <span role="status" className="text-sm text-success" data-testid="client-notes-saved">{t("notesSaved")}</span>}
          {saved === false && <span role="alert" className="text-sm text-danger">{t("notesError")}</span>}
        </div>
      </Section>
    </div>
  );
}
