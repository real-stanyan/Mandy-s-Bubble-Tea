"use client";

import { useRouter } from "next/navigation";
import { useCart, cartSubtotal, cartItemCount, lineTotal } from "@/store/cart";
import { useChat } from "@/store/chat";
import { formatPrice } from "@/lib/utils";
import { chatUiStrings } from "@/lib/chat/ui-strings";

/**
 * The "ready to pay" card. Reads the LIVE cart, not a snapshot from the
 * message that created it — the customer can keep chatting drinks into the
 * cart after this card appears, and a card quoting a stale subtotal next
 * to a different checkout total is worse than no card. Payment itself
 * stays on /checkout: rewards, delivery, surcharges, and Apple Pay all
 * live there, and a second payment surface would drift from the first.
 */
export function CheckoutCard() {
  const t = chatUiStrings();
  const router = useRouter();
  const close = useChat((s) => s.close);
  const lines = useCart((s) => s.lines);

  const subtotal = cartSubtotal(lines);
  const cupCount = cartItemCount(lines);

  if (lines.length === 0) {
    return (
      <div className="rounded-card border border-line bg-card p-3 text-sm text-ink3 shadow-card">
        {t.checkoutEmptyCart}
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-card p-3 shadow-card">
      <div className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <div key={l.id} className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-ink">
              {l.quantity > 1 ? `${l.quantity}× ` : ""}
              {l.itemName}
            </p>
            <p className="shrink-0 text-sm font-semibold text-ink">
              {formatPrice(lineTotal(l))}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
        <p className="text-xs text-ink3">{t.checkoutFeesNote(cupCount)}</p>
        <p className="text-sm font-bold text-brand">{formatPrice(subtotal)}</p>
      </div>

      <button
        type="button"
        onClick={() => {
          close();
          router.push("/checkout");
        }}
        className="mt-3 w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99]"
      >
        {t.goToCheckout} · {formatPrice(subtotal)}
      </button>
    </div>
  );
}
