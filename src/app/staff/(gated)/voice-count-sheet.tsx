"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { parseVoiceCounts, type VoiceParse } from "@/lib/staff/voice-count";
import { chooseTranscript } from "@/lib/staff-help/transcript";
import { SILENCE_MS, MAX_LISTEN_MS } from "@/lib/staff-help/listening";

// Counting out loud: "mango three, peach five, lychee two".
//
// It fills the form and stops. Nothing is submitted, nothing is saved, and
// every match is shown next to the words it came from — because the failure
// worth designing against is not a mis-heard word, it is a mis-heard word that
// nobody sees. A wrong number here becomes a wrong order.
//
// English only, on purpose. The item names are English, and a recogniser set
// to one language transcribes the other as nonsense.

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechEventLike = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
};

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceCountSheet({
  onApply,
  onClose,
}: {
  /** Called with the values to write into the form. Never called on its own —
   *  only when someone presses Fill. */
  onApply: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState("");
  const [parse, setParse] = useState<VoiceParse | null>(null);
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (silenceRef.current) clearTimeout(silenceRef.current);
    if (maxRef.current) clearTimeout(maxRef.current);
    silenceRef.current = null;
    maxRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      recRef.current?.abort();
    };
  }, [clearTimers]);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-AU";
    // Continuous: a shelf walk is a long sentence with pauses in it.
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";
    interimRef.current = "";
    setParse(null);
    setTranscript("");
    setDropped(new Set());

    const armSilence = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }, SILENCE_MS);
    };

    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += chunk;
        else text += chunk;
      }
      interimRef.current = text;
      setInterim(text);
      armSilence();
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      clearTimers();
      setListening(false);
      setInterim("");
      const said = chooseTranscript(finalRef.current, interimRef.current);
      finalRef.current = "";
      interimRef.current = "";
      if (!said) return;
      setTranscript(said);
      setParse(parseVoiceCounts(said));
    };

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
      armSilence();
      maxRef.current = setTimeout(() => {
        try {
          rec.stop();
        } catch {
          /* already stopped */
        }
      }, MAX_LISTEN_MS);
    } catch {
      clearTimers();
      setListening(false);
    }
  }, [clearTimers]);

  const stop = useCallback(() => {
    clearTimers();
    recRef.current?.stop();
  }, [clearTimers]);

  const keep = (parse?.matched ?? []).filter((m) => !dropped.has(m.item.id));

  function toggle(id: string) {
    setDropped((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const supported = recognitionCtor() !== null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-base font-semibold">Count out loud</h2>
        <button onClick={onClose} className="min-h-11 px-3 text-sm underline">
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!supported && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This browser can&apos;t listen. Use the keypad instead.
          </p>
        )}

        {supported && !parse && !listening && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Say the item and the number, straight down the shelf — &ldquo;mango three,
            peach five, lychee two&rdquo;. English only, and nothing is saved until you
            press Fill.
          </p>
        )}

        {listening && (
          <div className="rounded-lg border-2 border-dashed border-[#3579B8] p-3 text-base">
            {interim || "Listening…"}
          </div>
        )}

        {parse && (
          <>
            <p className="mb-2 text-xs text-zinc-500">Heard: &ldquo;{transcript}&rdquo;</p>

            {parse.matched.length === 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Nothing matched an item on the list. Try again, or use the keypad.
              </p>
            )}

            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {parse.matched.map((m) => {
                const off = dropped.has(m.item.id);
                return (
                  <li key={m.item.id} className="flex items-center gap-3 py-2">
                    {/* Every row is switchable. The one thing this must never do
                        is write a number the person did not look at. */}
                    <input
                      type="checkbox"
                      checked={!off}
                      onChange={() => toggle(m.item.id)}
                      className="h-5 w-5 shrink-0"
                      aria-label={`Use ${m.item.name}`}
                    />
                    <span className={`flex-1 text-sm ${off ? "line-through opacity-50" : ""}`}>
                      {m.item.name}
                    </span>
                    <span className="text-base font-semibold tabular-nums">{m.value}</span>
                  </li>
                );
              })}
            </ul>

            {parse.ambiguous.length > 0 && (
              <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <b>{parse.ambiguous.join(", ")}</b> — there are two of these on the
                list. Say which one, e.g. &ldquo;syrup lemon three&rdquo;, or tap it in.
              </p>
            )}

            {parse.missingValue.length > 0 && (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                No number heard for <b>{parse.missingValue.join(", ")}</b>.
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        {parse && keep.length > 0 && (
          <button
            onClick={() => {
              onApply(Object.fromEntries(keep.map((m) => [m.item.id, m.value])));
              onClose();
            }}
            className="mb-2 min-h-12 w-full rounded-lg bg-[#3579B8] text-base font-medium text-white"
          >
            Fill {keep.length} item{keep.length === 1 ? "" : "s"}
          </button>
        )}
        {supported && (
          <button
            onClick={() => (listening ? stop() : start())}
            className={`min-h-12 w-full rounded-lg border-2 text-base font-medium ${
              listening
                ? "border-[#3579B8] bg-[#3579B8] text-white"
                : "border-[#3579B8] text-[#3579B8]"
            }`}
          >
            {listening ? "Stop" : parse ? "Say more" : "Start talking"}
          </button>
        )}
      </div>
    </div>
  );
}
