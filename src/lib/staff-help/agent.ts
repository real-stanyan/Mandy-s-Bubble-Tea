import "server-only";
import { sendTransactionalEmail } from "@/lib/email/send";
import { COMPLAINT_TO_EMAIL } from "@/lib/email/resend";

// The sending domain, not the shop's trading name. This was
// orders@mandysbubbletea.com.au for the first two days — a domain that does
// not exist and is not verified with Resend, so every escalation was rejected
// while the page cheerfully reported "emailed Rick". mandybubbletea.com is the
// verified one; the payments watcher has been sending from it all along.
const FROM = process.env.STAFF_HELP_FROM ?? "Mandy's Alerts <noreply@mandybubbletea.com>";

// Staff escalations go to the shop's shared inbox — a sold-out topping, a
// customer waiting on a refund. Shop business, which needs to reach whoever is
// reading mail, including at 9pm when Rick is not.
//
// Deliberately NOT PAYMENT_ALERT_TO, which this borrowed at first. That one
// exists to page Rick personally the moment card payments start failing. It is
// unset today, so both resolved to the same inbox and the mistake was
// invisible — but the day it is pointed at his phone to catch an outage, every
// routine "we're out of strawberry popping boba" would have followed it there.
const TO = process.env.STAFF_HELP_TO ?? COMPLAINT_TO_EMAIL;

/** Emails the shop inbox. Used both by escalate_to_owner and, automatically,
 *  after any action — staff cannot audit what the assistant did, so the audit
 *  trail has to arrive without anyone choosing to send it.
 *
 *  Returns whether it actually went. The caller must not claim it did
 *  otherwise: a receipt that says "emailed Rick" when nothing was sent is
 *  worse than no receipt, because the staff member then tells a customer
 *  someone will be in touch. */
export async function notifyOwner(subject: string, body: string): Promise<boolean> {
  const outcome = await sendTransactionalEmail("staff-help", {
    from: FROM,
    to: [TO],
    subject,
    text: body,
  });
  if (!outcome.sent) {
    console.error("[staff-help] escalation email failed:", outcome.reason);
  }
  return outcome.sent;
}
