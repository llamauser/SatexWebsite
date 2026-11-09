"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { hasAuthCookie } from "@/lib/db/browser-lazy";

// The bell is only for signed-in users: its code is not part of the initial JavaScript of the (mostly guest) page views.
const NotificationsBell = dynamic(() => import("./NotificationsBell").then((m) => m.NotificationsBell), { ssr: false });

export function LazyBell() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => setSignedIn(hasAuthCookie()), []);
  return signedIn ? <NotificationsBell /> : null;
}
