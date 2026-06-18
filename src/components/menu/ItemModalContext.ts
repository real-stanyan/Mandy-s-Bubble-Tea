"use client";

import { createContext, useContext } from "react";

// Lets the item-detail body (ItemOrderForm, a client component nested inside the
// server-rendered ItemDetailContent) ask the surrounding modal to dismiss after
// a successful add-to-cart. The full-route page renders the same body without a
// provider, so the value is null there and add-to-cart simply stays put.
export const ItemModalCloseContext = createContext<(() => void) | null>(null);

export function useItemModalClose(): (() => void) | null {
  return useContext(ItemModalCloseContext);
}
