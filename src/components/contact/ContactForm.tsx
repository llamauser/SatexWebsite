"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState } from "react";
import { submitContact, type ContactState } from "@/app/[locale]/contact/actions";
import { Button } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { loose } from "@/lib/i18n-loose";

const initial: ContactState = { status: "idle" };

export function ContactForm() {
  const t = useTranslations("contact.form");
  const tv = useTranslations("contact.validation");
  const locale = useLocale();
  const [state, action, pending] = useActionState(submitContact, initial);

  if (state.status === "success") {
    return (
      <div className="space-y-3" data-testid="contact-success">
        <h2 className="font-display text-2xl font-semibold">{t("successTitle")}</h2>
        <Alert kind="success">{t("successBody")}</Alert>
      </div>
    );
  }

  const err = (field: string) => (state.fieldErrors?.[field] ? loose(tv)(state.fieldErrors[field]!) : undefined);
  return (
    <form action={action} noValidate className="space-y-4">
      {state.status === "error" && state.error !== "validation" && (
        <Alert>{state.error === "rate_limited" ? t("rateLimited") : t("serverError")}</Alert>
      )}
      <input type="hidden" name="locale" value={locale} />
      {/* honeypot: hidden from people and screen readers, bots fill it */}
      <div aria-hidden="true" className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="name" autoComplete="name" label={t("name")} error={err("name")} />
        <Input name="company" autoComplete="organization" label={t("company")} error={err("company")} />
        <Input name="email" type="email" autoComplete="email" label={t("email")} error={err("email")} />
        <Input name="phone" type="tel" autoComplete="tel" label={t("phone")} error={err("phone")} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="contact-message" className="block text-sm font-medium">
          {t("message")}
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={6}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-base text-text focus:border-primary aria-[invalid=true]:border-danger"
          aria-invalid={err("message") ? true : undefined}
        />
        {err("message") && (
          <p role="alert" className="text-xs text-danger">
            {err("message")}
          </p>
        )}
      </div>
      <div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            {t.rich("consent", {
              privacy: (c) => (
                <Link href="/legal/privacy" className="text-primary underline">
                  {c}
                </Link>
              ),
            })}
          </span>
        </label>
        {err("consent") && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {err("consent")}
          </p>
        )}
      </div>
      <Button type="submit" loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
