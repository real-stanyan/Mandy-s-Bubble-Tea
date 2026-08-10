"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/store/chat";
import { chatUiStrings } from "@/lib/chat/ui-strings";

/** Minimal typing for the vendor-prefixed Web Speech API. */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Stand-alone voice ordering entry — bottom centre, to the left of the
 * Hi Mandy! pill (Stan's placement). Tap, speak, tap again (or pause) —
 * the transcript is handed to the chat via voiceDraft and sent through
 * the exact same text pipeline; voice is an input method, not a second
 * brain. Renders nothing where the Web Speech API doesn't exist, so an
 * unsupported browser never shows a dead microphone.
 */
export function VoiceOrderButton() {
  const t = chatUiStrings();
  const isOpen = useChat((s) => s.isOpen);
  const open = useChat((s) => s.open);
  const setVoiceDraft = useChat((s) => s.setVoiceDraft);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  // Support is a client-only fact — resolving it in an effect keeps the
  // server render (button absent) identical to the first client render.
  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
  }, []);

  useEffect(() => () => recRef.current?.stop(), []);

  if (!supported || isOpen) return null;

  function stop() {
    recRef.current?.stop();
    setListening(false);
  }

  function start() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-AU";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length })
        .map((_, i) => e.results[i][0]?.transcript ?? "")
        .join("")
        .trim();
      if (transcript) {
        // Hand over and open — ChatDrawer sends it on arrival.
        setVoiceDraft(transcript);
        open();
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      aria-label={listening ? t.voiceStop : t.voiceOrder}
      className={
        // -translate-x-[80%] on mobile: a true centre put this pill's right
        // edge 25px under Hi Mandy! on a 375px screen — nudged left it
        // reads as "centre, left of Mandy" with clear air between them;
        // lg has room for the exact centre.
        "fixed bottom-24 left-1/2 z-40 flex h-13 -translate-x-[80%] items-center gap-2 rounded-full px-4 text-white shadow-primary-cta transition active:scale-95 lg:bottom-6 lg:-translate-x-1/2 " +
        (listening ? "animate-pulse bg-red-600" : "bg-brand hover:bg-brand-dark")
      }
    >
      <MicIcon className="h-6 w-6" />
      <span className="text-sm font-semibold">
        {listening ? t.voiceStop : t.voiceOrder}
      </span>
    </button>
  );
}
