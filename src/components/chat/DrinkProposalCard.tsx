"use client";

import Image from "next/image";
import { useCart } from "@/store/cart";
import { useChat } from "@/store/chat";
import { formatPrice } from "@/lib/utils";
import { proposalToCartLine, type ApiProposal } from "@/lib/chat/proposal-to-cart";
import { chatUiStrings } from "@/lib/chat/ui-strings";

// Styled to match CartLineRow (src/components/cart/CartDrawer.tsx) — same
// card the customer sees a moment later in the cart drawer, so nothing
// about it should look unfamiliar. Design tokens (bg-card, text-ink3,
// bg-brand, ...) route through CSS variables that Evening Mode remaps; a
// literal hex color here would just show the wrong shade after dark.

function ProposalRow({ proposal }: { proposal: ApiProposal }) {
  const modifierSummary = proposal.modifiers.map((m) => m.name).join(", ");
  return (
    <div className="flex gap-3">
      {proposal.imageUrl ? (
        <Image
          src={proposal.imageUrl}
          alt={proposal.itemName}
          width={64}
          height={64}
          className="h-16 w-16 shrink-0 rounded-tile object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-tile bg-cream text-lg">
          🧋
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{proposal.itemName}</p>
        <p className="mt-0.5 text-xs text-ink3">{proposal.variationName}</p>
        {modifierSummary ? (
          <p className="mt-0.5 text-xs text-ink3">{modifierSummary}</p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-brand">
          {formatPrice(BigInt(proposal.totalCents))}
        </p>
        {proposal.quantity > 1 ? (
          <p className="text-xs text-ink3">×{proposal.quantity}</p>
        ) : null}
      </div>
    </div>
  );
}

/** One card per assistant turn, however many drinks it proposed. A single
 *  confirm adds every line — the whole order is what the model described in
 *  its reply, and letting the customer take half of it silently is how "I
 *  ordered two drinks but paid for one" support threads start. Per-drink
 *  edits belong on the menu page, which the card links into via the cart
 *  drawer anyway. */
export function DrinkProposalCard({
  messageId,
  proposals,
  added,
}: {
  messageId: string;
  proposals: ApiProposal[];
  added?: boolean;
}) {
  const t = chatUiStrings();
  const addLine = useCart((s) => s.addLine);
  const markAdded = useChat((s) => s.markAdded);

  const cupCount = proposals.reduce((n, p) => n + p.quantity, 0);
  const orderTotal = proposals.reduce((sum, p) => sum + BigInt(p.totalCents), 0n);

  function handleAdd() {
    // Guard against the live store, not the `added` prop this closure was
    // created with — a real double-click can fire two click handlers
    // before React re-renders with the new `disabled` state, and the prop
    // would still read false for both. useChat.getState() is a synchronous
    // read of whatever the first click already committed, so the second
    // click sees `added: true` and bails before addLine runs twice.
    const already = useChat
      .getState()
      .messages.find((m) => m.id === messageId)?.added;
    if (already) return;
    markAdded(messageId);
    for (const proposal of proposals) {
      // openDrawer: false — the card's own "已加入" state is the feedback;
      // the cart drawer opening under the chat sheet just stacked two
      // half-visible headers on top of each other.
      addLine(proposalToCartLine(proposal), proposal.quantity, {
        openDrawer: false,
      });
    }
  }

  if (proposals.length === 0) return null;

  return (
    <div className="rounded-card border border-line bg-card p-3 shadow-card">
      <div className="flex flex-col gap-3">
        {proposals.map((p, i) => (
          <ProposalRow key={`${p.itemId}-${p.variationId}-${i}`} proposal={p} />
        ))}
      </div>

      {proposals.length > 1 ? (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
          <p className="text-xs text-ink3">{t.cupsTotal(cupCount)}</p>
          <p className="text-sm font-bold text-brand">{formatPrice(orderTotal)}</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleAdd}
        disabled={added}
        className="mt-3 w-full rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
      >
        {added
          ? t.addedToCart
          : proposals.length > 1
            ? t.addAllToCart(cupCount)
            : t.addToCart}
      </button>
    </div>
  );
}
