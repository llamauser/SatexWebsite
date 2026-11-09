"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input, Select } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { authErrorKey } from "@/lib/auth/errors";
import { getBrowserSupabase } from "@/lib/db/browser";
import { loose } from "@/lib/i18n-loose";
import { fieldErrors, PASSWORD_MIN, signUpSchema } from "@/lib/validation/auth";

export function SignUpForm() {
  const t = useTranslations("auth");
  const tl = useTranslations("languages");
  const locale = useLocale();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const err = (key?: string) => (key ? loose(t)(`validation.${key}`, { min: PASSWORD_MIN }) : undefined);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const raw = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = signUpSchema.safeParse({ ...raw, acceptTerms: raw.acceptTerms === "on" });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return setFormError("notConfigured");

    setLoading(true);
    const v = parsed.data;
    const { data, error } = await supabase.auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        data: { full_name: v.fullName, company_name: v.company, phone: v.phone, preferred_locale: v.preferredLocale },
        emailRedirectTo: `${window.location.origin}/${locale}/auth/callback?next=${encodeURIComponent(`/${locale}/account`)}`,
      },
    });
    setLoading(false);
    if (error) return setFormError(authErrorKey(error));
    // Email confirmation is required: no session yet. If a session exists (confirmations off locally), go straight in.
    if (data.session) return window.location.assign(`/${locale}/account`);
    setSentTo(v.email);
  }

  if (sentTo) {
    return (
      <div className="space-y-4">
        <h2 className="font-display text-xl font-semibold">{t("signUp.checkEmailTitle")}</h2>
        <Alert kind="success">{t("signUp.checkEmailBody", { email: sentTo })}</Alert>
        {["localhost", "127.0.0.1"].includes(window.location.hostname) && (
          <p className="text-sm text-text-muted" data-testid="local-mail-hint">
            {t("signUp.localMail")}{" "}
            <a href="http://127.0.0.1:54324" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{t("signUp.localMailLink")}</a>
          </p>
        )}
        <Link href="/auth/sign-in" className="text-sm font-medium text-primary hover:underline">
          {t("reset.backToSignIn")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{loose(t)(`errors.${formError}`)}</Alert>}
      <Input name="fullName" autoComplete="name" label={t("signUp.fullName")} error={err(errors.fullName)} />
      <Input name="company" autoComplete="organization" label={t("signUp.company")} error={err(errors.company)} />
      <Input name="email" type="email" autoComplete="email" label={t("signUp.email")} error={err(errors.email)} />
      <Input
        name="password"
        type="password"
        autoComplete="new-password"
        label={t("signUp.password")}
        hint={t("signUp.passwordHint", { min: PASSWORD_MIN })}
        error={err(errors.password)}
      />
      <Input name="phone" type="tel" autoComplete="tel" label={t("signUp.phone")} error={err(errors.phone)} />
      <Select name="preferredLocale" label={t("signUp.language")} defaultValue={locale}>
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {tl(`names.${l}`)}
          </option>
        ))}
      </Select>
      <div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="acceptTerms" className="mt-1 size-4 accent-[var(--primary)]" />
          <span>
            {t.rich("signUp.terms", {
              terms: (c) => (
                <Link href="/legal/terms" className="text-primary underline">
                  {c}
                </Link>
              ),
              privacy: (c) => (
                <Link href="/legal/privacy" className="text-primary underline">
                  {c}
                </Link>
              ),
            })}
          </span>
        </label>
        {errors.acceptTerms && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {err(errors.acceptTerms)}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" loading={loading}>
        {t("signUp.submit")}
      </Button>
      <p className="text-center text-sm text-text-muted">
        {t("signUp.haveAccount")}{" "}
        <Link href="/auth/sign-in" className="font-medium text-primary hover:underline">
          {t("signUp.signIn")}
        </Link>
      </p>
    </form>
  );
}
