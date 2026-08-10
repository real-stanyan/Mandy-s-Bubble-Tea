"use client";

import { useChat } from "@/store/chat";

// Offset clears SiteTabBar (fixed, bottom-0, z-40, lg:hidden — see
// src/components/layout/SiteTabBar.tsx): bottom-6 right-6 alone would sit
// the bubble directly on top of the Account tab on mobile. bottom-24
// matches the pb-24 pages already use to clear the same tab bar; the tab
// bar disappears at lg so the bubble drops back to the plain corner offset.
export function ChatBubble() {
  const isOpen = useChat((s) => s.isOpen);
  const open = useChat((s) => s.open);

  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label="打开点单助手"
      className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-2xl text-white shadow-primary-cta transition hover:bg-brand-dark active:scale-95 lg:bottom-6 lg:right-6"
    >
      ☕
    </button>
  );
}
