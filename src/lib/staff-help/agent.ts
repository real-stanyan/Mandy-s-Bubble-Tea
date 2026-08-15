import "server-only";
import { sendTransactionalEmail } from "@/lib/email/send";
import { COMPLAINT_TO_EMAIL } from "@/lib/email/resend";

const FROM = "Mandy's Bubble Tea <orders@mandysbubbletea.com.au>";
const TO = process.env.PAYMENT_ALERT_TO ?? COMPLAINT_TO_EMAIL;

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
