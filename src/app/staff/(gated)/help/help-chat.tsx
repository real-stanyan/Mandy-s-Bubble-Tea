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
        "I couldn't get through just now. Try again, or call Rick if it's urgent.";

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
        content: "No connection. Check the shop wifi, or call Rick if it's urgent.",
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
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-[#3579B8] hover:text-[#3579B8] dark:border-zinc-700 dark:text-zinc-300"
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
                  ? "bg-[#3579B8] text-white"
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
            <div className="inline-block max-w-[85%] rounded-2xl border-2 border-dashed border-[#3579B8] px-3 py-2 text-sm text-zinc-500">
              {voice.interim || "Listening…"}
            </div>
          </div>
        )}

        {busy && <div className="text-sm text-zinc-500">Checking…</div>}
        <div ref={endRef} />
      </div>

      {/* Talking is the primary way in, so it gets the biggest target on the
          page rather than a square wedged beside a text field. Someone holding
          a cup in one hand should be able to hit it without looking. */}
      {voice.supported && (
        <div className="mt-4 flex flex-col items-center">
          <button
            type="button"
            onClick={() => (voice.listening ? voice.stop() : voice.start())}
            aria-label={voice.listening ? "Stop listening" : "Speak"}
            aria-pressed={voice.listening}
            // Filled in both states. An outlined blue mic on the shop's dark
            // page measured 3.5:1 — legible, but this is the control the whole
            // page is for, and white on the fill is 4.59:1.
            className={`relative flex h-20 w-20 items-center justify-center rounded-full bg-[#3579B8] text-white transition-transform active:scale-95 ${
              voice.listening ? "" : "shadow-lg"
            }`}
          >
            {/* A drawn icon, not an emoji: 🎤 is a different picture on every
                platform and renders at whatever size the font decides. */}
            {voice.listening ? (
              <span className="block h-6 w-6 rounded-sm bg-current" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                className="h-9 w-9"
                aria-hidden="true"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            )}
            {/* The ring is outside the button's own box so it cannot nudge the
                layout as it animates. */}
            {voice.listening && (
              <span className="pointer-events-none absolute -inset-2 animate-ping rounded-full border-2 border-[#3579B8] opacity-60" />
            )}
          </button>
          <div className="mt-2 h-5 text-sm text-zinc-500">
            {voice.listening ? "Listening — tap to stop" : "Tap and say what's wrong"}
          </div>
        </div>
      )}

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
          placeholder={voice.listening ? "Listening…" : "…or type it here"}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 text-base dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="min-h-11 shrink-0 rounded-lg bg-[#3579B8] px-4 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {/* Which language the microphone expects.
          A segmented control rather than three small links: this is the one
          setting staff actually reach for, mid-service, one-handed, and
          getting it wrong is what turned "现在店里正常吗" into "Send down the
          jump". Each button is a full 44px tap target — the size a thumb
          needs — and the chosen one is filled rather than merely bolder, so
          it reads at a glance from arm's length. */}
      <div className="mt-3">
        <div className="mb-1.5 text-xs text-zinc-500">Microphone language</div>
        <div className="flex gap-2">
          {(Object.keys(LANGUAGE_LABEL) as StaffLanguage[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => voice.setLang(l)}
              aria-pressed={voice.lang === l}
              className={`min-h-11 flex-1 rounded-lg border px-3 text-base font-medium transition-colors ${
                voice.lang === l
                  ? "border-[#3579B8] bg-[#3579B8] text-white"
                  : "border-zinc-300 text-zinc-700 dark:border-zinc-600 dark:text-zinc-200"
              }`}
            >
              {LANGUAGE_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-sm text-zinc-500">
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={readAloud}
            onChange={(e) => setReadAloud(e.target.checked)}
            className="h-5 w-5"
          />
          Read answers aloud
        </label>

        {voice.speaking && (
          <button
            type="button"
            onClick={voice.hush}
            className="ml-auto min-h-11 rounded-lg border border-zinc-300 px-4 text-sm dark:border-zinc-600 dark:text-zinc-200"
          >
            Stop talking
          </button>
        )}
      </div>
    </div>
  );
}
