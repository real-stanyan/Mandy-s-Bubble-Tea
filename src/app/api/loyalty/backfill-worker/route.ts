import { NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { backfillAccrualForOrder } from "@/lib/loyalty-backfill";

export const dynamic = "force-dynamic";

async function handler(request: Request) {
  let orderId: string | undefined;
  try {
    const body = (await request.json()) as { orderId?: string };
    orderId = body.orderId;
  } catch {
    return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });
  }
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "missing orderId" }, { status: 400 });
  }

  const result = await backfillAccrualForOrder(orderId, "webhook");
  console.log(`[loyalty-backfill-worker] order=${orderId} ${JSON.stringify(result)}`);
  // Always 2xx for handled outcomes so QStash doesn't retry a clean skip.
  return NextResponse.json({ ok: true, result });
}

export const POST = verifySignatureAppRouter(handler);
