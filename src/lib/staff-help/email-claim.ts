/**
 * Did the reply tell the staff member the owner has been emailed?
 *
 * Roughly once in six tries the model signs off with "I've emailed Rick"
 * having never called the escalation tool — observed against the real model on
 * a double-charge question, which is exactly the kind that must not go quiet.
 * Prompt wording does not reliably fix it, and the staff member reads the
 * sentence, not the receipt: they tell the customer someone will be in touch,
 * and nobody is.
 *
 * So the server detects the claim and makes it true, rather than trying to
 * prevent it with more prompt text.
 *
 * The name is a parameter rather than a literal. When it was hard-coded here
 * and in the prompt, and the shop's owner changed from Stan to Rick, the
 * prompt was updated and this was not — the check silently stopped matching
 * anything and nothing failed.
 */
export function claimsEmailSent(reply: string, ownerName: string): boolean {
  const name = ownerName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Either order, because the model writes both "I've emailed Rick" and
  // "that's Rick's call, and he's been emailed". Bounded by sentence
  // punctuation so a verb in one sentence cannot pair with a name in the next.
  const verbThenName = new RegExp(
    `\\b(emailed|email|messaged|contacted|told)\\b[^.!?]{0,40}\\b${name}\\b`,
    "i",
  );
  const nameThenVerb = new RegExp(
    `\\b${name}\\b[^.!?]{0,40}\\b(emailed|messaged|contacted|notified)\\b`,
    "i",
  );
  return verbThenName.test(reply) || nameThenVerb.test(reply);
}
