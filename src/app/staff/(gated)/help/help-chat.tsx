"use client";
import { useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string; performed?: string[] };

// Openers, because the hardest part of a blank chat box is the first sentence,
// and a staff member mid-service will not compose one. These are the four
// things that actually go wrong.
const OPENERS = [
  "A customer's card keeps getting declined",
  "The stickers aren't printing",
  "Is delivery on right now?",
  "A customer wants a refund",
];

export function HelpChat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const clean = text.trim();
    if (!clean || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: clean }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/staff/help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        performed?: string[];
        error?: string;
      };
      setMsgs((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            data.reply ??
            "I couldn't get through just now. Try again, or call Stan if it's urgent.",
          performed: data.performed,
        },
      ]);
    } catch {
      setMsgs((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "No connection. Check the shop wifi, or call Stan if it's urgent.",
        },
      ]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }

  return (
    <div className="mt-4">
      <div className="min-h-[16rem] space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2 py-2">
            {OPENERS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => send(o)}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-[#3B82C4] hover:text-[#3B82C4] dark:border-zinc-700 dark:text-zinc-300"
              >
                {o}
              </button>
            ))}
          </div>
        )}

        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-[#3B82C4] text-white"
                  : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              }`}
            >
              {m.content}
            </div>
            {/* The server's own record of what it did, not the model's account
                of it. If the two ever disagree, this is the true one. */}
            {m.performed && m.performed.length > 0 && (
              <div className="mt-1 text-xs text-zinc-500">
                ✓ {m.performed.join(" · ")}
              </div>
            )}
          </div>
        ))}

        {busy && <div className="text-sm text-zinc-500">Checking…</div>}
        <div ref={endRef} />
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What's happening?"
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-[#3B82C4] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
