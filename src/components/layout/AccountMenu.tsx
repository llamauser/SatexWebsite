"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { buttonStyles } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { decodeJwtPayload, isStaff } from "@/lib/auth/guard";
import { hasAuthCookie, loadBrowserSupabase } from "@/lib/db/browser-lazy";

interface SessionUser {
  email: string;
  name: string;
  role: string;
}

/** Sign in / account menu. Client-side so the (static) pages never depend on cookies. */
export function AccountMenu() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined); // undefined = still loading
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Guests (no auth cookie) never load the Supabase client: the page stays light.
    if (!hasAuthCookie()) {
      setUser(null);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const toUser = (session: { access_token: string; user: { email?: string; user_metadata?: Record<string, unknown> } } | null) =>
      session
        ? {
            email: session.user.email ?? "",
            name: String(session.user.user_metadata?.full_name ?? session.user.email ?? ""),
            role: String(decodeJwtPayload(session.access_token)?.user_role ?? "client"),
          }
        : null;
    void loadBrowserSupabase().then(async (supabase) => {
      if (cancelled) return;
      if (!supabase) return setUser(null);
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setUser(toUser(data.session));
      const sub = supabase.auth.onAuthStateChange((_event, session) => setUser(toUser(session)));
      unsubscribe = () => sub.data.subscription.unsubscribe();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    await (await loadBrowserSupabase())?.auth.signOut();
    window.location.assign(`/${locale}`);
  }

  if (user === undefined) return <span className="block h-9 w-24" aria-hidden />;

  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Link href="/auth/sign-in" className={buttonStyles({ variant: "ghost", size: "sm" })}>
          {t("signIn")}
        </Link>
        <Link
          href="/auth/sign-up"
          className={`${buttonStyles({ size: "sm" })} max-sm:hidden`}
          style={{ background: "var(--primary-gradient)" }}
        >
          {t("createAccount")}
        </Link>
      </div>
    );
  }

  const initial = (user.name || user.email).trim().charAt(0).toUpperCase();
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("account")}
        data-testid="account-menu-button"
        onClick={() => setOpen((v) => !v)}
        className="flex size-10 items-center justify-center rounded-full bg-text font-semibold text-white"
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 z-40 mt-2 w-64 rounded-md border border-border bg-surface p-2 shadow-pop"
        >
          <div className="border-b border-border px-3 pb-2 pt-1">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-text-muted" data-testid="account-email">
              {user.email}
            </p>
          </div>
          <Link role="menuitem" href="/account" className="block rounded-sm px-3 py-2 text-sm hover:bg-surface-muted" onClick={() => setOpen(false)}>
            {t("account")}
          </Link>
          <Link role="menuitem" href="/account/profile" className="block rounded-sm px-3 py-2 text-sm hover:bg-surface-muted" onClick={() => setOpen(false)}>
            {t("profile")}
          </Link>
          {isStaff(user.role) && (
            <Link role="menuitem" href="/admin" className="block rounded-sm px-3 py-2 text-sm hover:bg-surface-muted" onClick={() => setOpen(false)}>
              {t("admin")}
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className="block w-full rounded-sm px-3 py-2 text-start text-sm hover:bg-surface-muted"
          >
            {t("signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
