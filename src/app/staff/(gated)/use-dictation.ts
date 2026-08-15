"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { chooseTranscript } from "@/lib/staff-help/transcript";
import { SILENCE_MS, MAX_LISTEN_MS } from "@/lib/staff-help/listening";

// Plain English dictation, for counting stock out loud.
//
// Deliberately not the help page's useVoice: that one carries a language
// choice and reads answers back, and its language is remembered in
// localStorage. Counting is English-only — the item names are English — and
// sharing that stored setting would let a count switch the assistant's
// microphone to Chinese behind someone's back.
//
// What the two do share is the part worth sharing: when a pause counts as
// finished, and which transcript to trust.

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

export function useDictation(opts: { onFinal: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(false);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  const interimRef = useRef("");
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalRef = useRef(opts.onFinal);

  useEffect(() => {
    onFinalRef.current = opts.onFinal;
  }, [opts.onFinal]);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
  }, []);

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

  const stop = useCallback(() => {
    clearTimers();
    recRef.current?.stop();
  }, [clearTimers]);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    // en-AU: the shop is in Brisbane, and the recogniser handles the local
    // vowels and "three" versus "free" noticeably better than en-US.
    rec.lang = "en-AU";
    // Continuous, because a shelf walk is one long sentence full of pauses.
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";
    interimRef.current = "";

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
      if (said) onFinalRef.current(said);
    };

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
      // Armed from the start, not from the first word: a microphone opened by
      // accident against shop noise would otherwise never close.
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

  return { listening, interim, supported, start, stop };
}
