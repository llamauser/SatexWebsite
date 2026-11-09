"use client";

import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { loose } from "@/lib/i18n-loose";
import { AUDIENCES, BRAND_FEELS, STYLES, WizardInputSchema } from "@/lib/match/schema";
import { cn } from "@/lib/utils";

const STEPS = ["audience", "style", "brand", "describe", "match"] as const;
const STORAGE_KEY = "satex.match.v1";

interface State {
  step: number;
  audience: string | null;
  audienceText: string;
  styles: string[];
  brand: string[];
  priceTarget: string;
  description: string;
  requiredM: string;
}
const initial: State = { step: 0, audience: null, audienceText: "", styles: [], brand: [], priceTarget: "", description: "", requiredM: "" };

type Stage = "understanding" | "searching" | "ranking" | "explaining";

function Chips({ options, selected, onToggle, max, label }: { options: readonly string[]; selected: string[]; onToggle: (v: string) => void; max: number; label: (v: string) => string }) {
  return (
    <ul className="mt-5 flex flex-wrap gap-2.5">
      {options.map((o) => {
        const on = selected.includes(o);
        const disabled = !on && selected.length >= max;
        return (
          <li key={o}>
            <button
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onToggle(o)}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-medium transition",
                on ? "bg-text text-white" : "bg-surface-muted text-text-muted hover:text-text",
                disabled && "cursor-not-allowed opacity-40",
              )}
              data-testid={`chip-${o}`}
            >
              {label(o)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function MatchWizard({ topic }: { topic?: string }) {
  const t = useTranslations("match.wizard");
  const locale = useLocale();
  const router = useRouter();
  const [s, setS] = useState<State>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<{ stage: Stage; scanned: number | null } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) setS({ ...initial, ...(JSON.parse(saved) as Partial<State>) });
    } catch {
      /* storage can be unavailable: the wizard simply starts empty */
    }
    // coming from a department of the showroom: its name starts the description (what the visitor already wrote is kept)
    if (topic) setS((v) => (v.description.trim() === "" ? { ...v, description: t("topicPrefill", { topic }) } : v));
    setLoaded(true);
    return () => abort.current?.abort();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s, loaded]);

  const set = (patch: Partial<State>) => setS((v) => ({ ...v, ...patch }));
  const toggle = (key: "styles" | "brand", max: number) => (value: string) =>
    set({ [key]: s[key].includes(value) ? s[key].filter((x) => x !== value) : s[key].length < max ? [...s[key], value] : s[key] } as Partial<State>);

  const descriptionLength = s.description.trim().length;
  const canNext = [s.audience !== null || s.audienceText.trim().length > 0, s.styles.length > 0, s.brand.length > 0, descriptionLength >= 10 && descriptionLength <= 600, true][s.step]!;
  const pct = Math.round((s.step / STEPS.length) * 100);

  async function submit() {
    setError(null);
    const parsed = WizardInputSchema.safeParse({
      audience: s.audience, audienceText: s.audienceText, styles: s.styles, brand: s.brand,
      priceTarget: s.priceTarget ? Number(s.priceTarget) : null, description: s.description, requiredM: s.requiredM ? Number(s.requiredM) : null,
    });
    if (!parsed.success) return setError("invalid");
    setRunning({ stage: "understanding", scanned: null });
    abort.current = new AbortController();
    try {
      const res = await fetch("/api/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: parsed.data, locale }), signal: abort.current.signal });
      if (res.status === 429) throw new Error("rate");
      if (!res.ok || !res.body) throw new Error("server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sessionId: string | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as { type: string; stage?: Stage; scanned?: number; sessionId?: string };
          if (event.type === "progress" && event.stage) setRunning((r) => ({ stage: event.stage!, scanned: event.scanned ?? r?.scanned ?? null }));
          if (event.type === "error") throw new Error("server");
          if (event.type === "done" && event.sessionId) sessionId = event.sessionId;
        }
      }
      if (!sessionId) throw new Error("server");
      router.push(`/match/${sessionId}`);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setRunning(null);
      setError((e as Error).message === "rate" ? "rate" : "server");
    }
  }

  if (running) {
    return (
      <div className="mx-auto max-w-xl rounded-md border border-border bg-surface p-8 text-center shadow-card" data-testid="match-running">
        <div className="mx-auto grid w-40 grid-cols-4 gap-1.5" aria-hidden>
          {Array.from({ length: 16 }, (_, i) => (
            <span key={i} className="aspect-square animate-pulse rounded-sm bg-surface-muted" style={{ animationDelay: `${(i % 8) * 120}ms` }} />
          ))}
        </div>
        <p className="mt-6 font-display text-xl font-semibold" role="status" aria-live="polite">
          {running.scanned !== null ? t("scanning", { count: running.scanned }) : t(`stage.${running.stage}`)}
        </p>
        <p className="mt-2 text-sm text-text-muted">{t(`stage.${running.stage}`)}</p>
      </div>
    );
  }

  const question = ["audience", "style", "brand", "describe", "match"][s.step]!;

  return (
    <div className="mx-auto grid max-w-4xl overflow-hidden rounded-lg border border-border bg-surface shadow-card md:grid-cols-[260px_1fr]" data-testid="match-wizard">
      <aside className="bg-surface-muted p-6" aria-label={t("steps.label")}>
        <p className="font-display text-sm font-bold">{t("title")}</p>
        <ol className="mt-5 space-y-3.5">
          {STEPS.map((name, i) => {
            const done = i < s.step;
            const current = i === s.step;
            return (
              <li key={name} className="flex items-center gap-3 text-sm" aria-current={current ? "step" : undefined}>
                <span className={cn("flex size-7 items-center justify-center rounded-full text-xs font-bold", done || current ? "bg-text text-white" : "bg-surface text-text-muted")}>
                  {done ? <Check className="size-4" aria-hidden /> : i + 1}
                </span>
                <span className={cn(current ? "font-semibold text-text" : done ? "text-primary-strong" : "text-text-muted")}>{t(`steps.${name}`)}</span>
              </li>
            );
          })}
        </ol>
        <div className="mt-8">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-border" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-2 text-xs text-text-muted">{t("progress", { pct })}</p>
        </div>
      </aside>

      <section className="flex min-h-[420px] flex-col p-6 sm:p-10" aria-live="polite">
        <h2 className="font-display text-2xl font-bold sm:text-3xl" data-testid="wizard-question">
          {loose(t)(`q.${question}`)}
        </h2>

        {s.step === 0 && (
          <>
            <Chips options={AUDIENCES} selected={s.audience ? [s.audience] : []} max={1} label={(v) => loose(t)(`audience.${v}`)} onToggle={(v) => set({ audience: s.audience === v ? null : v })} />
            <label className="mt-5 block text-sm font-medium">
              {t("audienceText")}
              <input value={s.audienceText} onChange={(e) => set({ audienceText: e.target.value })} maxLength={200} className="mt-1.5 h-11 w-full rounded-sm border border-border bg-surface px-3 text-base" />
            </label>
          </>
        )}
        {s.step === 1 && (
          <>
            <p className="mt-1 text-sm text-text-muted">{t("upTo3")}</p>
            <Chips options={STYLES} selected={s.styles} max={3} label={(v) => loose(t)(`styles.${v}`)} onToggle={toggle("styles", 3)} />
          </>
        )}
        {s.step === 2 && (
          <>
            <p className="mt-1 text-sm text-text-muted">{t("upTo3")}</p>
            <Chips options={BRAND_FEELS} selected={s.brand} max={3} label={(v) => loose(t)(`brand.${v}`)} onToggle={toggle("brand", 3)} />
            <label className="mt-6 block text-sm font-medium">
              {t("priceTarget")}
              <input type="number" min={0} step="0.5" inputMode="decimal" value={s.priceTarget} onChange={(e) => set({ priceTarget: e.target.value })} className="mt-1.5 h-11 w-40 rounded-sm border border-border bg-surface px-3 text-base" />
            </label>
          </>
        )}
        {s.step === 3 && (
          <div className="mt-2">
            <p className="text-sm text-text-muted">{t("describeHint")}</p>
            <textarea
              value={s.description}
              onChange={(e) => set({ description: e.target.value })}
              rows={5}
              maxLength={600}
              placeholder={t("describePlaceholder")}
              aria-label={t("q.describe")}
              className="mt-3 w-full rounded-md border border-border bg-surface-muted px-4 py-3 text-lg"
              data-testid="wizard-description"
            />
            <p className="mt-1 text-xs text-text-muted">{descriptionLength}/600{descriptionLength > 0 && descriptionLength < 10 ? ` · ${t("descriptionMin")}` : ""}</p>
          </div>
        )}
        {s.step === 4 && (
          <div className="mt-2 space-y-4">
            <dl className="divide-y divide-border rounded-md border border-border text-sm">
              {([
                ["audience", s.audience ? loose(t)(`audience.${s.audience}`) : s.audienceText || "–"],
                ["style", s.styles.map((v) => loose(t)(`styles.${v}`)).join(", ") || "–"],
                ["brand", s.brand.map((v) => loose(t)(`brand.${v}`)).join(", ") || "–"],
                ["describe", s.description],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
                  <dt className="w-32 shrink-0 text-text-muted">{t(`steps.${k}`)}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <label className="block text-sm font-medium">
              {t("requiredM")}
              <input type="number" min={0} step="1" inputMode="numeric" value={s.requiredM} onChange={(e) => set({ requiredM: e.target.value })} className="mt-1.5 h-11 w-40 rounded-sm border border-border bg-surface px-3 text-base" />
            </label>
          </div>
        )}

        {error && <div className="mt-4"><Alert>{loose(t)(`error.${error}`)}</Alert></div>}

        <div className="mt-auto flex items-center justify-between gap-3 pt-8">
          <Button variant="ghost" onClick={() => set({ step: s.step - 1 })} disabled={s.step === 0} data-testid="wizard-back">
            {t("back")}
          </Button>
          {s.step < STEPS.length - 1 ? (
            <Button onClick={() => set({ step: s.step + 1 })} disabled={!canNext} data-testid="wizard-next">
              {t("next")}
            </Button>
          ) : (
            <Button onClick={() => void submit()} data-testid="wizard-submit">
              {t("find")}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
