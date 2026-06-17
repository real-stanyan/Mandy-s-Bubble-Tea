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

  // passd polls this endpoint to refresh the pass. If the downstream Square
  // calls fail — most commonly RATE_LIMITED (429) under a poll burst — bubbling
  // a 500 makes the device retry aggressively and amplifies the rate-limit
  // storm. Instead, answer 304 (Not Modified): the device keeps its current
  // pass and backs off to its normal poll cadence. The error is logged for
  // Vercel/Sentry visibility but does not escalate.
  let buffer: Buffer
  try {
    const data = await fetchCustomerPassData(pass.customer_id)
    buffer = await buildPass({
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
  } catch (err) {
    console.error(
      `[wallet/pass] failed to build pass for serial=${serialNumber}; answering 304 to avoid retry storm`,
      err,
    )
    return new Response(null, { status: 304 })
  }

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': new Date(pass.updated_at).toUTCString(),
    },
  })
}
