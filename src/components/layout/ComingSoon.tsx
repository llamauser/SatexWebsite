import { getTranslations } from "next-intl/server";
import { BlobBackground } from "@/components/layout/BlobBackground";
import { buttonStyles } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";

/** Temporary page for sections that are built in a later task (catalog P1-07, AI match P1-09, showroom P1-16). */
export async function ComingSoon({ section }: { section: "catalog" | "match" | "showroom" }) {
  const t = await getTranslations("comingSoon");
  const tn = await getTranslations("nav");
  return (
    <main className="mx-auto flex min-h-[55vh] max-w-[1200px] flex-col items-center justify-center px-4 py-16 text-center">
      <BlobBackground />
      <h1 className="font-display text-4xl font-bold">{tn(section)}</h1>
      <p className="mt-3 max-w-xl text-text-muted">{t(section)}</p>
      <Link href="/" className={`${buttonStyles({ variant: "secondary" })} mt-8`}>
        {t("back")}
      </Link>
    </main>
  );
}
