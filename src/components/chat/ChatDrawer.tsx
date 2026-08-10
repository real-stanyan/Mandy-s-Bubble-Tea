"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useChat, newMessageId, type ChatMessage } from "@/store/chat";
import { MessageList } from "@/components/chat/MessageList";

// Mirrors /api/chat's own limits (src/app/api/chat/route.ts: MAX_HISTORY,
// MAX_CHARS) so the client trims itself down to what the route will accept
// instead of drawing an avoidable 400.
const MAX_HISTORY = 20;
const MAX_CHARS = 500;

export function ChatDrawer() {
  const router = useRouter();
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
          content: "聊天有点忙，过一会儿再试试，或者直接看菜单。",
        });
        return;
      }
      if (!res.ok) throw new Error(`chat responded ${res.status}`);

      const body = await res.json();
      const reply: ChatMessage = {
        id: newMessageId(),
        role: "assistant",
        content: body.reply,
        proposal: body.proposal ?? undefined,
        suggestions: body.suggestions?.length ? body.suggestions : undefined,
      };
      push(reply);

      if (body.action === "checkout") {
        close();
        router.push("/checkout");
      }
    } catch {
      push({
        id: newMessageId(),
        role: "assistant",
        content: "网络好像出了点问题，再发一次试试？",
      });
    } finally {
      setThinking(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex h-[70vh] flex-col rounded-t-3xl bg-card shadow-card sm:inset-x-auto sm:right-6 sm:bottom-6 sm:h-[32rem] sm:w-96 sm:rounded-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="font-serif text-[15px] font-semibold text-ink">点单助手</p>
        <button
          type="button"
          onClick={close}
          aria-label="关闭"
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
          placeholder="想喝点什么？"
          className="flex-1 rounded-full border border-line bg-paper px-4 py-2 text-sm text-ink outline-none focus:border-brand"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={isThinking || draft.trim().length === 0}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </div>
  );
}
