import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/auth"
import { isGoogleWalletConfigured } from "@/lib/wallet/google/env"
import { issueGoogleSave } from "@/lib/wallet/google/sync"

export const dynamic = "force-dynamic"

/**
 * App → POST with the Supabase bearer. Returns the "save to wallet" JWT for
 * Google's Android SDK plus the equivalent save link. 503 while the issuer
 * credentials are not configured so the client can hide the row.
 */
export async function POST(request: Request) {
  if (!isGoogleWalletConfigured()) {
    return NextResponse.json({ error: "google wallet not configured", available: false }, { status: 503 })
  }

  const user = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const customerId = user.profile?.square_customer_id
  if (!customerId) {
    return NextResponse.json({ error: "no Square customer linked" }, { status: 404 })
  }

  const issued = await issueGoogleSave(customerId)
  if (!issued) {
    return NextResponse.json({ error: "google wallet not configured", available: false }, { status: 503 })
  }
  return NextResponse.json(issued)
}
