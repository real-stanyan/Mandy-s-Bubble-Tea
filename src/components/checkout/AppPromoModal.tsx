"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Apple, Gift, Star, Zap } from "lucide-react";
import { APP_CONFIG } from "@/lib/app-config-values";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

// Post-payment App download prompt. Shows once per successful checkout
// (armed via sessionStorage right before the redirect, so a refresh or a
// revisit from order history never re-triggers it), then goes quiet for
// COOLDOWN_DAYS after any dismissal or store click.

const JUST_PAID_KEY = "mbt.justPaidOrderId";
const DISMISSED_AT_KEY = "mbt.appPromoDismissedAt";
const COOLDOWN_DAYS = 30;

/** Call right before redirecting to the confirmation page after a
 *  successful payment — arms the one-shot App promo modal there. */
export function markJustPaidForAppPromo(orderId: string) {
  try {
    sessionStorage.setItem(JUST_PAID_KEY, orderId);
  } catch {
    // Storage unavailable (private mode) — promo just won't show.
  }
}

const PERKS = [
  { icon: Zap, text: "Order ahead & skip the queue" },
  { icon: Star, text: "Track loyalty stars — 9 = free drink" },
  { icon: Gift, text: "App-only deals & flash promos" },
] as const;

// Read-and-clear the armed order id exactly once per page load. Module
// scope (not inside the effect) so React StrictMode's double effect
// invocation in dev sees the same answer both times instead of the second
// run finding the key already consumed.
let armedOrderId: string | null | undefined;
function consumeJustPaid(orderId: string): boolean {
  if (armedOrderId === undefined) {
    try {
      armedOrderId = sessionStorage.getItem(JUST_PAID_KEY);
      sessionStorage.removeItem(JUST_PAID_KEY);
    } catch {
      armedOrderId = null;
    }
  }
  return armedOrderId === orderId;
}

export function AppPromoModal({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!consumeJustPaid(orderId)) return;

    // Only an iOS App Store listing exists — don't pitch Android users a
    // store they can't use (mirrors the android: null gap in APP_CONFIG).
    if (/android/i.test(navigator.userAgent)) return;

    try {
      const dismissedAt = Number(localStorage.getItem(DISMISSED_AT_KEY) ?? 0);
      if (Date.now() - dismissedAt < COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
        return;
    } catch {
      // Can't read the cooldown — err on the side of not nagging.
      return;
    }

    // Let the confirmation hero land first, then pop.
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [orderId]);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    } catch {}
    setOpen(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      {/* the ui/dialog cn() is a naive join (no tailwind-merge), so width /
          padding / radius overrides need the `!` important suffix to beat
          DialogContent's own w-full p-5 rounded-card */}
      <DialogContent className="w-[calc(100vw-32px)]! max-w-[400px] gap-0 overflow-hidden rounded-[24px]! border-none p-0!">
        {/* Hero — background sampled from the artwork so they blend */}
        <div className="bg-[#FDE9C9]">
          <Image
            src="/app-promo-hero.webp"
            alt="Mandy's app and a happy bubble tea"
            width={800}
            height={380}
            className="block h-auto w-full"
          />
        </div>

        <div className="px-7 pb-7 pt-6 text-center">
          <DialogTitle className="text-center font-serif text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            Thanks for your order! 🧋
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-center text-[14.5px] leading-relaxed">
            Get the Mandy&apos;s app — your drinks, faster.
          </DialogDescription>

          <ul className="mx-auto mt-5 inline-block text-left">
            {PERKS.map(({ icon: Icon, text }) => (
              <li
                key={text}
                className="flex items-center gap-2.5 py-1 text-[14px] text-ink"
              >
                <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full bg-cream text-brand">
                  <Icon size={12} strokeWidth={2.5} />
                </span>
                {text}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex flex-col items-center gap-2.5">
            <a
              href={APP_CONFIG.ios.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={dismiss}
              className="inline-flex items-center gap-2.5 rounded-full bg-brand px-7 py-3 text-white shadow-[0_10px_18px_rgba(141,85,36,0.28)] transition hover:bg-brand-dark active:scale-[0.97]"
            >
              <Apple size={18} fill="currentColor" strokeWidth={0} />
              <span className="text-left leading-tight">
                <span className="block text-[9.5px] font-medium opacity-85">
                  Download on the
                </span>
                <span className="block text-[15px] font-bold">App Store</span>
              </span>
            </a>
            <button
              type="button"
              onClick={dismiss}
              className="px-3 py-1.5 text-[13px] text-ink3 transition hover:text-ink2"
            >
              Maybe later
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
