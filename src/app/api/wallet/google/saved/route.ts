import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/auth"
import { getPassByCustomerId, markGoogleSaved } from "@/lib/wallet/db"

export const dynamic = "force-dynamic"

/**
 * The App calls this when Google's save sheet returns RESULT_OK. It is the
 * fast path for the "Added to Google Wallet" state; `hasUsers` from Google is
 * the slow, authoritative one.
 */
export async function POST(request: Request) {
  const user = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const customerId = user.profile?.square_customer_id
  if (!customerId) return NextResponse.json({ error: "no Square customer linked" }, { status: 404 })

  const pass = await getPassByCustomerId(customerId)
  if (!pass || !pass.google_issued_at) {
    return NextResponse.json({ error: "card not issued" }, { status: 409 })
  }

  await markGoogleSaved(pass.serial_number)
  return NextResponse.json({ ok: true })
}
