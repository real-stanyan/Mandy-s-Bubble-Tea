import { consumeExchangeToken, getPassByCustomerId } from "@/lib/wallet/db"
import { buildPass } from "@/lib/wallet/pass"
import { fetchCustomerPassData } from "@/lib/wallet/customer"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) return new Response('missing token', { status: 400 })

  const customerId = await consumeExchangeToken(token)
  if (!customerId) return new Response('invalid or expired token', { status: 403 })

  const pass = await getPassByCustomerId(customerId)
  if (!pass) return new Response('pass not issued', { status: 500 })

  const data = await fetchCustomerPassData(customerId)
  const buffer = await buildPass({
    serialNumber: pass.serial_number,
    authToken: pass.auth_token,
    memberNumber: pass.member_number,
    memberName: data.memberName,
    memberSince: data.memberSince,
    stars: data.stars,
    availableRewards: data.availableRewards,
  })

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="mandys-member-${pass.member_number}.pkpass"`,
      'Cache-Control': 'no-store',
    },
  })
}
