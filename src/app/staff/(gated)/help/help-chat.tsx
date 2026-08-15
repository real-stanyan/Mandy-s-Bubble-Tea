"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVoice } from "./use-voice";
import { LANGUAGE_LABEL, type StaffLanguage } from "@/lib/staff-help/language";

type Msg = {
  role: "user" | "assistant";
  content: string;
  performed?: string[];
  spoken?: boolean;
};

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
  // Off by default. Somebody who tapped the mic wants to be talked back to;
  // somebody typing at the counter does not want the shop to hear the answer.
  const [readAloud, setReadAloud] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  // The transcript, readable synchronously. A state updater must be pure —
  // building the outgoing history inside one would append twice under
  // StrictMode, which is exactly the kind of bug that only shows up in
  // production once a second person is on the page.
  const msgsRef = useRef<Msg[]>([]);
  // Voice is created below and its identity changes every render; the ref
  // keeps this callback from capturing a stale one.
  const voiceRef = useRef<ReturnType<typeof useVoice> | null>(null);
  const readAloudRef = useRef(readAloud);

  const send = useCallback(async (text: string, spokenByUser = false) => {
    const clean = text.trim();
    if (!clean || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const next: Msg[] = [...msgsRef.current, { role: "user" as const, content: clean }];
    msgsRef.current = next;
    setMsgs(next);
    setInput("");
    const append = (m: Msg) => {
      msgsRef.current = [...msgsRef.current, m];
      setMsgs(msgsRef.current);
    };

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
        language?: StaffLanguage | null;
      };
      const reply =
        data.reply ??
        "I couldn't get through just now. Try again, or call Stan if it's urgent.";

      // The server decided the language, so the voice follows it rather than
      // guessing again.
      //
      // But the microphone is only re-aimed from a TYPED message. A voice
      // transcript was produced by the current microphone setting, so using it
      // to pick that setting is circular: speak Chinese while the mic is on
      // English, get English nonsense back, and the nonsense would confirm
      // English and pin it there. Someone who reaches for the toggle stays
      // corrected.
      const voice = voiceRef.current;
      if (data.language && !spokenByUser) voice?.setLang(data.language);

      // Spoken back when the staff member spoke, or when they asked for it.
      // Their hands are in a cup either way.
      const willSpeak = readAloudRef.current || spokenByUser;
      append({ role: "assistant", content: reply, performed: data.performed, spoken: willSpeak });
      if (willSpeak && voice) void voice.speak(reply, data.language ?? voice.lang);
    } catch {
      append({
        role: "assistant",
        content: "No connection. Check the shop wifi, or call Stan if it's urgent.",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }, []);

  const voice = useVoice({ onFinal: (said) => void send(said, true) });
  useEffect(() => {
    voiceRef.current = voice;
    readAloudRef.current = readAloud;
  });

  return (
    <div className="mt-4">
      <div className="min-h-[16rem] space-y-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-2 py-2">
            {OPENERS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => void send(o)}
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
              <div className="mt-1 text-xs text-zinc-500">✓ {m.performed.join(" · ")}</div>
            )}
          </div>
        ))}

        {/* Live transcript. Shown rather than sent silently, so a mis-heard
            sentence is caught by the person who said it. */}
        {voice.listening && (
          <div className="text-right">
            <div className="inline-block max-w-[85%] rounded-2xl border-2 border-dashed border-[#3B82C4] px-3 py-2 text-sm text-zinc-500">
              {voice.interim || "Listening…"}
            </div>
          </div>
        )}

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
        {voice.supported && (
          <button
            type="button"
            onClick={() => (voice.listening ? voice.stop() : voice.start())}
            aria-label={voice.listening ? "Stop listening" : "Speak"}
            aria-pressed={voice.listening}
            className={`shrink-0 rounded-lg border px-3 py-2 text-lg ${
              voice.listening
                ? "animate-pulse border-[#3B82C4] bg-[#3B82C4] text-white"
                : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            {voice.listening ? "■" : "🎤"}
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={voice.listening ? "Listening…" : "What's happening?"}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-lg bg-[#3B82C4] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>

      <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={readAloud}
            onChange={(e) => setReadAloud(e.target.checked)}
          />
          Read answers aloud
        </label>

        {/* Which language the microphone expects. The server keeps this in
            step from what is actually said, so it is a correction, not a
            setting anyone has to maintain. */}
        <span className="flex items-center gap-1">
          Mic:
          {(Object.keys(LANGUAGE_LABEL) as StaffLanguage[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => voice.setLang(l)}
              className={voice.lang === l ? "font-semibold text-[#3B82C4]" : "underline"}
            >
              {LANGUAGE_LABEL[l]}
            </button>
          ))}
        </span>

        {voice.speaking && (
          <button type="button" onClick={voice.hush} className="underline">
            Stop talking
          </button>
        )}
      </div>
    </div>
  );
}
