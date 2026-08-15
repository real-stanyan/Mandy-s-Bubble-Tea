/** Hangul syllables plus the jamo blocks, checked before Han: Korean text
 *  rarely contains hanja, but when it does the Hangul is still the signal. */
const HANGUL = /[가-힣ᄀ-ᇿㄱ-ㆎ]/;
/** Han (incl. extension A) and kana. */
const CJK = /[぀-ヿ㐀-䶿一-鿿]/;
/** Two or more Latin letters standing alone as a word. The boundary checks
 *  are what keep sticker numbers out: "OL" in "OL846" is glued to digits, and
 *  staff type those far more often than they type English. */
const LATIN_WORD = /(?<![A-Za-z0-9])[A-Za-z]{2,}(?![A-Za-z0-9])/;

export type StaffLanguage = "zh" | "en" | "ko";

/**
 * Which language the person at the counter is speaking.
 *
 * Deliberately symmetric, unlike the customer bot's `scriptHint`, which can
 * only ever hold a reply in Latin script and never move a Chinese speaker to
 * English. That asymmetry is right for customers, where guessing wrong is
 * rude but harmless. Here it would be neither: this value also picks the
 * speech recogniser's language and the voice that reads the answer out loud,
 * so a wrong answer is not an odd-looking sentence — it is a recogniser that
 * transcribes nothing and a phone that talks in a language nobody asked for.
 *
 * The last message wins. Someone who switches mid-conversation is switching
 * on purpose, and in a shop that usually means a different person picked up
 * the phone.
 *
 * Returns null when there is nothing to go on — a bare order number, an
 * empty string — so the caller can leave the previous choice alone rather
 * than flip to a default.
 */
export function detectLanguage(texts: string[]): StaffLanguage | null {
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i] ?? "";
    if (HANGUL.test(t)) return "ko";
    if (CJK.test(t)) return "zh";
    if (LATIN_WORD.test(t)) return "en";
  }
  return null;
}

/**
 * A statement of fact for the end of the system prompt.
 *
 * The prompt already asks for the staff member's language and Opus 5 mostly
 * obliges. Mostly is fine to read and bad to listen to: a spoken answer in
 * the wrong language cannot be skimmed past, and the staff member has both
 * hands in a cup.
 */
const LANGUAGE_NAME: Record<StaffLanguage, string> = {
  zh: "Chinese",
  en: "English",
  ko: "Korean",
};

export function languageDirective(lang: StaffLanguage | null): string {
  if (!lang) return "";
  const name = LANGUAGE_NAME[lang];
  return `\n\nThe staff member is writing in ${name}. Write your reply in ${name}.`;
}

/** BCP-47 tags for the browser's speech recogniser and speech synthesis.
 *  en-AU because the shop is in Brisbane and the recogniser handles local
 *  place names and "OL846" noticeably better than en-US. */
export const SPEECH_LOCALE: Record<StaffLanguage, string> = {
  zh: "zh-CN",
  en: "en-AU",
  ko: "ko-KR",
};

/** What the mic toggle shows, each in its own language — the person choosing
 *  it is the person who reads it. */
export const LANGUAGE_LABEL: Record<StaffLanguage, string> = {
  en: "English",
  zh: "中文",
  ko: "한국어",
};
