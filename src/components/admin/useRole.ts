"use client";

import { useEffect, useState } from "react";
import { decodeJwtPayload } from "@/lib/auth/guard";
import { loadBrowserSupabase } from "@/lib/db/browser-lazy";

export type StaffRole = "admin" | "sales";

/** The staff role of the signed-in user, for showing or hiding controls. The database enforces the real rule (RLS). */
export function useStaffRole(): StaffRole | null | "loading" {
  const [role, setRole] = useState<StaffRole | null | "loading">("loading");
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const sb = await loadBrowserSupabase();
      const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } };
      const claim = data.session ? decodeJwtPayload(data.session.access_token)?.user_role : null;
      if (!cancelled) setRole(claim === "admin" || claim === "sales" ? claim : null);
    })();
    return () => { cancelled = true; };
  }, []);
  return role;
}
