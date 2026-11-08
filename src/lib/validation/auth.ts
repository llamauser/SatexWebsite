import { z } from "zod";

/** Error messages are i18n keys under `auth.validation.*` (the form translates them). */
export const PASSWORD_MIN = 10;

const email = z.string().trim().min(1, "required").pipe(z.email("email"));
const password = z.string().min(PASSWORD_MIN, "passwordMin");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "required"),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2, "nameMin").max(120, "tooLong"),
  company: z.string().trim().min(2, "companyMin").max(160, "tooLong"),
  email,
  password,
  phone: z
    .string()
    .trim()
    .max(30, "phone")
    .refine((v) => v === "" || /^\+?[0-9 ().-]{6,30}$/.test(v), "phone"),
  preferredLocale: z.enum(["fr", "en", "ar"]),
  acceptTerms: z.literal(true, { error: "termsRequired" }),
});

export const resetRequestSchema = z.object({ email });

export const newPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "passwordMatch" });

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, "nameMin").max(120, "tooLong"),
  phone: z.string().trim().max(30, "phone").refine((v) => v === "" || /^\+?[0-9 ().-]{6,30}$/.test(v), "phone"),
  preferredLocale: z.enum(["fr", "en", "ar"]),
  companyName: z.string().trim().min(2, "companyMin").max(160, "tooLong"),
  taxId: z.string().trim().max(60, "tooLong"),
  website: z
    .string()
    .trim()
    .max(200, "tooLong")
    .refine((v) => v === "" || /^https?:\/\/[^\s]+\.[^\s]+$/.test(v), "url"),
  country: z.string().trim().max(80, "tooLong"),
});

export const addressSchema = z.object({
  line1: z.string().trim().min(2, "required").max(200, "tooLong"),
  line2: z.string().trim().max(200, "tooLong"),
  city: z.string().trim().min(1, "required").max(100, "tooLong"),
  postalCode: z.string().trim().max(20, "tooLong"),
  country: z.string().trim().min(2, "required").max(80, "tooLong"),
});

/** Flatten a zod error into { field: messageKey } (first issue per field). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
