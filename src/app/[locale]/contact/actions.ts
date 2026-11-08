"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createServiceSupabase } from "@/lib/db/service";
import { fieldErrors } from "@/lib/validation/auth";
import { contactSchema } from "@/lib/validation/contact";

export interface ContactState {
  status: "idle" | "success" | "error";
  error?: "validation" | "rate_limited" | "server";
  fieldErrors?: Record<string, string>;
}

/** Hash of the caller's IP (never stored raw): the rate limit key. */
function ipKey(forwardedFor: string | null): string {
  const ip = forwardedFor?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`${process.env.IP_HASH_SALT ?? "satex"}:${ip}`).digest("hex").slice(0, 32);
}

export async function submitContact(_prev: ContactState, formData: FormData): Promise<ContactState> {
  // honeypot: real visitors never see or fill this field; bots do. Pretend it worked.
  if (String(formData.get("website") ?? "").trim() !== "") return { status: "success" };

  const raw = Object.fromEntries(formData);
  const parsed = contactSchema.safeParse({ ...raw, consent: raw.consent === "on" });
  if (!parsed.success) return { status: "error", error: "validation", fieldErrors: fieldErrors(parsed.error) };

  const v = parsed.data;
  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase.rpc("submit_contact_message", {
      p_name: v.name, p_company: v.company, p_email: v.email, p_phone: v.phone, p_message: v.message,
      p_locale: v.locale, p_ip_key: ipKey((await headers()).get("x-forwarded-for")),
    });
    if (error) return { status: "error", error: /rate_limited/.test(error.message) ? "rate_limited" : "server" };
    return { status: "success" };
  } catch {
    return { status: "error", error: "server" };
  }
}
