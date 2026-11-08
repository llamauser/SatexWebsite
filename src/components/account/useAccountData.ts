"use client";

import { useCallback, useEffect, useState } from "react";
import { getBrowserSupabase } from "@/lib/db/browser";

export interface ProfileData {
  userId: string;
  email: string;
  fullName: string;
  phone: string;
  preferredLocale: "fr" | "en" | "ar";
  deletionRequestedAt: string | null;
  clientId: string;
  companyName: string;
  taxId: string;
  website: string;
  country: string;
}
export interface AddressData {
  id: string;
  kind: "billing" | "shipping";
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
}

/** Loads the signed-in user's profile, company and addresses through RLS (each user only sees their own rows). */
export function useAccountData() {
  const [state, setState] = useState<{ profile: ProfileData | null; addresses: AddressData[]; status: "loading" | "ready" | "error" }>({
    profile: null,
    addresses: [],
    status: "loading",
  });

  const reload = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return setState({ profile: null, addresses: [], status: "error" });
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setState({ profile: null, addresses: [], status: "error" });
    const { data: p, error } = await supabase
      .from("profiles")
      .select("full_name, phone, preferred_locale, deletion_requested_at, client_id")
      .eq("id", auth.user.id)
      .single();
    if (error || !p) return setState({ profile: null, addresses: [], status: "error" });
    const { data: c } = await supabase
      .from("clients")
      .select("company_name, tax_id, website, country")
      .eq("id", p.client_id)
      .single();
    const { data: a } = await supabase
      .from("addresses")
      .select("id, kind, line1, line2, city, postal_code, country")
      .eq("client_id", p.client_id);
    setState({
      status: "ready",
      profile: {
        userId: auth.user.id,
        email: auth.user.email ?? "",
        fullName: p.full_name ?? "",
        phone: p.phone ?? "",
        preferredLocale: p.preferred_locale,
        deletionRequestedAt: p.deletion_requested_at,
        clientId: p.client_id,
        companyName: c?.company_name ?? "",
        taxId: c?.tax_id ?? "",
        website: c?.website ?? "",
        country: c?.country ?? "",
      },
      addresses: (a ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        line1: r.line1,
        line2: r.line2 ?? "",
        city: r.city,
        postalCode: r.postal_code ?? "",
        country: r.country,
      })),
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload };
}
