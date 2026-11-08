"use client";

import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Card, Input, Select } from "@/components/ui/Field";
import { routing } from "@/i18n/routing";
import { authErrorKey } from "@/lib/auth/errors";
import { getBrowserSupabase } from "@/lib/db/browser";
import { loose } from "@/lib/i18n-loose";
import { addressSchema, fieldErrors, newPasswordSchema, PASSWORD_MIN, profileSchema } from "@/lib/validation/auth";
import { useAccountData, type AddressData, type ProfileData } from "./useAccountData";

const orNull = (v: string) => (v.trim() === "" ? null : v.trim());

function useFieldError() {
  const t = useTranslations("auth.validation");
  return (key?: string) => (key ? loose(t)(key, { min: PASSWORD_MIN }) : undefined);
}

export function ProfileView() {
  const t = useTranslations("profile");
  const { profile, addresses, status, reload } = useAccountData();

  if (status === "loading") return <p className="text-text-muted">{t("loading")}</p>;
  if (status === "error" || !profile) return <Alert>{t("loadError")}</Alert>;

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <PersonalForm profile={profile} onSaved={reload} />
      <div className="grid gap-8 lg:grid-cols-2">
        {(["billing", "shipping"] as const).map((kind) => (
          <AddressForm key={kind} kind={kind} clientId={profile.clientId} address={addresses.find((a) => a.kind === kind)} onSaved={reload} />
        ))}
      </div>
      <PasswordForm />
      <DeletionSection profile={profile} onChanged={reload} />
    </div>
  );
}

function PersonalForm({ profile, onSaved }: { profile: ProfileData; onSaved: () => Promise<void> }) {
  const t = useTranslations("profile");
  const tl = useTranslations("languages");
  const err = useFieldError();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const parsed = profileSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setLoading(true);
    const v = parsed.data;
    const p = await supabase
      .from("profiles")
      .update({ full_name: v.fullName, phone: orNull(v.phone), preferred_locale: v.preferredLocale })
      .eq("id", profile.userId);
    const c = await supabase
      .from("clients")
      .update({ company_name: v.companyName, tax_id: orNull(v.taxId), website: orNull(v.website), country: orNull(v.country) })
      .eq("id", profile.clientId);
    setLoading(false);
    if (p.error || c.error) return setMsg({ kind: "error", text: t("saveError") });
    setMsg({ kind: "success", text: t("saved") });
    await onSaved();
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4" key={profile.fullName + profile.companyName}>
        <h2 className="font-display text-xl font-semibold">{t("personal.title")}</h2>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="fullName" label={t("personal.fullName")} defaultValue={profile.fullName} error={err(errors.fullName)} />
          <Input label={t("personal.email")} value={profile.email} readOnly disabled />
          <Input name="phone" type="tel" label={t("personal.phone")} defaultValue={profile.phone} error={err(errors.phone)} />
          <Select name="preferredLocale" label={t("personal.language")} defaultValue={profile.preferredLocale}>
            {routing.locales.map((l) => (
              <option key={l} value={l}>
                {tl(`names.${l}`)}
              </option>
            ))}
          </Select>
        </div>
        <h3 className="pt-2 font-display text-lg font-semibold">{t("company.title")}</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="companyName" label={t("company.name")} defaultValue={profile.companyName} error={err(errors.companyName)} />
          <Input name="taxId" label={t("company.taxId")} defaultValue={profile.taxId} error={err(errors.taxId)} />
          <Input name="website" type="url" label={t("company.website")} defaultValue={profile.website} error={err(errors.website)} />
          <Input name="country" label={t("company.country")} defaultValue={profile.country} error={err(errors.country)} />
        </div>
        <Button type="submit" loading={loading}>
          {t("save")}
        </Button>
      </form>
    </Card>
  );
}

function AddressForm({
  kind, clientId, address, onSaved,
}: { kind: "billing" | "shipping"; clientId: string; address: AddressData | undefined; onSaved: () => Promise<void> }) {
  const t = useTranslations("profile.address");
  const err = useFieldError();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const parsed = addressSchema.safeParse(Object.fromEntries(new FormData(e.currentTarget)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setLoading(true);
    const v = parsed.data;
    const row = { line1: v.line1, line2: orNull(v.line2), city: v.city, postal_code: orNull(v.postalCode), country: v.country };
    const { error } = address
      ? await supabase.from("addresses").update(row).eq("id", address.id)
      : await supabase.from("addresses").insert({ ...row, client_id: clientId, kind, is_default: true });
    setLoading(false);
    if (error) return setMsg({ kind: "error", text: t("saveError") });
    setMsg({ kind: "success", text: t("saved") });
    await onSaved();
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid={`address-${kind}`} key={address?.id ?? "new"}>
        <h2 className="font-display text-xl font-semibold">{t(kind)}</h2>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <Input name="line1" label={t("line1")} defaultValue={address?.line1} error={err(errors.line1)} autoComplete={`${kind} address-line1`} />
        <Input name="line2" label={t("line2")} defaultValue={address?.line2} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="city" label={t("city")} defaultValue={address?.city} error={err(errors.city)} autoComplete={`${kind} address-level2`} />
          <Input name="postalCode" label={t("postalCode")} defaultValue={address?.postalCode} autoComplete={`${kind} postal-code`} />
        </div>
        <Input name="country" label={t("country")} defaultValue={address?.country} error={err(errors.country)} autoComplete={`${kind} country-name`} />
        <Button type="submit" variant="secondary" loading={loading}>
          {t("save")}
        </Button>
      </form>
    </Card>
  );
}

function PasswordForm() {
  const t = useTranslations("profile.password");
  const ta = useTranslations("auth.errors");
  const err = useFieldError();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setMsg(null);
    const parsed = newPasswordSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    setLoading(false);
    if (error) return setMsg({ kind: "error", text: loose(ta)(authErrorKey(error)) });
    form.reset();
    setMsg({ kind: "success", text: t("changed") });
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate className="space-y-4" data-testid="password-form">
        <h2 className="font-display text-xl font-semibold">{t("title")}</h2>
        {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="password" type="password" autoComplete="new-password" label={t("new")} error={err(errors.password)} />
          <Input name="confirm" type="password" autoComplete="new-password" label={t("confirm")} error={err(errors.confirm)} />
        </div>
        <Button type="submit" variant="secondary" loading={loading}>
          {t("submit")}
        </Button>
      </form>
    </Card>
  );
}

function DeletionSection({ profile, onChanged }: { profile: ProfileData; onChanged: () => Promise<void> }) {
  const t = useTranslations("profile.deletion");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const pending = profile.deletionRequestedAt !== null;

  async function set(value: string | null) {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setLoading(true);
    await supabase.from("profiles").update({ deletion_requested_at: value }).eq("id", profile.userId);
    setLoading(false);
    setConfirming(false);
    await onChanged();
  }

  return (
    <Card>
      <h2 className="font-display text-xl font-semibold">{t("title")}</h2>
      <p className="mt-1 text-text-muted">{t("body")}</p>
      {pending ? (
        <div className="mt-4 space-y-3">
          <Alert kind="info">{t("requested")}</Alert>
          <Button variant="secondary" loading={loading} onClick={() => void set(null)} data-testid="deletion-cancel">
            {t("cancel")}
          </Button>
        </div>
      ) : confirming ? (
        <div className="mt-4 space-y-3">
          <Alert>{t("confirmBody")}</Alert>
          <div className="flex gap-3">
            <Button variant="danger" loading={loading} onClick={() => void set(new Date().toISOString())} data-testid="deletion-confirm">
              {t("confirm")}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("back")}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="mt-4" variant="secondary" onClick={() => setConfirming(true)} data-testid="deletion-request">
          {t("request")}
        </Button>
      )}
    </Card>
  );
}
