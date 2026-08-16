"use client";

import Link from "next/link";
import { useChat } from "@/store/chat";
import { chatUiStrings } from "@/lib/chat/ui-strings";

/** Rendered under Mandy's reply when a signed-out customer asked about
 *  their order: the words explain (in the customer's language, via the
 *  model), this card acts. One tap to /account, drawer closed on the way
 *  — same conversion shape as PromotionCard's CTA.
 *
 *  Card chrome (title/body/button) comes from the browser-language string
 *  pack like every other fixed chat string; the server only sets a boolean.
 */
export function SignInCard() {
  const t = chatUiStrings();
  const close = useChat((s) => s.close);

  return (
    <div className="rounded-card border border-line bg-cream p-3 shadow-card">
      <p className="text-sm font-bold text-ink">{t.signInTitle}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink2">{t.signInBody}</p>
      <Link
        href="/account"
        onClick={close}
        className="mt-3 block rounded-full bg-brand px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]"
      >
        {t.signInCta}
      </Link>
    </div>
  );
}
