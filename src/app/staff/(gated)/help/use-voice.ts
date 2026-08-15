"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SPEECH_LOCALE, type StaffLanguage } from "@/lib/staff-help/language";
import { chooseTranscript } from "@/lib/staff-help/transcript";

// Speech in and speech out, both from the browser.
//
// Nothing is uploaded: recognition and synthesis run on the device, which is
// what makes it feel instant and what keeps a counter conversation — customer
// names, complaints, card trouble — off a third party's servers.
//
// The cost is that the recogniser has to be told which language to expect. No
// browser detects it from audio. So the language comes from the server's
// reading of what was last said, and the first utterance of a conversation
// uses whatever the shop used last. Getting that wrong costs one retry, which
// is why the transcript is shown live and never sent without the staff member
// seeing it.

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionEventLike = {
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

const LANG_KEY = "staff-help-lang";

export function useVoice(opts: { onFinal: (text: string) => void }) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [lang, setLangState] = useState<StaffLanguage>("en");

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");
  // The last interim transcript. iOS Safari frequently ends a session without
  // ever marking a result final, and everything said is then thrown away —
  // observed in the shop on 15 August: "现在店里正常吗" sat correctly in the
  // live transcript and was never sent. What was heard is what gets used,
  // whether or not the browser got around to blessing it.
  const interimRef = useRef("");
  // The callback changes identity every render; the recogniser is built once.
  const onFinalRef = useRef(opts.onFinal);
  useEffect(() => {
    onFinalRef.current = opts.onFinal;
  }, [opts.onFinal]);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    const saved = window.localStorage.getItem(LANG_KEY);
    // Checked against the locale table rather than a hand-written list, so
    // adding a language cannot leave a stale check that silently discards it.
    if (saved && Object.hasOwn(SPEECH_LOCALE, saved)) setLangState(saved as StaffLanguage);
  }, []);

  const setLang = useCallback((next: StaffLanguage) => {
    setLangState(next);
    window.localStorage.setItem(LANG_KEY, next);
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    // Never listen and talk at once: the microphone would hear the answer and
    // transcribe it back as if the staff member had said it.
    window.speechSynthesis?.cancel();
    setSpeaking(false);

    const rec = new Ctor();
    rec.lang = SPEECH_LOCALE[lang];
    rec.continuous = false;
    rec.interimResults = true;
    finalRef.current = "";
    interimRef.current = "";

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const chunk = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalRef.current += chunk;
        else interimText += chunk;
      }
      interimRef.current = interimText;
      setInterim(interimText);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => {
      setListening(false);
      setInterim("");
      const said = chooseTranscript(finalRef.current, interimRef.current);
      finalRef.current = "";
      interimRef.current = "";
      // Sent only on a real utterance. A mic opened by accident in a noisy
      // shop ends with nothing, and nothing is the right thing to send.
      if (said) onFinalRef.current(said);
    };

    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  }, [lang]);

  const speak = useCallback(async (text: string, spokenLang: StaffLanguage) => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    if (!synth || !text) return;
    synth.cancel();

    // getVoices() is empty until the browser has loaded them, and it is empty
    // exactly when it matters: the first answer after the page opens. Reading
    // it too early means no Chinese voice is found and an English one reads
    // the Chinese out. Wait for the list, but not forever — a missing voice
    // should degrade to the browser's own choice, not to silence.
    let voices = synth.getVoices();
    if (voices.length === 0) {
      voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          synth.removeEventListener("voiceschanged", done);
          resolve(synth.getVoices());
        };
        const timer = setTimeout(done, 1000);
        synth.addEventListener("voiceschanged", done);
      });
    }

    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LOCALE[spokenLang];
    // Derived, not listed: a hand-written pair here is how a third language
    // ends up being read out by an English voice.
    const prefix = SPEECH_LOCALE[spokenLang].split("-")[0].toLowerCase();
    const match =
      // An exact locale first (zh-CN over zh-TW: the shop speaks Mandarin),
      // then any voice of that language.
      voices.find((v) => v.lang.replace("_", "-").toLowerCase() === SPEECH_LOCALE[spokenLang].toLowerCase()) ??
      voices.find((v) => v.lang.replace("_", "-").toLowerCase().startsWith(prefix));
    if (match) u.voice = match;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }, []);

  const hush = useCallback(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, []);

  // Leaving the page mid-sentence should not leave a phone talking to itself.
  useEffect(() => {
    return () => {
      recRef.current?.abort();
      window.speechSynthesis?.cancel();
    };
  }, []);

  return { listening, interim, speaking, supported, lang, setLang, start, stop, speak, hush };
}
