import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/auth"
import { googleCardStatus } from "@/lib/wallet/google/sync"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const customerId = user.profile?.square_customer_id
  if (!customerId) return NextResponse.json({ available: false, issued: false, added: false })

  return NextResponse.json(await googleCardStatus(customerId))
}
