"use client";

import { useState } from "react";
import { useChat, newMessageId, type ChatMessage } from "@/store/chat";
import { MessageList } from "@/components/chat/MessageList";
import { chatUiStrings } from "@/lib/chat/ui-strings";

// Mirrors /api/chat's own limits (src/app/api/chat/route.ts: MAX_HISTORY,
// MAX_CHARS) so the client trims itself down to what the route will accept
// instead of drawing an avoidable 400.
const MAX_HISTORY = 20;
const MAX_CHARS = 500;

export function ChatDrawer() {
  const t = chatUiStrings();
  const [draft, setDraft] = useState("");
  const isOpen = useChat((s) => s.isOpen);
  const close = useChat((s) => s.close);
  const messages = useChat((s) => s.messages);
  const push = useChat((s) => s.push);
  const setThinking = useChat((s) => s.setThinking);
  const isThinking = useChat((s) => s.isThinking);

  if (!isOpen) return null;

  async function send() {
    const text = draft.trim().slice(0, MAX_CHARS);
    // Read the live store, not the `isThinking` this render closure was
    // built with: setThinking(true) below commits to zustand synchronously,
    // but a second Enter/click fired before React re-renders would still
    // see this closure's stale `false`. useChat.getState() sees whatever
    // the first call already committed, so a fast double-submit can't slip
    // a second POST through (same shape as DrinkProposalCard's addLine
    // guard).
    if (!text || useChat.getState().isThinking) return;
    setDraft("");
    push({ id: newMessageId(), role: "user", content: text });
    setThinking(true);

    // Only role + content cross the wire — proposals and suggestions are
    // client-side render state the model neither sent nor needs back.
    // Capped to the route's own limits (20 messages, 500 chars each) so a
    // long-running conversation never triggers a 400 it could have
    // avoided by trimming itself first.
    const history = [...messages, { role: "user" as const, content: text }]
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (res.status === 429) {
        push({
          id: newMessageId(),
          role: "assistant",
          content: t.rateLimited,
        });
        return;
      }
      if (!res.ok) throw new Error(`chat responded ${res.status}`);

      const body = await res.json();
      const reply: ChatMessage = {
        id: newMessageId(),
        role: "assistant",
        content: body.reply,
        proposals: body.proposals?.length
          ? body.proposals
          : body.proposal
            ? [body.proposal]
            : undefined,
        suggestions: body.suggestions?.length ? body.suggestions : undefined,
        // A card in the conversation, not an instant redirect: the customer
        // reviews what's in the cart and taps 去结账 themselves — being
        // yanked to a payment page mid-sentence reads as a malfunction.
        checkoutCard: body.action === "checkout" || undefined,
      };
      push(reply);
    } catch {
      push({
        id: newMessageId(),
        role: "assistant",
        content: t.networkError,
      });
    } finally {
      setThinking(false);
    }
  }

  return (
    // dvh, not vh: vh ignores the iOS keyboard/toolbar, so the drawer's
    // bottom row could sit under browser chrome; dvh tracks the dynamic
    // viewport and keeps the input row visible when the keyboard is up.
    <div className="fixed inset-x-0 bottom-0 z-50 flex h-[70dvh] flex-col rounded-t-3xl bg-card shadow-card sm:inset-x-auto sm:right-6 sm:bottom-6 sm:h-[32rem] sm:w-96 sm:rounded-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="font-serif text-[15px] font-semibold text-ink">{t.drawerTitle}</p>
        <button
          type="button"
          onClick={close}
          aria-label={t.closeAria}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink3 transition hover:bg-paper hover:text-ink"
        >
          ✕
        </button>
      </div>

      <MessageList />

      <div className="flex gap-2 border-t border-line p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Every string in this UI is Chinese, and Chinese input methods
            // use Enter to commit a pinyin candidate — without the
            // isComposing check, confirming a candidate mid-sentence would
            // send whatever partial buffer was on screen at that instant.
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void send();
          }}
          maxLength={MAX_CHARS}
          placeholder={t.inputPlaceholder}
          // text-base, not text-sm: iOS Safari zooms the whole page when a
          // focused input's font is under 16px, which shoved the send
          // button off-screen the moment the keyboard opened (Stan's
          // screenshots, 2026-08-10). 16px is the documented no-zoom floor.
          className="flex-1 rounded-full border border-line bg-paper px-4 py-2 text-base text-ink outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={isThinking || draft.trim().length === 0}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.send}
        </button>
      </div>
    </div>
  );
}
