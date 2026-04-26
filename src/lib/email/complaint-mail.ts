import "server-only";

const PLACEHOLDER_EMAIL_DOMAINS = [
  "@phone.supabase.local",
  "@deleted.invalid",
];

export function resolveReplyTo(email: string | null | undefined): string | null {
  if (!email) return null;
  if (PLACEHOLDER_EMAIL_DOMAINS.some((s) => email.toLowerCase().endsWith(s))) {
    return null;
  }
  if (!email.includes("@")) return null;
  return email;
}

export type ComplaintMailAttachment = {
  filename: string;
  contentBase64: string;
};

export type ComplaintMailInput = {
  orderId: string;
  pickupNumber: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  description: string;
  placedAt: string | null;
  closedAt: string | null;
  totalsLine: string;
  itemLines: string[];
  attachments: ComplaintMailAttachment[];
};

export type ComplaintMailPayload = {
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  attachments: { filename: string; content: string }[];
};

export function buildComplaintEmail(
  input: ComplaintMailInput,
): ComplaintMailPayload {
  const replyTo = resolveReplyTo(input.customerEmail) ?? undefined;

  const subject = `Order issue · ${input.pickupNumber} · ${input.customerName}`;

  const placedLabel = input.placedAt ? formatBrisbane(input.placedAt) : "?";
  const closedLabel = input.closedAt ? formatBrisbane(input.closedAt) : "?";
  const phoneLine = input.customerPhone ?? "(no phone on file)";
  const emailLine = replyTo ?? "(no email on file)";

  const text = [
    `Order ${input.pickupNumber}  (placed ${placedLabel}, completed ${closedLabel} Brisbane time)`,
    `Customer: ${input.customerName} · ${phoneLine} · ${emailLine}`,
    "",
    "Items:",
    ...input.itemLines.map((l) => `  • ${l}`),
    `  ${input.totalsLine}`,
    "",
    "Customer says:",
    ...input.description.split(/\r?\n/).map((l) => `> ${l}`),
    "",
    input.attachments.length > 0
      ? `Photos: ${input.attachments.length} attached (${input.attachments.map((a) => a.filename).join(", ")})`
      : "Photos: none attached",
    "",
    replyTo
      ? "Reply directly to this email to reach the customer."
      : "No customer email on file — call or SMS to reach them.",
  ].join("\n");

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; line-height: 1.5; color: #1a1a1a;">
  <h2 style="margin: 0 0 8px;">Order ${escapeHtml(input.pickupNumber)}</h2>
  <p style="margin: 0 0 16px; color: #666;">Placed ${escapeHtml(placedLabel)} · Completed ${escapeHtml(closedLabel)} Brisbane time</p>

  <p style="margin: 0 0 4px;"><strong>Customer:</strong> ${escapeHtml(input.customerName)}</p>
  <p style="margin: 0 0 16px;">${escapeHtml(phoneLine)} · ${escapeHtml(emailLine)}</p>

  <h3 style="margin: 16px 0 8px;">Items</h3>
  <ul style="margin: 0; padding-left: 20px;">
    ${input.itemLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}
  </ul>
  <p style="margin: 8px 0 16px; color: #666;">${escapeHtml(input.totalsLine)}</p>

  <h3 style="margin: 16px 0 8px;">Customer says</h3>
  <blockquote style="margin: 0; padding: 8px 12px; border-left: 3px solid #C43A10; background: #FFF7F2; white-space: pre-wrap;">${escapeHtml(input.description)}</blockquote>

  <p style="margin: 16px 0 0; color: #666; font-size: 13px;">
    ${input.attachments.length > 0 ? `${input.attachments.length} photo(s) attached.` : "No photos attached."}
    ${replyTo ? "Reply to this email to reach the customer." : "No customer email on file — call or SMS to reach them."}
  </p>
</div>`;

  return {
    subject,
    text,
    html,
    replyTo,
    attachments: input.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
    })),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBrisbane(iso: string): string {
  // Brisbane is fixed UTC+10 (no DST). Manually offset and format.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  const local = new Date(d.getTime() + 10 * 60 * 60 * 1000);
  const yyyy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
