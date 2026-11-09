"use client";

import { useTranslations } from "next-intl";
import { loose } from "@/lib/i18n-loose";
import { cn } from "@/lib/utils";

export const QUOTE_STATUSES = ["submitted", "in_review", "sent", "accepted", "rejected", "expired", "cancelled", "converted"] as const;

const STYLES: Record<string, string> = {
  draft: "bg-surface-muted text-text-muted",
  submitted: "bg-primary/10 text-primary-strong",
  in_review: "bg-primary/10 text-primary-strong",
  sent: "bg-warning/15 text-warning",
  accepted: "bg-success/10 text-success",
  converted: "bg-success/10 text-success",
  rejected: "bg-danger/10 text-danger",
  expired: "bg-surface-muted text-text-muted",
  cancelled: "bg-surface-muted text-text-muted",
};

export function StatusPill({ status }: { status: string }) {
  const t = useTranslations("quotes.status");
  return (
    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", STYLES[status] ?? STYLES.draft)} data-testid="status-pill" data-status={status}>
      {loose(t)(status)}
    </span>
  );
}
