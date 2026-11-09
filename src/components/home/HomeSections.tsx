import { ArrowRight, Boxes, Building2, Sparkles } from "lucide-react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { buttonStyles } from "@/components/ui/Button";
import { Card } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { formatMoney, localized } from "@/lib/data/format";
import { loose } from "@/lib/i18n-loose";
import { getCategories, getFeaturedFabrics, getPublicSettings } from "@/lib/data/public";
import { FabricImage } from "./FabricImage";

const wrap = "mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8";
const gradient = { background: "var(--primary-gradient)" } as const;

export async function Hero() {
  const t = await getTranslations("home.hero");
  return (
    <section className={`${wrap} flex min-h-[62vh] flex-col items-center justify-center py-16 text-center`}>
      <h1 className="font-display text-[clamp(36px,5vw,64px)] font-bold leading-tight">{t("title")}</h1>
      <p className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
        {t.rich("subtitle", { highlight: (chunks) => <span className="text-primary">{chunks}</span> })}
      </p>
      <p className="mt-5 max-w-2xl text-lg text-text-muted">{t("lead")}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/match" className={buttonStyles({ size: "lg" })} style={gradient}>
          {t("ctaPrimary")}
          <ArrowRight className="size-4 rtl:-scale-x-100" aria-hidden />
        </Link>
        <Link href="/catalog" className={buttonStyles({ variant: "secondary", size: "lg" })}>
          {t("ctaSecondary")}
        </Link>
      </div>
    </section>
  );
}

export async function ValueProps() {
  const t = await getTranslations("home.values");
  const items = [
    { icon: Sparkles, key: "ai" },
    { icon: Boxes, key: "stock" },
    { icon: Building2, key: "showroom" },
  ] as const;
  return (
    <section className={`${wrap} py-12`} aria-labelledby="values-title">
      <h2 id="values-title" className="sr-only">
        {t("title")}
      </h2>
      <ul className="grid gap-5 md:grid-cols-3">
        {items.map(({ icon: Icon, key }) => (
          <li key={key}>
            <Card className="h-full">
              <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-xl font-semibold">{t(`${key}.title`)}</h3>
              <p className="mt-2 text-text-muted">{t(`${key}.body`)}</p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function FeaturedCategories({ locale }: { locale: string }) {
  const [t, categories] = await Promise.all([getTranslations("home.categories"), getCategories()]);
  if (categories.length === 0) return null;
  return (
    <section className={`${wrap} py-12`} aria-labelledby="categories-title">
      <h2 id="categories-title" className="font-display text-3xl font-bold">
        {t("title")}
      </h2>
      <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {categories.map((c) => (
          <li key={c.slug}>
            <Link
              href={{ pathname: "/catalog", query: { category: c.slug } }}
              className="block h-full rounded-md border border-border bg-surface p-4 transition hover:-translate-y-0.5 hover:shadow-card"
            >
              <span className="font-semibold">{localized(c.name, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function FeaturedFabrics({ locale }: { locale: string }) {
  const [t, ts, fabrics, settings] = await Promise.all([
    getTranslations("home.featured"),
    getTranslations("structures"),
    getFeaturedFabrics(6),
    getPublicSettings(),
  ]);
  if (fabrics.length === 0) return null;
  return (
    <section className={`${wrap} py-12`} aria-labelledby="featured-title">
      <div className="flex items-end justify-between gap-4">
        <h2 id="featured-title" className="font-display text-3xl font-bold">
          {t("title")}
        </h2>
        <Link href="/catalog" className="text-sm font-medium text-primary hover:underline">
          {t("all")}
        </Link>
      </div>
      <ul className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" data-testid="featured-fabrics">
        {fabrics.map((f, i) => {
          const name = localized(f.name, locale);
          return (
            <li key={f.slug}>
              <Link
                href={`/catalog/${f.slug}`}
                className="group block overflow-hidden rounded-md border border-border bg-surface shadow-card transition hover:-translate-y-0.5"
              >
                <div className="relative aspect-[4/3] bg-surface-muted">
                  <FabricImage path={f.imagePath} alt={name} sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw" priority={i < 2} />
                </div>
                <div className="p-4">
                  <h3 className="font-semibold group-hover:text-primary">{name}</h3>
                  <p className="mt-1 text-sm text-text-muted">
                    {ts.has(f.structure as never) ? loose(ts)(f.structure) : f.structure} · {f.gsm} GSM · {f.widthCm} cm
                  </p>
                  {f.fromPrice !== null && (
                    <p className="mt-2 text-sm font-medium text-primary-strong">
                      {t("from", { price: formatMoney(f.fromPrice, settings.currency, locale) })}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export async function ShowroomTeaser() {
  const t = await getTranslations("home.showroom");
  return (
    <section className={`${wrap} py-12`} aria-labelledby="showroom-title">
      <Card className="grid items-center gap-8 md:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent-beige-strong">{t("eyebrow")}</p>
          <h2 id="showroom-title" className="mt-2 font-display text-3xl font-bold">
            {t("title")}
          </h2>
          <p className="mt-3 text-text-muted">{t("body")}</p>
          <Link href="/showroom" className={`${buttonStyles()} mt-6`} style={gradient}>
            {t("cta")}
          </Link>
        </div>
        <Link href="/showroom" className="mx-auto block w-full max-w-xl overflow-hidden rounded-lg border border-border shadow-card transition hover:-translate-y-0.5">
          <Image src="/showroom/preview.webp" alt={t("imageAlt")} width={1400} height={923} sizes="(min-width: 768px) 560px, 100vw" className="h-auto w-full" />
        </Link>
      </Card>
    </section>
  );
}

export async function SinceSection() {
  const [t, settings] = await Promise.all([getTranslations("home.since"), getPublicSettings()]);
  const years = new Date().getFullYear() - settings.foundedYear;
  return (
    <section className={`${wrap} py-12 text-center`} aria-labelledby="since-title">
      <p className="font-display text-6xl font-bold text-primary" aria-hidden>
        {settings.foundedYear}
      </p>
      <h2 id="since-title" className="mt-2 font-display text-3xl font-bold">
        {t("title", { year: settings.foundedYear })}
      </h2>
      <p className="mx-auto mt-3 max-w-2xl text-text-muted">{t("body", { years })}</p>
    </section>
  );
}

export async function ContactCta() {
  const t = await getTranslations("home.contact");
  return (
    <section className={`${wrap} py-12`} aria-labelledby="contact-cta-title">
      <div className="rounded-lg px-6 py-10 text-center text-white sm:px-12" style={gradient}>
        <h2 id="contact-cta-title" className="font-display text-3xl font-bold">
          {t("title")}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-white/85">{t("body")}</p>
        <Link href="/contact" className={`${buttonStyles({ variant: "secondary", size: "lg" })} mt-6`}>
          {t("cta")}
        </Link>
      </div>
    </section>
  );
}
