"use client";

import { FlaskConical } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Link, useRouter } from "@/i18n/navigation";
import { cartMode } from "@/lib/cart/cart";
import { hasAuthCookie, loadBrowserSupabase } from "@/lib/db/browser-lazy";
import { selectColor } from "@/lib/samples/client";

/**
 * "Request a sample" for one color. The color joins the client's selection (kept in the browser), then the request form
 * opens. Visitors are sent to sign in first and come back to the form; staff do not request samples.
 */
export function RequestSample({ colorId, compact = false }: { colorId: string; compact?: boolean }) {
  const t = useTranslations("cart.sample");
  const locale = useLocale();
  const router = useRouter();
  const [staff, setStaff] = useState(false);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const mode = await cartMode(await loadBrowserSupabase());
      if (!cancelled) setStaff(mode === "guest" && hasAuthCookie());
    })();
    return () => { cancelled = true; };
  }, []);

  if (staff) return null;

  function go() {
    const { full: isFull } = selectColor(colorId);
    if (isFull) return setFull(true);
    setFull(false);
    if (hasAuthCookie()) router.push("/account/samples/new");
    else router.push({ pathname: "/auth/sign-in", query: { next: `/${locale}/account/samples/new` } });
  }

  return (
    <div className={compact ? "" : "mt-3"}>
      <Button type="button" variant="secondary" onClick={go} data-testid="request-sample">
        <FlaskConical className="size-4" aria-hidden />
        {t("button")}
      </Button>
      {full && (
        <p role="alert" className="mt-2 text-xs text-warning" data-testid="sample-full">
          {t("full")} <Link href="/account/samples/new" className="underline">{t("openForm")}</Link>
        </p>
      )}
    </div>
  );
}
