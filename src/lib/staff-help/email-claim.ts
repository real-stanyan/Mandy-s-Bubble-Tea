/**
 * Did the reply tell the staff member the owner has been, or is being,
 * contacted?
 *
 * The model regularly signs off with "I'm emailing Rick now" having never
 * called the escalation tool. The staff member reads that sentence, tells the
 * customer someone will be in touch, and nobody is. So the server detects the
 * claim and makes it true rather than trying to prevent it with prompt text.
 *
 * Three things this has to get right, each learned the hard way:
 *
 *   Tense. The first version matched `\bemail\b`, which does not match
 *   "emailing" — the exact word the model used in the shop on 15 August, on a
 *   payments outage, with the receipt showing it had never sent anything.
 *
 *   Language. It was English-only, so every Chinese reply was invisible to it.
 *   Chinese is what the counter actually speaks, which means the safety net had
 *   never once fired in real use.
 *
 *   Sentence boundaries. "I emailed the supplier. Rick is away today." claims
 *   nothing. Working sentence by sentence gets this right in both languages
 *   and in either word order, which two directional regexes did not.
 */

/** Notifying, in either language. Stems, so tense cannot slip past. */
const NOTIFY =
  /email|messag|contact|notif|inform|told|telling|tell|flag|let\b|邮件|发给|发了|通知|告诉|联系|转告|报告|知会/i;

/** Sentence enders in both scripts, plus line breaks. */
const SENTENCE = /[.!?。！？；;\n]+/;

/**
 * Conditionals and refusals — sentences that leave the staff member knowing he
 * has NOT been told.
 *
 * Seen in production: asked to notify the owner about a fridge, and told it was
 * a test, the assistant answered "如果冰箱真的坏了，我马上发邮件给 Rick；如果只是
 * 测试，我就先不发" and asked for confirmation. Nobody reading that believes an
 * email has gone, so sending one anyway is noise — and an assistant that cries
 * wolf gets ignored, which costs more than the email saves.
 *
 * The net still errs toward sending: only an explicit "if" or "not" suppresses
 * it, never mere uncertainty.
 */
const NOT_YET = /\b(if|unless|would|should i|shall i|want me to|do you want)\b|如果|要是|若|除非|不发|不会发|没发|先不|要不要|需要我/i;

export function claimsEmailSent(reply: string, ownerName: string): boolean {
  const name = ownerName.toLowerCase();
  return reply
    .split(SENTENCE)
    .some(
      (sentence) =>
        sentence.toLowerCase().includes(name) &&
        NOTIFY.test(sentence) &&
        !NOT_YET.test(sentence),
    );
}
