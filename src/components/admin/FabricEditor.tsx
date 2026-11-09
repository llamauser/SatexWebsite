"use client";

import { Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonStyles } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import { Link, useRouter } from "@/i18n/navigation";
import { CONSTRUCTIONS, FIBERS, SEASONS, STRETCHES, STRUCTURES, USES } from "@/lib/catalog/params";
import { localized, type I18nField } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import {
  afterHumanEdit, compositionTotal, emptyFabric, fromFabricRow, hasErrors, hasFeel, LOCALES, missingTranslations, slugify,
  toFabricRow, toFeelRow, toTierRows, validateFabric, type FabricErrors, type FabricForm, type FabricRowIn, type FormLocale, type MachineTranslated,
} from "@/lib/admin/fabric-form";
import { ColorsEditor } from "./ColorsEditor";
import { Check, PillToggle, Section, TextArea } from "./ui";
import { useStaffRole } from "./useRole";

interface Category { id: string; slug: string; name: I18nField }
type Message = { kind: "success" | "error" | "info"; text: string } | null;

/** Create or edit one fabric (admins). `id` omitted = new fabric. */
export function FabricEditor({ id }: { id?: string }) {
  const t = useTranslations("admin.fabric");
  const tCons = useTranslations("constructions");
  const tStruct = useTranslations("structures");
  const tStretch = useTranslations("stretches");
  const tFiber = useTranslations("fibers");
  const tUse = useTranslations("uses");
  const tSeason = useTranslations("seasons");
  const locale = useLocale();
  const router = useRouter();
  const role = useStaffRole();
  const [form, setForm] = useState<FabricForm>(emptyFabric());
  const [loaded, setLoaded] = useState(!id);
  const [missing, setMissing] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<FabricErrors>({});
  const [tab, setTab] = useState<FormLocale>("fr");
  const [message, setMessage] = useState<Message>(null);
  const [saving, setSaving] = useState(false);
  const [embedded, setEmbedded] = useState<boolean | null>(null);
  const [marks, setMarks] = useState<MachineTranslated>({});
  const [created, setCreated] = useState(false);
  useEffect(() => { setCreated(new URLSearchParams(window.location.search).has("created")); }, []);
  const slugTouched = useRef(!!id);
  const original = useRef<FabricForm>(emptyFabric());

  const loadStatus = useCallback(async () => {
    if (!id) return;
    const sb = await loadBrowserSupabase();
    const { data } = await sb!.from("embeddings").select("id").eq("owner_type", "fabric").eq("owner_id", id).eq("kind", "text").maybeSingle();
    setEmbedded(!!data);
    const f = await sb!.from("fabrics").select("machine_translated").eq("id", id).maybeSingle();
    setMarks((f.data?.machine_translated ?? {}) as MachineTranslated);
  }, [id]);

  useEffect(() => {
    void (async () => {
      const sb = await loadBrowserSupabase();
      if (!sb) return setMissing(true);
      const cats = await sb.from("categories").select("id, slug, name").order("sort");
      setCategories((cats.data ?? []) as unknown as Category[]);
      if (!id) return;
      const [f, tiers, feel] = await Promise.all([
        sb.from("fabrics").select("*").eq("id", id).maybeSingle(),
        sb.from("fabric_price_tiers").select("min_m, price_per_m").eq("fabric_id", id).order("min_m"),
        sb.from("fabric_feel").select("softness, drape, stretch, sheen, breathability").eq("fabric_id", id).maybeSingle(),
      ]);
      if (!f.data) return setMissing(true);
      const next = fromFabricRow(f.data as unknown as FabricRowIn, tiers.data ?? [], feel.data ?? null);
      setForm(next);
      original.current = next;
      setLoaded(true);
      void loadStatus();
    })();
  }, [id, loadStatus]);

  const set = (patch: Partial<FabricForm>) => setForm((f) => ({ ...f, ...patch }));
  const setText = (field: "name" | "shortDescription" | "description", l: FormLocale, value: string) => {
    setForm((f) => {
      const next = { ...f, [field]: { ...f[field], [l]: value } };
      if (field === "name" && l === "fr" && !slugTouched.current) next.slug = slugify(value);
      return next;
    });
  };
  const err = (k: keyof FabricErrors) => (errors[k] ? loose(t)(`err.${errors[k]}`) : undefined);
  const toggleIn = (key: "uses" | "seasons", v: string) => set({ [key]: form[key].includes(v) ? form[key].filter((x) => x !== v) : [...form[key], v] } as Partial<FabricForm>);

  async function save() {
    setMessage(null);
    const found = validateFabric(form);
    setErrors(found);
    if (hasErrors(found)) return setMessage({ kind: "error", text: t("fixErrors") });
    setSaving(true);
    const sb = (await loadBrowserSupabase())!;
    const row = toFabricRow(form);
    let fabricId = id;
    if (id) {
      const { error } = await sb.from("fabrics").update({ ...row, machine_translated: afterHumanEdit(marks, original.current, form) }).eq("id", id);
      if (error) return failSave(error);
    } else {
      const { data, error } = await sb.from("fabrics").insert(row).select("id").single();
      if (error) return failSave(error);
      fabricId = data.id as string;
    }
    // price tiers: replace the whole set
    await sb.from("fabric_price_tiers").delete().eq("fabric_id", fabricId!);
    const tiers = toTierRows(form);
    if (tiers.length > 0) await sb.from("fabric_price_tiers").insert(tiers.map((x) => ({ ...x, fabric_id: fabricId })));
    // feel profile
    if (hasFeel(form)) await sb.from("fabric_feel").upsert({ fabric_id: fabricId, ...toFeelRow(form) });
    else await sb.from("fabric_feel").delete().eq("fabric_id", fabricId!);

    setSaving(false);
    if (!id) return router.replace(`/admin/fabrics/${fabricId}?created=1`);
    original.current = form;
    setMessage({ kind: "success", text: t("saved") });
    void loadStatus();
  }

  function failSave(error: { code?: string; message: string }) {
    setSaving(false);
    if (error.code === "23505" && error.message.includes("sku")) setErrors({ sku: "duplicate" });
    else if (error.code === "23505") setErrors({ slug: "duplicate" });
    setMessage({ kind: "error", text: error.code === "23505" ? t("duplicate") : t("saveError") });
  }

  async function translateMissing() {
    if (!id) return;
    const sb = (await loadBrowserSupabase())!;
    // touching the name makes the database queue the translation and embedding jobs again
    await sb.from("fabrics").update({ name: toFabricRow(form).name }).eq("id", id);
    setMessage({ kind: "info", text: t("translateQueued") });
  }

  if (role !== "loading" && role !== "admin") return <Alert>{t("adminOnly")}</Alert>;
  if (missing) return <Alert>{t("notFound")}</Alert>;
  if (!loaded) return <p className="text-text-muted">{t("loading")}</p>;

  const total = compositionTotal(form.composition);
  const needsTranslation = missingTranslations(form);

  return (
    <div className="space-y-6" data-testid="fabric-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{id ? t("editTitle") : t("newTitle")}</h1>
        <Link href="/admin/fabrics" className={buttonStyles({ variant: "ghost" })}>{t("back")}</Link>
      </div>
      {message && <Alert kind={message.kind}>{message.text}</Alert>}
      {created && !message && <Alert kind="success">{t("created")}</Alert>}

      <Section title={t("identity")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t("sku")} value={form.sku} dir="ltr" onChange={(e) => set({ sku: e.target.value })} error={err("sku")} data-testid="f-sku" />
          <Input label={t("slug")} value={form.slug} dir="ltr" onChange={(e) => { slugTouched.current = true; set({ slug: e.target.value }); }} error={err("slug")} hint={t("slugHint")} data-testid="f-slug" />
          <Select label={t("category")} value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })} error={err("categoryId")} data-testid="f-category">
            <option value="">{t("choose")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{localized(c.name, locale)}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap gap-6">
          <Check label={t("isActive")} checked={form.isActive} onChange={(e) => set({ isActive: e.target.checked })} data-testid="f-active" />
          <Check label={t("isFeatured")} checked={form.isFeatured} onChange={(e) => set({ isFeatured: e.target.checked })} data-testid="f-featured" />
        </div>
      </Section>

      <Section title={t("texts")} hint={t("textsHint")}>
        <div role="tablist" aria-label={t("languages")} className="flex gap-2">
          {LOCALES.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={tab === l} onClick={() => setTab(l)} data-testid={`tab-${l}`}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium ${tab === l ? "border-primary bg-primary/10 text-primary" : "border-border text-text-muted"}`}>
              {l.toUpperCase()}{l !== "fr" && needsTranslation.includes(l) ? " •" : ""}
            </button>
          ))}
        </div>
        <div className="space-y-4" dir={tab === "ar" ? "rtl" : "ltr"} role="tabpanel">
          <Input label={`${t("name")} (${tab.toUpperCase()})${tab === "fr" ? " *" : ""}`} value={form.name[tab]} onChange={(e) => setText("name", tab, e.target.value)} error={tab === "fr" ? err("name") : undefined} data-testid="f-name" />
          <Input label={`${t("shortDescription")} (${tab.toUpperCase()})`} value={form.shortDescription[tab]} onChange={(e) => setText("shortDescription", tab, e.target.value)} data-testid="f-short" />
          <TextArea label={`${t("description")} (${tab.toUpperCase()})`} rows={5} value={form.description[tab]} onChange={(e) => setText("description", tab, e.target.value)} data-testid="f-description" />
          {tab !== "fr" && (["name", "short_description", "description"] as const).some((c) => marks[c]?.includes(tab)) && (
            <p className="text-xs text-warning" data-testid="machine-translated">{t("machineTranslated")}</p>
          )}
        </div>
      </Section>

      <Section title={t("technical")}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label={t("construction")} value={form.construction} onChange={(e) => set({ construction: e.target.value })}>
            {CONSTRUCTIONS.map((v) => <option key={v} value={v}>{loose(tCons)(v)}</option>)}
          </Select>
          <Select label={t("structure")} value={form.structure} onChange={(e) => set({ structure: e.target.value })}>
            {STRUCTURES.map((v) => <option key={v} value={v}>{loose(tStruct)(v)}</option>)}
          </Select>
          <Select label={t("stretch")} value={form.stretch} onChange={(e) => set({ stretch: e.target.value })}>
            {STRETCHES.map((v) => <option key={v} value={v}>{loose(tStretch)(v)}</option>)}
          </Select>
          <Input label={t("gsm")} inputMode="decimal" value={form.gsm} dir="ltr" onChange={(e) => set({ gsm: e.target.value })} error={err("gsm")} data-testid="f-gsm" />
          <Input label={t("widthCm")} inputMode="decimal" value={form.widthCm} dir="ltr" onChange={(e) => set({ widthCm: e.target.value })} error={err("widthCm")} />
          <Input label={t("stretchPct")} inputMode="decimal" value={form.stretchPct} dir="ltr" onChange={(e) => set({ stretchPct: e.target.value })} error={err("stretchPct")} />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">{t("composition")} <span className={`ms-2 text-xs ${total === 100 ? "text-success" : "text-warning"}`} data-testid="composition-total">{t("total", { n: total })}</span></legend>
          <div className="mt-2 space-y-2">
            {form.composition.map((r, i) => (
              <div key={i} className="flex items-center gap-2" data-testid="composition-row">
                <select value={r.fiber} aria-label={t("fiber")} onChange={(e) => set({ composition: form.composition.map((x, j) => (j === i ? { ...x, fiber: e.target.value } : x)) })} className="h-11 rounded-sm border border-border bg-surface px-3" data-testid="fiber">
                  {FIBERS.map((f) => <option key={f} value={f}>{loose(tFiber)(f)}</option>)}
                </select>
                <input value={r.pct} inputMode="decimal" dir="ltr" aria-label={t("pct")} onChange={(e) => set({ composition: form.composition.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)) })} className="h-11 w-24 rounded-sm border border-border bg-surface px-3" data-testid="pct" />
                <span className="text-sm text-text-muted">%</span>
                <button type="button" onClick={() => set({ composition: form.composition.filter((_, j) => j !== i) })} aria-label={t("remove")} className="rounded-full p-2 text-text-muted hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>
              </div>
            ))}
            <Button type="button" variant="ghost" onClick={() => set({ composition: [...form.composition, { fiber: "cotton", pct: "" }] })} data-testid="add-fiber"><Plus className="size-4" aria-hidden />{t("addFiber")}</Button>
          </div>
          {errors.composition && <p role="alert" className="mt-1 text-xs text-danger">{err("composition")}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t("finish")} value={form.finish} onChange={(e) => set({ finish: e.target.value })} hint={t("listHint")} />
          <Input label={t("tags")} value={form.tags} onChange={(e) => set({ tags: e.target.value })} hint={t("listHint")} />
        </div>
        <div>
          <p className="text-sm font-medium">{t("uses")}</p>
          <div className="mt-2 flex flex-wrap gap-2">{USES.map((u) => <PillToggle key={u} label={loose(tUse)(u)} on={form.uses.includes(u)} onToggle={() => toggleIn("uses", u)} testId={`use-${u}`} />)}</div>
        </div>
        <div>
          <p className="text-sm font-medium">{t("seasons")}</p>
          <div className="mt-2 flex flex-wrap gap-2">{SEASONS.map((s) => <PillToggle key={s} label={loose(tSeason)(s)} on={form.seasons.includes(s)} onToggle={() => toggleIn("seasons", s)} />)}</div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Check label={t("organic")} checked={form.organic} onChange={(e) => set({ organic: e.target.checked })} />
          <Input label={t("recycledPct")} inputMode="decimal" value={form.recycledPct} dir="ltr" onChange={(e) => set({ recycledPct: e.target.value })} error={err("recycledPct")} />
          <Input label={t("certifications")} value={form.certifications} onChange={(e) => set({ certifications: e.target.value })} hint={t("listHint")} />
        </div>
      </Section>

      <Section title={t("pricing")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t("moq")} inputMode="decimal" value={form.moqM} dir="ltr" onChange={(e) => set({ moqM: e.target.value })} error={err("moqM")} data-testid="f-moq" />
          <Input label={t("basePrice")} inputMode="decimal" value={form.basePrice} dir="ltr" onChange={(e) => set({ basePrice: e.target.value })} error={err("basePrice")} data-testid="f-price" />
        </div>
        <fieldset>
          <legend className="text-sm font-medium">{t("tiers")}</legend>
          <p className="text-xs text-text-muted">{t("tiersHint")}</p>
          <div className="mt-2 space-y-2">
            {form.tiers.map((x, i) => (
              <div key={i} className="flex items-center gap-2" data-testid="tier-row">
                <input value={x.minM} inputMode="decimal" dir="ltr" placeholder={t("tierMin")} aria-label={t("tierMin")} onChange={(e) => set({ tiers: form.tiers.map((y, j) => (j === i ? { ...y, minM: e.target.value } : y)) })} className="h-11 w-28 rounded-sm border border-border bg-surface px-3" data-testid="tier-min" />
                <input value={x.price} inputMode="decimal" dir="ltr" placeholder={t("tierPrice")} aria-label={t("tierPrice")} onChange={(e) => set({ tiers: form.tiers.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)) })} className="h-11 w-28 rounded-sm border border-border bg-surface px-3" data-testid="tier-price" />
                <button type="button" onClick={() => set({ tiers: form.tiers.filter((_, j) => j !== i) })} aria-label={t("remove")} className="rounded-full p-2 text-text-muted hover:text-danger"><Trash2 className="size-4" aria-hidden /></button>
              </div>
            ))}
            <Button type="button" variant="ghost" onClick={() => set({ tiers: [...form.tiers, { minM: "", price: "" }] })} data-testid="add-tier"><Plus className="size-4" aria-hidden />{t("addTier")}</Button>
          </div>
          {errors.tiers && <p role="alert" className="mt-1 text-xs text-danger">{err("tiers")}</p>}
        </fieldset>
      </Section>

      <Section title={t("feel")} hint={t("feelHint")}>
        <div className="grid gap-4 sm:grid-cols-5">
          {(["softness", "drape", "stretch", "sheen", "breathability"] as const).map((k) => (
            <Input key={k} label={loose(t)(`feelField.${k}`)} inputMode="decimal" dir="ltr" value={form.feel[k]} onChange={(e) => set({ feel: { ...form.feel, [k]: e.target.value } })} />
          ))}
        </div>
        {errors.feel && <p role="alert" className="text-xs text-danger">{err("feel")}</p>}
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" loading={saving} onClick={() => void save()} data-testid="save-fabric">{t("save")}</Button>
      </div>

      {id && (
        <>
          <Section title={t("jobs")} hint={t("jobsHint")} testId="jobs-status">
            <ul className="space-y-1 text-sm">
              <li data-testid="embedding-status" data-ready={embedded === true}>{t("embedding")} : <strong>{embedded === null ? "…" : embedded ? t("ready") : t("pending")}</strong></li>
              <li data-testid="translation-status">{t("translations")} : <strong>{needsTranslation.length === 0 ? t("complete") : t("missingIn", { langs: needsTranslation.map((l) => l.toUpperCase()).join(", ") })}</strong></li>
            </ul>
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={() => void translateMissing()} data-testid="translate-missing">{t("translateMissing")}</Button>
              <Button type="button" variant="ghost" onClick={() => void loadStatus()}>{t("refresh")}</Button>
            </div>
          </Section>
          <Section title={t("colors")} hint={t("colorsHint")}>
            <ColorsEditor fabricId={id} />
          </Section>
        </>
      )}
      {!id && <p className="text-sm text-text-muted">{t("colorsAfterSave")}</p>}
    </div>
  );
}
