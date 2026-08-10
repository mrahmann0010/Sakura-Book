"use client";

import { useSyncExternalStore } from "react";

/**
 * False on the server and through the client's first render, true after mount.
 *
 * The one honest way to gate browser-only state: the first client render must
 * produce exactly the markup the server sent, or React replaces the tree and
 * logs a hydration mismatch. Anything read from localStorage — the cart —
 * therefore waits for this, rather than for a flag whose timing differs
 * between the server pass and the browser's.
 *
 * `useSyncExternalStore` rather than state-in-an-effect: it is React's own way
 * of saying "the server snapshot is false, the client snapshot is true", with
 * no extra render scheduled and nothing for the compiler to flag.
 */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
