"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useChat } from "@/store/chat";
import { DrinkProposalCard } from "@/components/chat/DrinkProposalCard";

export function MessageList() {
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
    <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
      {messages.length === 0 ? (
        <p className="text-sm text-ink3">
          想喝点什么？描述一下口味就行，比如「不太甜的芋头奶茶，去冰」。
        </p>
      ) : null}

      {messages.map((m) => (
        <div key={m.id} className={m.role === "user" ? "self-end" : "self-start"}>
          <div
            className={
              m.role === "user"
                ? "max-w-[80%] rounded-2xl bg-ink px-3 py-2 text-sm text-white"
                : "max-w-[90%] rounded-2xl bg-cream px-3 py-2 text-sm text-ink"
            }
          >
            {m.content}
          </div>

          {m.proposal ? (
            <div className="mt-2 max-w-[90%]">
              <DrinkProposalCard
                messageId={m.id}
                proposal={m.proposal}
                added={m.added}
              />
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

      {isThinking ? <p className="text-sm text-ink3">正在想…</p> : null}
    </div>
  );
}
