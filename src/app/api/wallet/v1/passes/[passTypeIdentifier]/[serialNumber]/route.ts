import { verifyApplePassAuth } from "@/lib/wallet/auth"
import { getPassBySerial } from "@/lib/wallet/db"
import { buildPass } from "@/lib/wallet/pass"
import { fetchCustomerPassData } from "@/lib/wallet/customer"

export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ passTypeIdentifier: string; serialNumber: string }>
}

export async function GET(request: Request, ctx: Ctx) {
  const { serialNumber } = await ctx.params
  const ok = await verifyApplePassAuth(request.headers.get('authorization'), serialNumber)
  if (!ok) return new Response(null, { status: 401 })

  const pass = await getPassBySerial(serialNumber)
  if (!pass) return new Response(null, { status: 404 })

  const ims = request.headers.get('if-modified-since')
  if (ims) {
    const imsDate = new Date(ims)
    if (!isNaN(imsDate.getTime()) && new Date(pass.updated_at) <= imsDate) {
      return new Response(null, { status: 304 })
    }
  }

  const data = await fetchCustomerPassData(pass.customer_id)
  const buffer = await buildPass({
    serialNumber: pass.serial_number,
    authToken: pass.auth_token,
    memberNumber: pass.member_number,
    memberName: data.memberName,
    memberSince: data.memberSince,
    phoneE164: data.phoneE164,
    stars: data.stars,
    lifetimePoints: data.lifetimePoints,
    availableRewards: data.availableRewards,
  })

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': new Date(pass.updated_at).toUTCString(),
    },
  })
}
