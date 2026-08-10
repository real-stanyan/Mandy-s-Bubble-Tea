"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { ApiProposal } from "@/lib/chat/proposal-to-cart";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Present on assistant turns that produced a card to confirm. */
  proposal?: ApiProposal;
  /** Menu links offered when the model was unreachable or unconfident. */
  suggestions?: { itemId: string; itemName: string; categorySlug: string }[];
  /** Set once the customer has pressed Add — the card locks after that.
   *  This is the only source of truth DrinkProposalCard trusts for its
   *  disabled state, so a stale render can never re-enable the button. */
  added?: boolean;
};

type ChatState = {
  messages: ChatMessage[];
  isOpen: boolean;
  isThinking: boolean;
  open: () => void;
  close: () => void;
  push: (message: ChatMessage) => void;
  setThinking: (value: boolean) => void;
  markAdded: (messageId: string) => void;
  clear: () => void;
};

function newId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return Math.random().toString(36).slice(2);
}

export function newMessageId(): string {
  return newId();
}

/** sessionStorage, not localStorage: a conversation about what to drink is
 *  worth keeping across a page navigation, not across a week. The cart is
 *  the thing that persists — this is just the conversation that filled it. */
export const useChat = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      isOpen: false,
      isThinking: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      push: (message) => set((s) => ({ messages: [...s.messages, message] })),
      setThinking: (value) => set({ isThinking: value }),
      markAdded: (messageId) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === messageId ? { ...m, added: true } : m,
          ),
        })),
      clear: () => set({ messages: [] }),
    }),
    {
      name: "mandy-chat",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ messages: s.messages }),
    },
  ),
);
