"use client";

import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Input } from "@/components/ui/Field";
import { Link } from "@/i18n/navigation";
import { authErrorKey } from "@/lib/auth/errors";
import { getBrowserSupabase } from "@/lib/db/browser";
import { loose } from "@/lib/i18n-loose";
import { fieldErrors, newPasswordSchema, PASSWORD_MIN, resetRequestSchema } from "@/lib/validation/auth";

/** Step 1: ask for the email. Step 2 (?step=new, after the recovery link): choose a new password. */
export function ResetForm() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const step = useSearchParams().get("step") === "new" ? "new" : "request";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const err = (key?: string) => (key ? loose(t)(`validation.${key}`, { min: PASSWORD_MIN }) : undefined);

  async function onRequest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = resetRequestSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return setFormError("notConfigured");
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/${locale}/auth/callback?next=${encodeURIComponent(`/${locale}/auth/reset?step=new`)}`,
    });
    setLoading(false);
    if (error && authErrorKey(error) !== "generic") return setFormError(authErrorKey(error));
    setDone(t("reset.sent")); // same message whether or not the account exists
  }

  async function onNewPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    const parsed = newPasswordSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return setFormError("notConfigured");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) return setFormError(authErrorKey(error));
    setDone(t("reset.saved"));
  }

  const back = (
    <Link href="/auth/sign-in" className="text-sm font-medium text-primary hover:underline">
      {t("reset.backToSignIn")}
    </Link>
  );

  if (done) {
    return (
      <div className="space-y-4">
        <Alert kind="success">{done}</Alert>
        {back}
      </div>
    );
  }

  if (step === "new") {
    return (
      <form onSubmit={onNewPassword} noValidate className="space-y-4">
        {formError && <Alert>{loose(t)(`errors.${formError}`)}</Alert>}
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          label={t("reset.newPassword")}
          hint={t("signUp.passwordHint", { min: PASSWORD_MIN })}
          error={err(errors.password)}
        />
        <Input name="confirm" type="password" autoComplete="new-password" label={t("reset.confirmPassword")} error={err(errors.confirm)} />
        <Button type="submit" className="w-full" loading={loading}>
          {t("reset.save")}
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={onRequest} noValidate className="space-y-4">
      {formError && <Alert>{loose(t)(`errors.${formError}`)}</Alert>}
      <Input name="email" type="email" autoComplete="email" label={t("reset.email")} error={err(errors.email)} />
      <Button type="submit" className="w-full" loading={loading}>
        {t("reset.submit")}
      </Button>
      {back}
    </form>
  );
}
