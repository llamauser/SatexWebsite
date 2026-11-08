"use client";

import { useTranslations } from "next-intl";
import { Alert, Card } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { useAccountData } from "./useAccountData";

export function AccountOverview() {
  const t = useTranslations("account.overview");
  const { profile, status } = useAccountData();

  if (status === "loading") return <p className="text-text-muted">{t("loading")}</p>;
  if (status === "error" || !profile) return <Alert>{t("loadError")}</Alert>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold" data-testid="account-greeting">
          {t("greeting", { name: profile.fullName || profile.email })}
        </h1>
        <p className="mt-2 text-text-muted">{profile.companyName}</p>
      </div>
      {profile.deletionRequestedAt && <Alert kind="info">{t("deletionPending")}</Alert>}
      <Card>
        <h2 className="font-display text-xl font-semibold">{t("profileCard.title")}</h2>
        <p className="mt-1 text-text-muted">{t("profileCard.body")}</p>
        <Link href="/account/profile" className="mt-4 inline-block font-medium text-primary hover:underline">
          {t("profileCard.cta")}
        </Link>
      </Card>
    </div>
  );
}
