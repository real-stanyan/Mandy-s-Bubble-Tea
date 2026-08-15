import "server-only";
import { sendTransactionalEmail } from "@/lib/email/send";
import { COMPLAINT_TO_EMAIL } from "@/lib/email/resend";

const FROM = "Mandy's Bubble Tea <orders@mandysbubbletea.com.au>";
// Staff escalations go to the shop's shared inbox — a sold-out topping, a
// customer waiting on a refund. Shop business, which needs to reach whoever is
// reading mail, including at 9pm when Stan is not.
//
// Deliberately NOT PAYMENT_ALERT_TO, which this borrowed at first. That one
// exists to page Stan personally the moment card payments start failing. It is
// unset today, so both resolved to the same inbox and the mistake was
// invisible — but the day it is pointed at his phone to catch an outage, every
// routine "we're out of strawberry popping boba" would have followed it there.
const TO = process.env.STAFF_HELP_TO ?? COMPLAINT_TO_EMAIL;

/** Emails Stan. Used both by escalate_to_stan and, automatically, after any
 *  action — staff cannot audit what the assistant did, so the audit trail has
 *  to arrive without anyone choosing to send it. */
export async function notifyStan(
  subject: string,
  body: string,
): Promise<void> {
  await sendTransactionalEmail("staff-help", {
    from: FROM,
    to: [TO],
    subject,
    text: body,
  });
}
