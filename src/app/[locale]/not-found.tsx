import { useTranslations } from "next-intl";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("errors.notFound");
  return (
    <>
      <BlobBackground />
      <main className="mx-auto flex min-h-[60vh] max-w-[1200px] flex-col items-center justify-center px-4 text-center">
        <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
        <p className="mt-3 text-text-muted">{t("body")}</p>
        <Link
          href="/"
          className="mt-8 inline-flex h-11 items-center rounded-full px-6 font-semibold text-white"
          style={{ background: "var(--primary-gradient)" }}
        >
          {t("cta")}
        </Link>
      </main>
    </>
  );
}
