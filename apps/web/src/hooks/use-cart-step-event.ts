"use client";

import { useEffect, useRef } from "react";

import { trackBeginCheckout, trackViewCart } from "@/lib/analytics";

import type { UseCart } from "./use-cart";

/**
 * Sends `view_cart` or `begin_checkout` once the cart is priced.
 *
 * Both pages need the same three conditions and the same guard, so they share
 * one hook rather than two effects that would drift:
 *
 * - Wait for the quote. `lines` is empty until the server answers, and an
 *   event sent before then carries no items — GA4 records the step as reached
 *   with nothing in the basket, which is indistinguishable in the funnel from
 *   a real one and quietly wrong.
 * - Send once per visit to the page, not once per quote. Every quantity edit
 *   requotes, and a shopper who nudges the stepper three times has not viewed
 *   their cart four times.
 * - Send nothing for an empty cart, which is not a funnel step at all.
 */
export function useCartStepEvent(step: "view_cart" | "begin_checkout", cart: UseCart) {
  const sent = useRef(false);
  const ready = cart.hydrated && !cart.quoting && cart.lines.length > 0;

  useEffect(() => {
    if (!ready || sent.current) return;
    sent.current = true;
    (step === "view_cart" ? trackViewCart : trackBeginCheckout)(cart);
    /* `cart` is a fresh object on every requote, so this effect re-runs often;
       the ref is what makes all but the first run a no-op. Listing it anyway
       keeps the dependency array honest rather than silenced. */
  }, [ready, step, cart]);
}
