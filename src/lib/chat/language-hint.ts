/** Han (incl. extension A), kana, and Hangul — the scripts this model
 *  reaches for when it stops following the customer. */
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/;
/** Two or more Latin letters, so an order number or a bare "OK" is not
 *  mistaken for a sentence. */
const LATIN_WORD = /[A-Za-z]{2,}/;

/**
 * A statement of fact about what script the customer has actually typed,
 * for the end of the system prompt.
 *
 * The prompt already asks the model to answer in the customer's language,
 * and it mostly does. Mostly is the problem: measured 2026-08-12 against the
 * live catalog, an English question came back in Chinese 4–6 times in 20
 * while the promotion block was Chinese, and still 1 in 20 once every word
 * of the prompt was neutral. A short English message — "App for android" —
 * is a weak language signal, and this model's prior is strong.
 *
 * So the server decides rather than asking. Script is something code can
 * read and a prompt cannot argue with, and it is deliberately the only
 * claim made here: which language a Latin-script message is in (English,
 * Indonesian, German) is a guess, but that the reply should not come back
 * in Han characters is not.
 *
 * Returns null the moment the customer uses a CJK script anywhere in the
 * conversation. That asymmetry is the whole safety property: this can only
 * ever hold a reply in the script the customer chose, never move a Chinese
 * speaker to English.
 */
export function scriptHint(customerTexts: string[]): string | null {
  const all = customerTexts.join(" ");
  if (CJK.test(all)) return null;
  if (!LATIN_WORD.test(all)) return null;
  return "Every message this customer has written uses the Latin alphabet. Write your reply in the Latin alphabet too.";
}

/**
 * Did the reply come back in a script the customer never used?
 *
 * The hint above is still only a request, and asking is what kept failing:
 * on production after every wording fix, an open-ended English question
 * ("what do you recommend?") still came back in Chinese roughly 1 turn in
 * 10. This is the part that does not ask — the caller regenerates.
 *
 * False by definition when there is no hint, so a Chinese, Japanese or
 * Korean customer can never trip it.
 */
export function violatesScriptHint(hint: string | null, reply: string): boolean {
  if (!hint) return false;
  return CJK.test(reply);
}

/** Appended to the system prompt for the retry. Sits last, after the hint
 *  it is reinforcing, and names no language for the same reason nothing
 *  else here does. */
export const SCRIPT_RETRY_NOTE =
  "Your previous attempt was written in a script this customer has not used. Write the reply again, in the Latin alphabet.";
