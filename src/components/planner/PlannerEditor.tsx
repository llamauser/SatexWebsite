"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/db/browser";
import { STYLES } from "@/lib/match/schema";
import { calculateMeters } from "@/lib/planner/meterage";
import { paletteCoherence } from "@/lib/planner/palette";
import { evenSizeRun, SIZES, type GarmentConsumption, type Size } from "@/lib/planner/garments";
import { localized } from "@/lib/data/format";

type PieceInput = { garmentType: string; label: string; quantity: number; sizeRun: Record<Size, number>; notes: string };
type Alternative = { colorId: string; fabricId: string; slug: string; name: { fr?: string; en?: string; ar?: string }; colorName: { fr?: string; en?: string; ar?: string }; hex: string; widthCm: number; moqM: number; availableM: number; price: number | null; pct: number };
type ResultItem = { id: string; garment_type: string; label: string; quantity_units: number; size_run: Record<Size, number>; notes: string; chosen_color_id: string | null; meters_needed: number; alternatives: Alternative[]; chosen?: Alternative };
type Collection = { id: string; name: string; status: string; palette: { name: string; hex: string }[]; updated_at: string; quote_id: string | null };
type InitialDraft = { id: string; name: string; season: string | null; brief: { audienceText?: string; styles?: string[]; budgetPerM?: number | null; description?: string }; palette: { name: string; hex: string }[]; items: ResultItem[] };
type PlanResult = { collectionId: string; palette: { name: string; hex: string }[]; items: ResultItem[]; coherence: { paletteFit: boolean; supplierCoverage: boolean; distinctFabrics: number } };

function newPiece(garmentType: string): PieceInput {
  return { garmentType, label: "", quantity: 10, sizeRun: evenSizeRun(10), notes: "" };
}

export function PlannerEditor({ garments, collections, initialDraft, currency }: { garments: GarmentConsumption[]; collections: Collection[]; initialDraft: InitialDraft | null; currency: string }) {
  const translate = useTranslations();
  const t = (key: string, values?: Record<string, string | number>) => translate(`account.overview.planner.${key}` as never, values as never);
  const router = useRouter();
  const locale = useLocale();
  const garmentTypes = garments.map((garment) => garment.garment_type);
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [season, setSeason] = useState(initialDraft?.season ?? "all_season");
  const [description, setDescription] = useState(initialDraft?.brief.description ?? "");
  const [audience, setAudience] = useState(initialDraft?.brief.audienceText ?? "");
  const [styles, setStyles] = useState<string[]>(initialDraft?.brief.styles ?? []);
  const [budgetPerM, setBudgetPerM] = useState(initialDraft?.brief.budgetPerM?.toString() ?? "");
  const [pieces, setPieces] = useState<PieceInput[]>(initialDraft?.items.map((item) => ({
    garmentType: item.garment_type, label: item.label, quantity: item.quantity_units, sizeRun: item.size_run, notes: item.notes,
  })) ?? [newPiece(garmentTypes[0] ?? "t_shirt")]);
  const [savedCollections, setSavedCollections] = useState(collections);
  const [result, setResult] = useState<PlanResult | null>(initialDraft ? {
    collectionId: initialDraft.id,
    palette: initialDraft.palette,
    items: initialDraft.items.map((item) => ({ ...item, chosen: item.alternatives.find((alternative) => alternative.colorId === item.chosen_color_id) })),
    coherence: { paletteFit: true, supplierCoverage: true, distinctFabrics: new Set(initialDraft.items.map((item) => item.chosen?.fabricId)).size },
  } : null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const selectedById = (item: ResultItem) => item.alternatives.find((alternative) => alternative.colorId === item.chosen_color_id) ?? item.chosen ?? item.alternatives[0];
  const liveCoherence = useMemo(() => {
    if (!result) return null;
    const items = result.items;
    const chosen = items.map(selectedById).filter((item): item is Alternative => Boolean(item));
    return paletteCoherence(
      chosen.map((item) => ({ hex: item.hex, color_id: item.colorId, fabric_id: item.fabricId, available_m: item.availableM } as never)),
      result.palette,
      items.map((item) => item.meters_needed),
    );
  }, [result]);

  const updateInput = (index: number, update: Partial<PieceInput>) => setPieces((current) => current.map((piece, i) => i === index ? { ...piece, ...update } : piece));
  const build = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/planner/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        ...(initialDraft ? { collectionId: initialDraft.id } : {}), name, description, audienceText: audience, styles,
        budgetPerM: budgetPerM ? Number(budgetPerM) : null, season, pieces,
      }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setResult(body as PlanResult);
      setSavedCollections((current) => [
        { id: body.collectionId, name, status: "planned", palette: body.palette, updated_at: new Date().toISOString(), quote_id: null },
        ...current.filter((collection) => collection.id !== body.collectionId),
      ]);
    } catch { setError(t("error")); } finally { setBusy(false); }
  };

  const saveChoice = async (item: ResultItem, colorId: string, sizeRun = item.size_run) => {
    if (!result) return;
    const alternative = item.alternatives.find((entry) => entry.colorId === colorId);
    const garment = garments.find((entry) => entry.garment_type === item.garment_type);
    if (!alternative || !garment) return;
    const meters = calculateMeters(sizeRun, garment, alternative.widthCm, alternative.moqM);
    setResult((current) => current && ({ ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, chosen_color_id: colorId, size_run: sizeRun, meters_needed: meters, chosen: alternative } : entry) }));
    const response = await fetch("/api/planner/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ collectionId: result.collectionId, itemId: item.id, colorId, sizeRun }) });
    if (!response.ok) setError(t("saveChoiceError"));
  };

  const requestQuote = async () => {
    if (!result) return;
    setBusy(true); setError("");
    const sb = getBrowserSupabase();
    if (!sb) { setBusy(false); setError(t("error")); return; }
    const { data, error: quoteError } = await sb.rpc("request_collection_quote", { p_collection: result.collectionId, p_message: message });
    if (quoteError || !data?.id) { setError(t("quoteError")); setBusy(false); return; }
    router.push(`/account/quotes/${data.id}`);
  };

  const totalMeters = result?.items.reduce((sum, item) => sum + item.meters_needed, 0) ?? 0;
  const totalPrice = result?.items.reduce((sum, item) => sum + item.meters_needed * (selectedById(item)?.price ?? 0), 0) ?? 0;
  const money = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 });

  return (
    <div className="space-y-8">
      <header><h1 className="font-display text-3xl font-bold">{t("title")}</h1><p className="mt-2 text-text-muted">{t("intro")}</p></header>

      <section aria-labelledby="saved-collections-title" className="space-y-3">
        <h2 id="saved-collections-title" className="font-display text-xl font-semibold">{t("savedCollections")}</h2>
        {savedCollections.length ? <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{savedCollections.map((collection) => <li key={collection.id} className="rounded-xl border border-border p-4">
          <p className="font-semibold">{collection.name}</p><p className="mt-1 text-sm text-text-muted">{collection.status}</p>
          <div className="mt-3 flex gap-1">{collection.palette.map((color) => <span key={color.hex} title={color.name} className="size-5 rounded-full border border-border" style={{ backgroundColor: color.hex }} />)}</div>
          <div className="mt-3 flex flex-wrap gap-4">
            {collection.quote_id ? <Link className="text-sm font-medium text-primary hover:underline" href={`/account/quotes/${collection.quote_id}`}>{t("viewQuote")}</Link> : <Link className="text-sm font-medium text-primary hover:underline" href={{ pathname: "/account/planner", query: { id: collection.id } }}>{t("editCollection")}</Link>}
            <a className="text-sm font-medium text-primary hover:underline" href={`/api/planner/${collection.id}/board?locale=${locale}`}>{t("downloadBoard")}</a>
          </div>
        </li>)}</ul> : <p className="text-sm text-text-muted">{t("noCollections")}</p>}
        {initialDraft && <Link href="/account/planner" className="text-sm font-medium text-primary hover:underline">{t("newCollection")}</Link>}
      </section>

      <section className="grid gap-4 rounded-xl border border-border p-5 sm:grid-cols-2" aria-label={t("brief")}>
        <label className="text-sm font-medium">{t("name")}<input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 w-full rounded border border-border p-2" /></label>
        <label className="text-sm font-medium">{t("season")}<select value={season} onChange={(event) => setSeason(event.target.value)} className="mt-1 w-full rounded border border-border p-2">{["spring_summer", "autumn_winter", "all_season"].map((value) => <option key={value} value={value}>{t(`seasons.${value}`)}</option>)}</select></label>
        <label className="text-sm font-medium">{t("audience")}<input value={audience} onChange={(event) => setAudience(event.target.value)} className="mt-1 w-full rounded border border-border p-2" /></label>
        <label className="text-sm font-medium">{t("budget")}<input type="number" min="0" step="0.1" value={budgetPerM} onChange={(event) => setBudgetPerM(event.target.value)} className="mt-1 w-full rounded border border-border p-2" /></label>
        <label className="text-sm font-medium sm:col-span-2">{t("description")}<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 min-h-24 w-full rounded border border-border p-2" /></label>
        <div className="sm:col-span-2"><p className="mb-2 text-sm font-medium">{t("styles")}</p><div className="flex flex-wrap gap-2">{STYLES.map((style) => <button type="button" key={style} aria-pressed={styles.includes(style)} onClick={() => setStyles((current) => current.includes(style) ? current.filter((value) => value !== style) : current.length < 3 ? [...current, style] : current)} className={`rounded-full border px-3 py-1 text-sm ${styles.includes(style) ? "border-primary bg-primary/10" : "border-border"}`}>{translate(`match.wizard.styles.${style}` as never)}</button>)}</div></div>
      </section>

      <section className="space-y-3"><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-semibold">{t("pieces")}</h2><span className="text-sm text-text-muted">{t("pieceLimit")}</span></div>
        {pieces.map((piece, index) => <fieldset key={index} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-4"><legend className="px-1 text-sm font-semibold">{t("pieceNumber", { number: index + 1 })}</legend>
        <label className="text-sm">{t("garment")}<select value={piece.garmentType} onChange={(event) => updateInput(index, { garmentType: event.target.value })} className="mt-1 w-full rounded border border-border p-2">{garmentTypes.map((garment) => <option key={garment} value={garment}>{translate(`account.overview.planner.garments.${garment}` as never)}</option>)}</select></label>
          <label className="text-sm">{t("piece")}<input value={piece.label} onChange={(event) => updateInput(index, { label: event.target.value })} className="mt-1 w-full rounded border border-border p-2" /></label>
          <label className="text-sm">{t("quantity")}<input type="number" min="1" max="100000" value={piece.quantity} onChange={(event) => { const quantity = Math.max(1, Number(event.target.value) || 1); updateInput(index, { quantity, sizeRun: evenSizeRun(quantity) }); }} className="mt-1 w-full rounded border border-border p-2" /></label>
          <label className="text-sm">{t("notes")}<input value={piece.notes} onChange={(event) => updateInput(index, { notes: event.target.value })} className="mt-1 w-full rounded border border-border p-2" /></label>
          <div className="sm:col-span-2 lg:col-span-4"><p className="mb-2 text-sm font-medium">{t("sizeRun")}</p><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{SIZES.map((size) => <label key={size} className="text-xs text-text-muted">{size}<input type="number" min="0" value={piece.sizeRun[size] ?? 0} onChange={(event) => updateInput(index, { sizeRun: { ...piece.sizeRun, [size]: Math.max(0, Number(event.target.value) || 0) } })} className="mt-1 w-full rounded border border-border p-2 text-sm text-text" /></label>)}</div></div>
          <button type="button" disabled={pieces.length === 1} onClick={() => setPieces((current) => current.filter((_, i) => i !== index))} className="justify-self-start text-sm text-red-700 disabled:opacity-40">{t("removePiece")}</button>
        </fieldset>)}
        <button type="button" onClick={() => setPieces((current) => current.length < 12 ? [...current, newPiece(garmentTypes[0] ?? "t_shirt")] : current)} disabled={pieces.length >= 12} className="text-sm font-medium text-primary disabled:opacity-40">{t("addPiece")}</button>
      </section>

      <button type="button" disabled={busy || !name.trim() || !description.trim() || pieces.some((piece) => Object.values(piece.sizeRun).reduce((sum, value) => sum + value, 0) !== piece.quantity)} onClick={build} className="rounded-lg bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? t("building") : t("build")}</button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {result && <section className="space-y-5 rounded-xl border border-border p-5" aria-labelledby="planner-result-title">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="planner-result-title" data-testid="planner-result-title" className="font-display text-xl font-semibold">{t("results")}</h2><a className="text-sm font-medium text-primary hover:underline" href={`/api/planner/${result.collectionId}/board?locale=${locale}`}>{t("downloadBoard")}</a></div>
        <div><p className="mb-2 font-medium">{t("palette")}</p><div className="flex flex-wrap gap-2">{result.palette.map((color) => <span title={color.name} key={`${color.hex}-${color.name}`} className="inline-flex items-center gap-2 rounded-full border border-border pe-3"><span className="size-8 rounded-full border border-border" style={{ backgroundColor: color.hex }} />{color.name}</span>)}</div></div>
        <div className="grid gap-2 text-sm sm:grid-cols-3"><p className={liveCoherence?.paletteFit ? "text-success" : "text-amber-700"}>{liveCoherence?.paletteFit ? "✓" : "!"} {t("paletteFit")}</p><p className={liveCoherence?.supplierCoverage ? "text-success" : "text-amber-700"}>{liveCoherence?.supplierCoverage ? "✓" : "!"} {t("supplierCoverage")}</p><p>{t("distinctFabrics", { count: liveCoherence?.distinctFabrics ?? 0 })}</p></div>
        <div className="divide-y divide-border">{result.items.map((item) => {
          const chosen = selectedById(item);
          return <article key={item.id} className="space-y-3 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{item.label}</h3><p className="text-sm text-text-muted">{chosen ? `${localized(chosen.name, locale)} · ${localized(chosen.colorName, locale)}` : "—"}</p></div><div className="text-end"><p className="font-semibold">{t("meters", { meters: item.meters_needed.toFixed(1) })}</p><p className="text-sm text-text-muted">{chosen ? `${chosen.availableM.toFixed(1)} m ${t("available")}` : ""}</p></div></div>
            {chosen && chosen.availableM < item.meters_needed && <p role="status" className="text-sm text-amber-700">{t("stockWarning", { meters: (item.meters_needed - chosen.availableM).toFixed(1) })}</p>}
            <div className="flex flex-wrap gap-2" aria-label={t("alternatives")}>{item.alternatives.map((alternative) => <button key={alternative.colorId} type="button" aria-pressed={item.chosen_color_id === alternative.colorId} title={`${localized(alternative.name, locale)} · ${localized(alternative.colorName, locale)} · ${alternative.availableM} m`} onClick={() => void saveChoice(item, alternative.colorId)} className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${item.chosen_color_id === alternative.colorId ? "border-primary bg-primary/10" : "border-border"}`}><span className="size-5 rounded-full border border-border" style={{ backgroundColor: alternative.hex }} />{localized(alternative.name, locale)}{alternative.availableM < item.meters_needed ? " !" : ""}</button>)}</div>
          </article>;
        })}</div>
        <div className="grid gap-2 rounded-lg bg-surface-muted p-4 sm:grid-cols-2"><p className="font-semibold">{t("totalMeters", { meters: totalMeters.toFixed(1) })}</p><p className="font-semibold">{t("estimatedTotal", { price: money.format(totalPrice) })}</p></div>
        <label className="block text-sm font-medium">{t("quoteMessage")}<textarea value={message} onChange={(event) => setMessage(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-border p-2" /></label>
        <button type="button" disabled={busy || result.items.some((item) => !item.chosen_color_id)} onClick={requestQuote} className="rounded-lg bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">{t("requestQuote")}</button>
      </section>}
    </div>
  );
}
