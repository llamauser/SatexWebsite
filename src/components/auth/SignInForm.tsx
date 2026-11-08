"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { authErrorKey } from "@/lib/auth/errors";
import { safeNext } from "@/lib/auth/guard";
import { getBrowserSupabase } from "@/lib/db/browser";
import { loose } from "@/lib/i18n-loose";
import { fieldErrors, resetRequestSchema, signInSchema } from "@/lib/validation/auth";

export function SignInForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const params = useSearchParams();
  const next = safeNext(params.get("next"), `/${locale}/account`);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(params.get("error") === "link" ? "linkInvalid" : null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState<"password" | "magic" | null>(null);

  const translateField = (key?: string) => (key ? loose(t)(`validation.${key}`, { min: 10 }) : undefined);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    setInfo(null);
    const parsed = signInSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return setFormError("notConfigured");
    setLoading("password");
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) {
      setLoading(null);
      return setFormError(authErrorKey(error));
    }
    window.location.assign(next); // full navigation so the middleware sees the new session cookie
  }

  async function sendMagicLink(form: HTMLFormElement | null) {
    setFormError(null);
    setInfo(null);
    const parsed = resetRequestSchema.safeParse({ email: form ? new FormData(form).get("email") : "" });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return setFormError("notConfigured");
    setLoading("magic");
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/${locale}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setLoading(null);
    // never reveal whether the address has an account
    if (error && authErrorKey(error) !== "generic") return setFormError(authErrorKey(error));
    setInfo(t("signIn.magicLinkSent", { email: parsed.data.email }));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {formError && <Alert>{loose(t)(formError === "linkInvalid" ? "callbackError" : `errors.${formError}`)}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}
      <Input name="email" type="email" autoComplete="email" label={t("signIn.email")} error={translateField(errors.email)} />
      <Input
        name="password"
        type="password"
        autoComplete="current-password"
        label={t("signIn.password")}
        error={translateField(errors.password)}
      />
      <div className="flex justify-end">
        <Link href="/auth/reset" className="text-sm font-medium text-primary hover:underline">
          {t("signIn.forgot")}
        </Link>
      </div>
      <Button type="submit" className="w-full" loading={loading === "password"} disabled={loading !== null}>
        {t("signIn.submit")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        loading={loading === "magic"}
        disabled={loading !== null}
        onClick={(e) => void sendMagicLink(e.currentTarget.form)}
      >
        {t("signIn.magicLink")}
      </Button>
      <p className="text-center text-sm text-text-muted">
        {t("signIn.noAccount")}{" "}
        <Link href="/auth/sign-up" className="font-medium text-primary hover:underline">
          {t("signIn.createAccount")}
        </Link>
      </p>
    </form>
  );
}
