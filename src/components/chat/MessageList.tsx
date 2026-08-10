"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useChat } from "@/store/chat";
import { DrinkProposalCard } from "@/components/chat/DrinkProposalCard";
import { CheckoutCard } from "@/components/chat/CheckoutCard";
import { chatUiStrings } from "@/lib/chat/ui-strings";

export function MessageList() {
  const t = chatUiStrings();
  const messages = useChat((s) => s.messages);
  const isThinking = useChat((s) => s.isThinking);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The proposal card's 加入购物车 button is the feature's only conversion
  // action. This sheet is h-[70vh]; by the second or third exchange the
  // card sits below the fold with nothing telling the customer to scroll
  // down to it. Runs on every message-list change (new message, or the
  // "正在想…" line appearing/disappearing) so the latest content — card or
  // not — always ends up in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [messages, isThinking]);

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-4">
      {messages.length === 0 ? (
        <p className="text-sm text-ink3">
          {t.emptyStateHint}
        </p>
      ) : null}

      {messages.map((m) => (
        // w-full + items-* instead of self-* shrink-to-fit: a shrink-to-fit
        // wrapper gives the proposal card no definite width, so its
        // truncate/flex internals never engage and the price column walks
        // off the right edge on narrow screens.
        <div
          key={m.id}
          className={
            m.role === "user"
              ? "flex w-full flex-col items-end"
              : "flex w-full flex-col items-start"
          }
        >
          <div
            className={
              m.role === "user"
                ? "max-w-[80%] break-words rounded-2xl bg-ink px-3 py-2 text-sm text-white"
                : "max-w-[90%] break-words rounded-2xl bg-cream px-3 py-2 text-sm text-ink"
            }
          >
            {m.content}
          </div>

          {(() => {
            // New turns carry `proposals`; a session persisted before the
            // multi-drink release may still hold single-`proposal` turns.
            const proposals = m.proposals ?? (m.proposal ? [m.proposal] : []);
            return proposals.length > 0 ? (
              <div className="mt-2 w-full max-w-[90%]">
                <DrinkProposalCard
                  messageId={m.id}
                  proposals={proposals}
                  added={m.added}
                />
              </div>
            ) : null;
          })()}

          {m.checkoutCard ? (
            <div className="mt-2 w-full max-w-[90%]">
              <CheckoutCard />
            </div>
          ) : null}

          {m.suggestions?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {m.suggestions.map((s) => (
                <Link
                  key={s.itemId}
                  href={`/menu/${s.categorySlug}`}
                  className="rounded-full border border-line px-3 py-1 text-sm text-ink transition hover:bg-paper"
                >
                  {s.itemName}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ))}

      {isThinking ? <p className="text-sm text-ink3">{t.thinking}</p> : null}
    </div>
  );
}
