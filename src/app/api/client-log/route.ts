import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Lightweight sink for client-side errors that are otherwise invisible
// server-side — e.g. Square Web/In-App Payments SDK tokenize/verifyBuyer
// failures that never reach /api/payment. The client POSTs a small JSON
// blob; we console.error it with a greppable prefix so it surfaces in
// Vercel runtime logs (`vercel logs … | grep client-error`).
//
// Intentionally unauthenticated and best-effort: it only logs, never
// mutates state. Body is hard-capped so a bad actor can't flood logs.
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const capped = raw.slice(0, 4000);
    console.error(`[client-error] ${capped}`);
  } catch {
    // ignore — logging must never throw
  }
  return NextResponse.json({ ok: true });
}
