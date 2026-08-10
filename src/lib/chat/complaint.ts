import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { COMPLAINT_FROM_EMAIL, COMPLAINT_TO_EMAIL } from "@/lib/email/resend";
import { sendTransactionalEmail } from "@/lib/email/send";

/** Exactly the shape of the model's file_complaint tool call. */
export type ComplaintFiling = {
  summary: string;
  orderNumber?: string;
  contact?: string;
};

const MAX_FIELD = 500;

function clip(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, MAX_FIELD) : null;
}

/**
 * Record a chat complaint, then tell the manager.
 *
 * Order is the whole point (issue #132): the row lands in chat_complaints
 * BEFORE the email is attempted, so a broken mail channel can no longer
 * erase the complaint itself. Neither failure aborts the other — a dead
 * table must not stop the email, a dead mailbox must not roll back the
 * row — and the customer-facing promise ("the manager will be in touch")
 * is made by the caller only when at least one of the two succeeded.
 */
export async function fileChatComplaint(
  filing: ComplaintFiling,
  ipHash: string | null,
): Promise<{ stored: boolean; emailed: boolean }> {
  const summary = clip(filing.summary);
  if (!summary) return { stored: false, emailed: false };
  const orderNumber = clip(filing.orderNumber);
  const contact = clip(filing.contact);

  let stored = false;
  let rowId: string | null = null;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("chat_complaints")
      .insert({
        summary,
        order_number: orderNumber,
        contact,
        ip_hash: ipHash,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[chat] complaint insert failed:", error.message);
    } else {
      stored = true;
      rowId = data?.id ?? null;
    }
  } catch (err) {
    console.error(
      "[chat] complaint insert threw:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const outcome = await sendTransactionalEmail("chat-complaint", {
    to: COMPLAINT_TO_EMAIL,
    from: COMPLAINT_FROM_EMAIL,
    subject: `Chat complaint${orderNumber ? ` — order ${orderNumber}` : ""}`,
    text: [
      "A customer filed a complaint through the website chat.",
      "",
      `Summary: ${summary}`,
      orderNumber ? `Order number: ${orderNumber}` : "Order number: (not given)",
      contact ? `Contact: ${contact}` : "Contact: (not given)",
      rowId ? `Record: chat_complaints ${rowId}` : "Record: NOT STORED — insert failed, this email is the only copy",
      "",
      "The customer was told the manager will contact them within 24 hours.",
    ].join("\n"),
  });

  if (stored && rowId && outcome.sent) {
    // Best-effort bookkeeping; the complaint is already safe in the row.
    await getSupabaseAdmin()
      .from("chat_complaints")
      .update({ manager_notified: true })
      .eq("id", rowId);
  }

  return { stored, emailed: outcome.sent };
}
