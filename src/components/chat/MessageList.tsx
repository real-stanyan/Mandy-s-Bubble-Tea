"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useChat } from "@/store/chat";
import { DrinkProposalCard } from "@/components/chat/DrinkProposalCard";
import { CheckoutCard } from "@/components/chat/CheckoutCard";
import { chatUiStrings } from "@/lib/chat/ui-strings";

/** One page-wide audio element — starting a clip stops the previous one,
 *  because two Mandys talking over each other is worse than none. */
let sharedAudio: HTMLAudioElement | null = null;

/** Speaker button under an assistant bubble: fetches (cached) TTS and
 *  plays it. Every failure path is silent — the text is already on
 *  screen, so "no audio" must never look like an error. */
function SpeakButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");

  async function speak() {
    if (state !== "idle") {
      sharedAudio?.pause();
      setState("idle");
      return;
    }
    setState("loading");
    try {
      const res = await fetch("/api/chat/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { url } = (await res.json()) as { url?: string };
      if (!url) throw new Error("no url");
      sharedAudio?.pause();
      const audio = new Audio(url);
      sharedAudio = audio;
      audio.onended = () => setState("idle");
      audio.onerror = () => setState("idle");
      await audio.play();
      setState("playing");
    } catch {
      setState("idle");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void speak()}
      aria-label={label}
      className="mt-1 flex h-7 w-7 items-center justify-center rounded-full text-ink3 transition hover:bg-paper hover:text-ink"
    >
      {state === "loading" ? (
        <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink3 border-t-transparent" />
      ) : state === "playing" ? (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
          <path
            d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}

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

          {m.role === "assistant" && m.content ? (
            <SpeakButton text={m.content} label={t.playAria} />
          ) : null}

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
