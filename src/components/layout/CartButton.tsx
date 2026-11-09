"use client";

import { ShoppingBag } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { CART_CHANGED, CART_OPEN, cartCount, guestCount, mergeGuestCartIntoAccount } from "@/lib/cart/cart";
import { hasAuthCookie } from "@/lib/db/browser-lazy";

// The drawer (and everything it needs) is downloaded the first time the cart is opened.
const CartDrawer = dynamic(() => import("@/components/cart/CartDrawer"), { ssr: false });

export function CartButton() {
  const t = useTranslations("cart");
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => setCount(await cartCount()), []);
  useEffect(() => {
    setCount(guestCount()); // no network: guests only read localStorage
    // right after sign-in: the guest cart moves into the account cart
    if (hasAuthCookie()) void mergeGuestCartIntoAccount().then(refresh).catch(refresh);
    const onChange = () => void refresh();
    const onOpen = () => setOpen(true);
    window.addEventListener(CART_CHANGED, onChange);
    window.addEventListener(CART_OPEN, onOpen);
    return () => {
      window.removeEventListener(CART_CHANGED, onChange);
      window.removeEventListener(CART_OPEN, onOpen);
    };
  }, [refresh]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count > 0 ? `${t("open")} (${t("count", { count })})` : t("open")}
        aria-haspopup="dialog"
        className="relative flex size-10 items-center justify-center rounded-full text-text hover:bg-surface-muted"
        data-testid="cart-button"
      >
        <ShoppingBag className="size-5" aria-hidden />
        {count > 0 && (
          <span className="absolute end-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-white" data-testid="cart-count">
            {count}
          </span>
        )}
      </button>
      {open && <CartDrawer onClose={() => setOpen(false)} />}
    </>
  );
}
