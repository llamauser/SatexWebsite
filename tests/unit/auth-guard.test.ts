import { describe, expect, it } from "vitest";
import { authErrorKey } from "../../src/lib/auth/errors";
import { decodeJwtPayload, guard, needsSession, safeNext, splitLocale } from "../../src/lib/auth/guard";
import { addressSchema, fieldErrors, newPasswordSchema, profileSchema, signInSchema, signUpSchema } from "../../src/lib/validation/auth";

describe("splitLocale / needsSession", () => {
  it("splits the locale prefix", () => {
    expect(splitLocale("/fr")).toEqual({ locale: "fr", rest: "/" });
    expect(splitLocale("/ar/account/profile")).toEqual({ locale: "ar", rest: "/account/profile" });
    expect(splitLocale("/en/admin/")).toEqual({ locale: "en", rest: "/admin" });
    expect(splitLocale("/de/account")).toBeNull();
    expect(splitLocale("/account")).toBeNull();
  });
  it("only looks at the session where it matters", () => {
    for (const p of ["/account", "/account/orders", "/admin", "/admin/fabrics", "/auth/sign-in", "/auth/sign-up"]) expect(needsSession(p)).toBe(true);
    for (const p of ["/", "/catalog", "/match", "/auth/callback", "/auth/reset", "/accounting", "/administrator"]) expect(needsSession(p)).toBe(false);
  });
});

describe("guard", () => {
  it.each([
    ["/account", null, "sign-in"],
    ["/account/profile", "client", "allow"],
    ["/account", "admin", "allow"],
    ["/admin", null, "sign-in"],
    ["/admin", "client", "forbidden"],
    ["/admin/fabrics", "client", "forbidden"],
    ["/admin", "sales", "allow"],
    ["/admin/settings", "admin", "allow"],
    ["/admin/settings", "sales", "forbidden"],
    ["/admin/match-logs", "sales", "forbidden"],
    ["/admin/match-logs", "admin", "allow"],
    ["/admin/users", "sales", "forbidden"],
    ["/admin/quotes", "sales", "allow"],
    ["/auth/sign-in", null, "allow"],
    ["/auth/sign-in", "client", "to-account"],
    ["/auth/sign-up", "sales", "to-account"],
    ["/auth/reset", "client", "allow"],
    ["/auth/callback", null, "allow"],
    ["/catalog", null, "allow"],
    ["/", "client", "allow"],
  ] as const)("%s as %s -> %s", (path, role, expected) => {
    expect(guard(path, role)).toBe(expected);
  });
});

describe("safeNext (no open redirects)", () => {
  const fb = "/fr/account";
  it("accepts locale-prefixed internal paths", () => {
    expect(safeNext("/fr/account/profile", fb)).toBe("/fr/account/profile");
    expect(safeNext("/ar/auth/reset?step=new", fb)).toBe("/ar/auth/reset?step=new");
  });
  it.each([null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "/fr//evil.example", "/xx/account", "javascript:alert(1)", "/fr/a\nb", "account"])(
    "rejects %j",
    (value) => expect(safeNext(value as string | null | undefined, fb)).toBe(fb),
  );
});

describe("decodeJwtPayload", () => {
  it("reads the payload without verifying", () => {
    const payload = { sub: "u1", user_role: "sales" };
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    expect(decodeJwtPayload(`x.${b64}.y`)).toEqual(payload);
    expect(decodeJwtPayload("garbage")).toBeNull();
  });
});

describe("authErrorKey", () => {
  it("maps supabase error codes to i18n keys without revealing accounts", () => {
    expect(authErrorKey({ code: "invalid_credentials" })).toBe("invalidCredentials");
    expect(authErrorKey({ code: "email_not_confirmed" })).toBe("emailNotConfirmed");
    expect(authErrorKey({ code: "over_email_send_rate_limit" })).toBe("rateLimit");
    expect(authErrorKey({ status: 429 })).toBe("rateLimit");
    expect(authErrorKey({ code: "user_already_exists" })).toBe("generic");
    expect(authErrorKey({ message: "Failed to fetch" })).toBe("network");
    expect(authErrorKey(null)).toBe("generic");
  });
});

describe("validation schemas", () => {
  const goodSignUp = {
    fullName: "Nour Haddad", company: "Atelier Nour", email: "nour@example.com", password: "a-long-password",
    phone: "+33 1 23 45 67 89", preferredLocale: "fr", acceptTerms: true,
  };
  it("sign-up accepts a valid form and rejects each bad field with a message key", () => {
    expect(signUpSchema.safeParse(goodSignUp).success).toBe(true);
    const bad = signUpSchema.safeParse({ ...goodSignUp, fullName: "N", company: "", email: "nope", password: "short", phone: "abc", acceptTerms: false });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(fieldErrors(bad.error)).toEqual({
        fullName: "nameMin", company: "companyMin", email: "email", password: "passwordMin", phone: "phone", acceptTerms: "termsRequired",
      });
    }
    expect(signUpSchema.safeParse({ ...goodSignUp, phone: "" }).success).toBe(true); // phone is optional
    expect(signUpSchema.safeParse({ ...goodSignUp, preferredLocale: "de" }).success).toBe(false);
  });
  it("sign-in", () => {
    expect(signInSchema.safeParse({ email: " a@b.co ", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "", password: "" }).success).toBe(false);
  });
  it("new password needs 10 chars and a matching confirmation", () => {
    expect(newPasswordSchema.safeParse({ password: "0123456789", confirm: "0123456789" }).success).toBe(true);
    const r = newPasswordSchema.safeParse({ password: "0123456789", confirm: "other" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error)).toEqual({ confirm: "passwordMatch" });
  });
  it("profile and address", () => {
    const profile = { fullName: "Nour", phone: "", preferredLocale: "ar", companyName: "Nour Co", taxId: "", website: "https://nour.example.com", country: "" };
    expect(profileSchema.safeParse(profile).success).toBe(true);
    expect(profileSchema.safeParse({ ...profile, website: "javascript:alert(1)" }).success).toBe(false);
    expect(addressSchema.safeParse({ line1: "1 rue X", line2: "", city: "Lyon", postalCode: "", country: "France" }).success).toBe(true);
    expect(addressSchema.safeParse({ line1: "", line2: "", city: "", postalCode: "", country: "" }).success).toBe(false);
  });
});
