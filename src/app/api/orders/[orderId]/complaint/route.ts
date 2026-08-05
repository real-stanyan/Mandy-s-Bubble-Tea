import { NextResponse } from "next/server";
import type { Square } from "square";
import { getAuthedUser } from "@/lib/auth";
import { squareClient } from "@/lib/square";
import { getSupabaseAdmin } from "@/lib/supabase-server";
import { compressForEmail } from "@/lib/photo-compress";
import {
  buildComplaintEmail,
  type ComplaintMailAttachment,
} from "@/lib/email/complaint-mail";
import {
  COMPLAINT_FROM_EMAIL,
  COMPLAINT_TO_EMAIL,
} from "@/lib/email/resend";
import { sendTransactionalEmail } from "@/lib/email/send";
import {
  PHOTO_ALLOWED_MIME,
  PHOTO_MAX_BYTES,
  isWithinComplaintWindow,
  ownsOrder,
  validateComplaintBody,
} from "@/lib/order-complaint";
import { formatPrice } from "@/lib/utils";

export const runtime = "nodejs"; // sharp + Buffer

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  // 1. Session
  const auth = await getAuthedUser(request);
  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "NOT_AUTHENTICATED" },
      { status: 401 },
    );
  }

  // Fetch order
  let order;
  try {
    const response = await squareClient.orders.get({ orderId });
    order = response.order;
  } catch (err) {
    console.error("[complaint] Square order fetch failed", { orderId, err });
    return NextResponse.json(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "ORDER_NOT_FOUND" },
      { status: 404 },
    );
  }

  // 2. Ownership
  const sessionCustomerId = auth.profile?.square_customer_id ?? null;
  if (!ownsOrder(sessionCustomerId, order.customerId ?? null)) {
    return NextResponse.json(
      { ok: false, error: "NOT_OWN_ORDER" },
      { status: 403 },
    );
  }

  // 3. Status
  if (order.state !== "COMPLETED") {
    return NextResponse.json(
      { ok: false, error: "NOT_COMPLETED" },
      { status: 409 },
    );
  }

  // 4. Window
  if (!isWithinComplaintWindow(order.closedAt ?? null, new Date())) {
    return NextResponse.json(
      { ok: false, error: "WINDOW_CLOSED" },
      { status: 410 },
    );
  }

  // 5. Dedup — on a *delivered* complaint, not on the mere existence of a row.
  //
  // The row is now written before the send, so an unsent one is evidence the
  // customer tried and something went wrong. Blocking on that would trap them:
  // their own failed attempt would answer every retry with ALREADY_REPORTED
  // and the complaint could never get through.
  //
  // `pending` doesn't block either, and that is deliberate. It means the send
  // was in flight — but a function that timed out mid-send leaves the row
  // pending forever, and treating that as "already reported" locks the
  // customer out permanently. A duplicate email to Mandy is a far smaller
  // problem than a customer who cannot report a bad drink. The pre-existing
  // race between this SELECT and the write below already allowed duplicates
  // anyway.
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("order_complaints")
    .select("id,status")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing && (existing as { status?: string }).status === "sent") {
    return NextResponse.json(
      { ok: false, error: "ALREADY_REPORTED" },
      { status: 409 },
    );
  }

  // Parse multipart body
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    console.error("[complaint] multipart parse failed", { orderId, err });
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_INPUT",
        message: "Could not read upload, please retry.",
      },
      { status: 422 },
    );
  }

  const description = (formData.get("description") as string | null) ?? "";
  const photoEntries = formData.getAll("photos").filter((v): v is File => v instanceof File);

  // 6. Body shape
  const bodyValidation = validateComplaintBody({
    description,
    photoCount: photoEntries.length,
  });
  if (!bodyValidation.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_INPUT",
        reason: bodyValidation.code,
        message: bodyValidation.message,
      },
      { status: 422 },
    );
  }

  // 7. Photo MIME + size
  for (const file of photoEntries) {
    if (!PHOTO_ALLOWED_MIME.includes(file.type as (typeof PHOTO_ALLOWED_MIME)[number])) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PHOTO", message: `unsupported type: ${file.type}` },
        { status: 422 },
      );
    }
    if (file.size > PHOTO_MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "INVALID_PHOTO", message: "photo exceeds 8 MB" },
        { status: 422 },
      );
    }
  }

  // 8. Compress
  let attachments: ComplaintMailAttachment[];
  try {
    attachments = await Promise.all(
      photoEntries.map(async (file, idx) => {
        const buf = Buffer.from(await file.arrayBuffer());
        const compressed = await compressForEmail(buf, file.type, idx);
        return {
          filename: compressed.filename,
          contentBase64: compressed.buffer.toString("base64"),
        };
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[complaint] photo compress failed", { orderId, message });
    // Sharp can throw on undecodable inputs (HEIC without libheif, corrupt
    // JPEG, etc.). Map those to 422 so the customer knows to retry with a
    // different photo rather than retrying the same broken upload forever.
    if (/unsupported|heif|heic|premature|invalid|corrupt/i.test(message)) {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_PHOTO",
          message: "We couldn't process one of the photos. Try a different one.",
        },
        { status: 422 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "PROCESSING_FAILED" },
      { status: 500 },
    );
  }

  // Build customer name + line item summary for email body
  const customerName = [auth.profile?.first_name, auth.profile?.last_name]
    .filter(Boolean)
    .join(" ") || "Customer";
  const customerPhone = auth.profile?.phone_e164 ?? auth.phone ?? null;
  const customerEmail = auth.email;

  const itemLines = (order.lineItems ?? []).map((li) => formatLineItem(li));
  const totalsLine = formatTotalsLine(order);
  const pickupNumber = order.ticketName ||
    (order.id ? `#${order.id.slice(-4).toUpperCase()}` : "OL???");

  const mail = buildComplaintEmail({
    orderId,
    pickupNumber,
    customerName,
    customerPhone,
    customerEmail,
    description: description.trim(),
    placedAt: order.createdAt ?? null,
    closedAt: order.closedAt ?? null,
    totalsLine,
    itemLines,
    attachments,
  });

  // 9. Record the complaint BEFORE trying to send it.
  //
  // This used to be the other way round — send, then write the row on success
  // — so that a failed send left no dedup row and the customer could retry.
  // The retry part was right; keeping the text only in the email was not. When
  // the mail provider was broken for 69 days (issue #130) every complaint in
  // that window vanished: no row, no text, no way to know one had even been
  // attempted. Writing first means the customer's words survive regardless of
  // what the mail provider does.
  const nowIso = new Date().toISOString();
  const { error: saveError } = await admin.from("order_complaints").upsert(
    {
      order_id: orderId,
      customer_id: order.customerId,
      user_id: auth.userId,
      description: description.trim(),
      // Photos still travel by email only. The count and names are kept so a
      // report backed by evidence is distinguishable from a bare one.
      photo_count: attachments.length,
      photo_filenames: attachments.map((a) => a.filename),
      status: "pending",
      failure_reason: null,
      sent_at: null,
      updated_at: nowIso,
    },
    { onConflict: "order_id" },
  );
  if (saveError) {
    // Log loudly but still try to send. Refusing here would trade "the
    // complaint is only in the email" for "the customer cannot complain at
    // all", which is worse — delivery is the point.
    console.error("[complaint] could not record complaint before sending", {
      orderId,
      message: saveError.message,
    });
  }

  // 10. Send
  const outcome = await sendTransactionalEmail("complaint", {
    to: COMPLAINT_TO_EMAIL,
    from: COMPLAINT_FROM_EMAIL,
    replyTo: mail.replyTo,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments,
  });

  // 11. Record the outcome. A `failed` row is the thing that was missing
  // before: it says a real customer complained, here is what they said, and
  // nobody has seen it.
  const { error: statusError } = await admin
    .from("order_complaints")
    .update(
      outcome.sent
        ? { status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : { status: "failed", failure_reason: outcome.reason, updated_at: new Date().toISOString() },
    )
    .eq("order_id", orderId);
  if (statusError) {
    console.error("[complaint] could not record send outcome", {
      orderId,
      sent: outcome.sent,
      message: statusError.message,
    });
  }

  if (!outcome.sent) {
    // The customer still gets an error — they should know it didn't reach
    // anyone — but the complaint is on record now either way.
    return NextResponse.json(
      { ok: false, error: "EMAIL_FAILED" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}

function formatLineItem(li: Square.OrderLineItem): string {
  const name = li.name ?? "Item";
  const variation = li.variationName ? ` (${li.variationName}` : "";
  const mods = (li.modifiers ?? [])
    .map((m) => m.name)
    .filter(Boolean)
    .join(", ");
  const modsPart = mods ? `${variation ? ", " : " ("}${mods}` : "";
  const closing = variation || mods ? ")" : "";
  const qty = parseInt(li.quantity ?? "1", 10);
  const qtyPart = qty > 1 ? ` ×${qty}` : "";
  const total = li.totalMoney?.amount;
  const priceStr = typeof total === "bigint" ? `  ${formatPrice(total)}` : "";
  return `${name}${variation}${modsPart}${closing}${qtyPart}${priceStr}`;
}

function formatTotalsLine(order: Square.Order): string {
  const subtotal = order.totalMoney?.amount;
  const subPart = typeof subtotal === "bigint" ? `Total ${formatPrice(subtotal)}` : "";
  const charges = (order.serviceCharges ?? [])
    .map((c) => {
      const amt = c.totalMoney?.amount ?? c.appliedMoney?.amount;
      if (typeof amt !== "bigint") return null;
      return `${c.name ?? "Charge"} ${formatPrice(amt)}`;
    })
    .filter((s): s is string => !!s);
  return [subPart, ...charges].filter(Boolean).join(" · ") || "—";
}
