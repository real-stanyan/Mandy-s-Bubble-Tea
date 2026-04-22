import { NextResponse } from "next/server"
import { getAuthedUser } from "@/lib/auth"
import { issueExchangeToken, issuePass } from "@/lib/wallet/db"
import { walletEnv } from "@/lib/wallet/env"

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const user = await getAuthedUser(request)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const customerId = user.profile?.square_customer_id
  if (!customerId) {
    return NextResponse.json(
      { error: 'no Square customer linked' },
      { status: 404 },
    )
  }

  await issuePass({ customerId, passTypeId: walletEnv().passTypeId })
  const { token, expiresAt } = await issueExchangeToken(customerId)

  return NextResponse.json({ token, expiresAt: expiresAt.toISOString() })
}
