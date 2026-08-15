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

export function claimsEmailSent(reply: string, ownerName: string): boolean {
  const name = ownerName.toLowerCase();
  return reply
    .split(SENTENCE)
    .some((sentence) => sentence.toLowerCase().includes(name) && NOTIFY.test(sentence));
}
