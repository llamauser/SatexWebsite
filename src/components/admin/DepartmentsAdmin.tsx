"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import {
  checkLayout, FLOOR_D, FLOOR_W, KINDS, overlapping, previewHeight, previewRect, toLayout, type DepartmentRow, type Layout,
} from "@/lib/admin/departments";
import { slugify } from "@/lib/admin/fabric-form";
import { localized, type I18nField } from "@/lib/data/format";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { loose } from "@/lib/i18n-loose";
import { Check, Section } from "./ui";
import { useStaffRole } from "./useRole";

interface Category { id: string; name: I18nField }
interface Draft {
  id: string | null; slug: string; name: { fr: string; en: string; ar: string }; floor: "0" | "1"; kind: string;
  layout: Record<keyof Layout, string>; categoryIds: string[]; sort: string;
}
type Msg = { kind: "success" | "error"; text: string } | null;
const PREVIEW_W = 640;

const emptyDraft = (sort: number): Draft => ({
  id: null, slug: "", name: { fr: "", en: "", ar: "" }, floor: "0", kind: "fabric_hall",
  layout: { x: "2", z: "2", w: "8", d: "6", rotation: "0", racks: "4", color: "#C9B497" }, categoryIds: [], sort: String(sort),
});
const fromRow = (r: DepartmentRow): Draft => ({
  id: r.id, slug: r.slug, name: { fr: r.name.fr ?? "", en: r.name.en ?? "", ar: r.name.ar ?? "" }, floor: String(r.floor) as "0" | "1", kind: r.kind,
  layout: Object.fromEntries(Object.entries(r.layout).map(([k, v]) => [k, String(v)])) as Record<keyof Layout, string>, categoryIds: r.category_ids, sort: String(r.sort),
});

/** Showroom departments: name, floor, kind, position and size on a 2D plan (live preview), linked categories. */
export function DepartmentsAdmin() {
  const t = useTranslations("admin.departments");
  const locale = useLocale();
  const role = useStaffRole();
  const [rows, setRows] = useState<DepartmentRow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft(1));
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const sb = await loadBrowserSupabase();
    if (!sb) return;
    const [d, c] = await Promise.all([sb.from("departments").select("*").order("floor").order("sort"), sb.from("categories").select("id, name").order("sort")]);
    setRows((d.data ?? []) as unknown as DepartmentRow[]);
    setCategories((c.data ?? []) as unknown as Category[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const issue = checkLayout(draft.layout);
  const layout = issue ? null : toLayout(draft.layout);
  const floor = Number(draft.floor);
  const neighbours = useMemo(() => (rows ?? []).filter((r) => r.floor === floor && r.id !== draft.id), [rows, floor, draft.id]);
  const overlap = layout ? overlapping({ slug: draft.slug || "_", floor, layout }, neighbours.map((r) => ({ slug: r.slug, floor: r.floor, layout: r.layout }))) : [];
  const setLayout = (k: keyof Layout, v: string) => setDraft((d) => ({ ...d, layout: { ...d.layout, [k]: v } }));
  const fail = (text: string) => setMsg({ kind: "error", text });

  async function save() {
    setMsg(null);
    if (!draft.name.fr.trim()) return fail(t("nameRequired"));
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(draft.slug)) return fail(t("slugInvalid"));
    if (issue || !layout) return fail(loose(t)(`layoutIssue.${issue}`));
    const sortNumber = Number(draft.sort);
    if (!Number.isInteger(sortNumber)) return fail(t("sortInvalid"));
    setSaving(true);
    const sb = (await loadBrowserSupabase())!;
    const row = {
      slug: draft.slug, name: Object.fromEntries((["fr", "en", "ar"] as const).filter((l) => draft.name[l].trim()).map((l) => [l, draft.name[l].trim()])),
      floor: floor, kind: draft.kind, layout, category_ids: draft.categoryIds, sort: sortNumber,
    };
    const { data, error } = draft.id ? await sb.from("departments").update(row).eq("id", draft.id).select("id").single() : await sb.from("departments").insert(row).select("id").single();
    setSaving(false);
    if (error) return fail(error.code === "23505" ? t("slugTaken") : t("saveError"));
    setMsg({ kind: "success", text: t("saved") });
    await load();
    setDraft((d) => ({ ...d, id: data.id as string }));
  }

  async function remove() {
    if (!draft.id || !window.confirm(t("confirmDelete"))) return;
    const sb = (await loadBrowserSupabase())!;
    const { error } = await sb.from("departments").delete().eq("id", draft.id);
    if (error) return fail(t("saveError"));
    setMsg({ kind: "success", text: t("deleted") });
    setDraft(emptyDraft((rows?.length ?? 0) + 1));
    await load();
  }

  if (role !== "loading" && role !== "admin") return <Alert>{t("adminOnly")}</Alert>;

  return (
    <div className="space-y-6" data-testid="departments-admin">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
        <Button type="button" variant="secondary" onClick={() => { setMsg(null); setDraft(emptyDraft((rows?.length ?? 0) + 1)); }} data-testid="new-department">{t("new")}</Button>
      </div>
      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <ul className="space-y-2" data-testid="department-list">
          {rows?.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { setMsg(null); setDraft(fromRow(r)); }} aria-current={r.id === draft.id} data-testid="department-item" data-slug={r.slug}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-start ${r.id === draft.id ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-surface-muted"}`}>
                <span className="size-5 shrink-0 rounded-sm border border-border" style={{ background: r.layout.color }} aria-hidden />
                <span className="flex-1 text-sm font-medium">{localized(r.name, locale)}</span>
                <span className="text-xs text-text-muted">{t("floorShort", { n: r.floor })}</span>
              </button>
            </li>
          ))}
          {rows === null && <p className="text-text-muted">{t("loading")}</p>}
        </ul>

        <div className="space-y-6">
          <Section title={t("preview", { floor: floor })} hint={t("previewHint", { w: FLOOR_W, d: FLOOR_D })}>
            <svg viewBox={`0 0 ${PREVIEW_W} ${previewHeight(PREVIEW_W)}`} className="w-full rounded-sm border border-border bg-surface-muted" role="img" aria-label={t("previewLabel")} data-testid="department-preview">
              {neighbours.map((r) => {
                const p = previewRect(r.layout, PREVIEW_W);
                return <g key={r.id}><rect x={p.x} y={p.y} width={p.w} height={p.h} fill={r.layout.color} fillOpacity={0.35} stroke="#888" /><text x={p.x + 4} y={p.y + 14} fontSize="11" fill="#333">{r.slug}</text></g>;
              })}
              {layout && (() => {
                const p = previewRect(layout, PREVIEW_W);
                return <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={layout.color} fillOpacity={0.8} stroke={overlap.length > 0 ? "#C62828" : "#1F6FEB"} strokeWidth={3} data-testid="preview-current" data-overlap={overlap.length > 0} />;
              })()}
            </svg>
            {issue && <p role="alert" className="text-sm text-danger" data-testid="layout-issue">{loose(t)(`layoutIssue.${issue}`)}</p>}
            {overlap.length > 0 && <p role="status" className="text-sm text-warning" data-testid="layout-overlap">{t("overlap", { with: overlap.join(", ") })}</p>}
          </Section>

          <Section title={draft.id ? t("edit") : t("create")}>
            <div className="grid gap-4 sm:grid-cols-3">
              {(["fr", "en", "ar"] as const).map((l) => (
                <Input key={l} label={`${t("name")} (${l.toUpperCase()})`} dir={l === "ar" ? "rtl" : "ltr"} value={draft.name[l]}
                  onChange={(e) => setDraft((d) => ({ ...d, name: { ...d.name, [l]: e.target.value }, slug: !d.id && l === "fr" && (d.slug === "" || d.slug === slugify(d.name.fr)) ? slugify(e.target.value) : d.slug }))} data-testid={`dept-name-${l}`} />
              ))}
              <Input label={t("slug")} dir="ltr" value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })} data-testid="dept-slug" />
              <Select label={t("floor")} value={draft.floor} onChange={(e) => setDraft({ ...draft, floor: e.target.value as "0" | "1" })} data-testid="dept-floor">
                <option value="0">{t("floorName", { n: 0 })}</option><option value="1">{t("floorName", { n: 1 })}</option>
              </Select>
              <Select label={t("kind")} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {KINDS.map((k) => <option key={k} value={k}>{loose(t)(`kinds.${k}`)}</option>)}
              </Select>
              <Input label={t("sort")} inputMode="numeric" dir="ltr" value={draft.sort} onChange={(e) => setDraft({ ...draft, sort: e.target.value })} />
            </div>
            <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-7">
              {(["x", "z", "w", "d", "rotation", "racks", "color"] as const).map((k) => (
                <Input key={k} label={loose(t)(`layout.${k}`)} dir="ltr" value={draft.layout[k]} onChange={(e) => setLayout(k, e.target.value)} data-testid={`layout-${k}`} />
              ))}
            </div>
            <fieldset>
              <legend className="text-sm font-medium">{t("categories")}</legend>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                {categories.map((c) => (
                  <Check key={c.id} label={localized(c.name, locale)} checked={draft.categoryIds.includes(c.id)} onChange={(e) => setDraft((d) => ({ ...d, categoryIds: e.target.checked ? [...d.categoryIds, c.id] : d.categoryIds.filter((x) => x !== c.id) }))} />
                ))}
              </div>
            </fieldset>
            <div className="flex gap-3">
              <Button type="button" loading={saving} onClick={() => void save()} data-testid="save-department">{t("save")}</Button>
              {draft.id && <Button type="button" variant="ghost" onClick={() => void remove()} data-testid="delete-department">{t("delete")}</Button>}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
