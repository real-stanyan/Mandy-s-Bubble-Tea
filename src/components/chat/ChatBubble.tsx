"use client";

import { useEffect, useState } from "react";
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

/** Session flag, not localStorage: the teaser should greet a returning
 *  visitor next week, but not on every page navigation today. */
const TEASER_SEEN_KEY = "mandy-chat-teaser-seen";

function teaserAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(TEASER_SEEN_KEY) === "1";
  } catch {
    return true; // storage blocked → never nag, never crash
  }
}

function markTeaserSeen(): void {
  try {
    sessionStorage.setItem(TEASER_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

// Offset clears SiteTabBar (fixed, bottom-0, z-40, lg:hidden — see
// src/components/layout/SiteTabBar.tsx): bottom-6 right-6 alone would sit
// the bubble directly on top of the Account tab on mobile. bottom-24
// matches the pb-24 pages already use to clear the same tab bar; the tab
// bar disappears at lg so the bubble drops back to the plain corner offset.
//
// Compact circle on mobile (screen edges are precious), a labelled pill on
// lg+. Discoverability beyond the glyph comes from two things: an AI badge
// pinned to the launcher, and a one-per-session teaser bubble that
// introduces the assistant a beat after the page settles — a bare icon
// never told anyone there's a robot behind it.
export function ChatBubble() {
  const t = chatUiStrings();
  const isOpen = useChat((s) => s.isOpen);
  const open = useChat((s) => s.open);
  const [showTeaser, setShowTeaser] = useState(false);

  useEffect(() => {
    if (teaserAlreadySeen()) return;
    // A beat after load, not instantly — a popup racing the page paint
    // reads as an ad and gets reflex-closed.
    const timer = setTimeout(() => {
      if (!useChat.getState().isOpen && !teaserAlreadySeen()) {
        setShowTeaser(true);
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, []);

  function dismissTeaser() {
    markTeaserSeen();
    setShowTeaser(false);
  }

  function openChat() {
    dismissTeaser();
    open();
  }

  if (isOpen) return null;

  return (
    <>
      {showTeaser ? (
        <div className="fixed bottom-[10.5rem] right-4 z-40 w-64 lg:bottom-[5.5rem] lg:right-6">
          <div className="relative rounded-card border border-line bg-card p-3 pr-8 shadow-card">
            <button
              type="button"
              onClick={openChat}
              className="block text-left text-[13px] leading-snug text-ink"
            >
              {t.teaser}
            </button>
            <button
              type="button"
              onClick={dismissTeaser}
              aria-label={t.teaserDismissAria}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-ink3 transition hover:bg-paper hover:text-ink"
            >
              ✕
            </button>
            {/* Tail pointing down at the launcher. */}
            <div className="absolute -bottom-[7px] right-7 h-3.5 w-3.5 rotate-45 border-b border-r border-line bg-card" />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={openChat}
        aria-label={t.launcherAria}
        className="fixed bottom-24 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-primary-cta transition hover:bg-brand-dark active:scale-95 lg:bottom-6 lg:right-6 lg:h-13 lg:w-auto lg:gap-2 lg:px-5"
      >
        <BobaChatIcon className="h-7 w-7 lg:h-6 lg:w-6" />
        <span className="hidden text-sm font-semibold lg:inline">{t.launcherLabel}</span>
        {/* AI badge — the circle alone reads as "contact us"; this says
            there's an assistant behind it. Hidden on lg where the pill
            already spells it out. */}
        <span className="absolute -top-1 -right-1 rounded-full bg-ink px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-cream lg:hidden">
          AI
        </span>
      </button>
    </>
  );
}
