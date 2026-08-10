"use client";

import { useChat } from "@/store/chat";
import { chatUiStrings } from "@/lib/chat/ui-strings";

/** A speech bubble with three boba pearls — the one-glance version of
 *  "talk to us about drinks". Inline SVG over an emoji: ☕ was a coffee
 *  cup on a bubble-tea site, rendered differently on every platform, and
 *  couldn't inherit the button's text color. */
function BobaChatIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 3.2c-5 0-9 3.4-9 7.6 0 2.1 1 4 2.6 5.4-.2 1.1-.7 2.2-1.6 3 1.5.1 3-.4 4.2-1.2 1.2.4 2.4.6 3.8.6 5 0 9-3.4 9-7.6s-4-7.8-9-7.8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="8.4" cy="11" r="1.3" fill="currentColor" />
      <circle cx="12" cy="11" r="1.3" fill="currentColor" />
      <circle cx="15.6" cy="11" r="1.3" fill="currentColor" />
    </svg>
  );
}

// Offset clears SiteTabBar (fixed, bottom-0, z-40, lg:hidden — see
// src/components/layout/SiteTabBar.tsx): bottom-6 right-6 alone would sit
// the bubble directly on top of the Account tab on mobile. bottom-24
// matches the pb-24 pages already use to clear the same tab bar; the tab
// bar disappears at lg so the bubble drops back to the plain corner offset.
//
// Compact circle on mobile (screen edges are precious), a labelled pill on
// lg+ — a bare glyph never told desktop visitors what the button does.
export function ChatBubble() {
  const t = chatUiStrings();
  const isOpen = useChat((s) => s.isOpen);
  const open = useChat((s) => s.open);

  if (isOpen) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label={t.launcherAria}
      className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-primary-cta transition hover:bg-brand-dark active:scale-95 lg:bottom-6 lg:right-6 lg:h-13 lg:w-auto lg:gap-2 lg:px-5"
    >
      <BobaChatIcon className="h-7 w-7 lg:h-6 lg:w-6" />
      <span className="hidden text-sm font-semibold lg:inline">{t.launcherLabel}</span>
    </button>
  );
}
