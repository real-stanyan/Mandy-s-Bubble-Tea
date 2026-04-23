import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/auth"
import { countDevicesForCustomer, getPassByCustomerId } from "@/lib/wallet/db"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const customerId = user.profile?.square_customer_id
  if (!customerId) return NextResponse.json({ added: false, issued: false })

  const pass = await getPassByCustomerId(customerId)
  if (!pass) return NextResponse.json({ added: false, issued: false })

  const devices = await countDevicesForCustomer(customerId)
  return NextResponse.json({ added: devices > 0, issued: true })
}
