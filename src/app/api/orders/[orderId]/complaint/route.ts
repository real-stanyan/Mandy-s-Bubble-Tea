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
  getResendClient,
} from "@/lib/email/resend";
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
  } catch {
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

  // 5. Dedup — must happen BEFORE multipart body parse to avoid wasting bandwidth
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("order_complaints")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "ALREADY_REPORTED" },
      { status: 409 },
    );
  }

  // Parse multipart body
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_INPUT" },
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
      { ok: false, error: bodyValidation.code, message: bodyValidation.message },
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
    console.error("[complaint] photo compress failed", err);
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

  // 9. Resend send — must happen BEFORE INSERT so failed sends leave no dedup row (retry possible)
  let sendError: { message: string } | null = null;
  try {
    const resend = getResendClient();
    const result = await resend.emails.send({
      to: COMPLAINT_TO_EMAIL,
      from: COMPLAINT_FROM_EMAIL,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments,
    });
    if (result.error) sendError = { message: result.error.message };
  } catch (err) {
    sendError = {
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (sendError) {
    console.error("[complaint] Resend send failed", sendError);
    return NextResponse.json(
      { ok: false, error: "EMAIL_FAILED" },
      { status: 502 },
    );
  }

  // 10. Dedup row (after successful send)
  const { error: insertError } = await admin.from("order_complaints").insert({
    order_id: orderId,
    customer_id: order.customerId,
    user_id: auth.userId,
  });
  if (insertError) {
    // Email already sent. Log + still return 200; worst case a retry sends a duplicate.
    console.error("[complaint] dedup row insert failed (email was sent)", insertError);
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
