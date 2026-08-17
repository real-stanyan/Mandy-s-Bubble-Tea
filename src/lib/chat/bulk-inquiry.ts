import "server-only";
import { COMPLAINT_FROM_EMAIL, COMPLAINT_TO_EMAIL } from "@/lib/email/resend";
import { sendTransactionalEmail } from "@/lib/email/send";

/** Exactly the shape of the model's record_bulk_inquiry tool call. */
export type BulkInquiry = {
  cups: number;
  /** When they want the drinks, in the customer's own words ("明天下午3点"). */
  when: string;
  delivery?: boolean;
  contact: string;
  notes?: string;
};

const MAX_FIELD = 500;

function clip(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, MAX_FIELD) : null;
}

/**
 * Email a bulk-order inquiry to the store — same inbox and channel as
 * complaints (Stan, 2026-08-17), so there is exactly one place to watch.
 *
 * These are the orders self-serve can't take: a future pickup time (no
 * advance orders exist) or 50+ cups (past the self-serve ceiling). The
 * email is the handoff to Rick; the chat transcript (recorded for every
 * turn already) is the backstop if mail breaks — and when it does, the
 * caller tells the model to hand out the store phone instead of promising
 * a callback nobody will make. Never throws.
 */
export async function sendBulkInquiry(
  inquiry: BulkInquiry,
): Promise<{ emailed: boolean }> {
  const contact = clip(inquiry.contact);
  const when = clip(inquiry.when) ?? "(not given)";
  const notes = clip(inquiry.notes);
  const cups = Number.isFinite(inquiry.cups)
    ? Math.max(0, Math.floor(inquiry.cups))
    : 0;
  if (!contact) return { emailed: false };

  const lines = [
    `Cups: ${cups || "(not given)"}`,
    `Wanted: ${when}`,
    `Delivery: ${inquiry.delivery === true ? "yes" : inquiry.delivery === false ? "no / pickup" : "(not asked)"}`,
    `Contact: ${contact}`,
    notes ? `Notes: ${notes}` : null,
    "",
    "From the website/app chat — reply to the customer to confirm drinks, timing and price.",
  ].filter((l): l is string => l !== null);

  const { sent } = await sendTransactionalEmail("bulk-inquiry", {
    from: COMPLAINT_FROM_EMAIL,
    to: COMPLAINT_TO_EMAIL,
    subject: `Bulk order inquiry — ${cups || "?"} cups, ${when}`,
    text: lines.join("\n"),
  });
  return { emailed: sent };
}
