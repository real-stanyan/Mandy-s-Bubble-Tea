import { verifyApplePassAuth } from "@/lib/wallet/auth"
import { registerDevice, unregisterDevice } from "@/lib/wallet/db"

export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{
    deviceLibraryIdentifier: string
    passTypeIdentifier: string
    serialNumber: string
  }>
}

export async function POST(request: Request, ctx: Ctx) {
  const { deviceLibraryIdentifier, serialNumber } = await ctx.params
  const ok = await verifyApplePassAuth(request.headers.get('authorization'), serialNumber)
  if (!ok) return new Response(null, { status: 401 })

  const body = (await request.json().catch(() => null)) as { pushToken?: string } | null
  if (!body?.pushToken) return new Response('missing pushToken', { status: 400 })

  const result = await registerDevice({
    deviceLibraryId: deviceLibraryIdentifier,
    serialNumber,
    pushToken: body.pushToken,
  })
  return new Response(null, { status: result === 'created' ? 201 : 200 })
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { deviceLibraryIdentifier, serialNumber } = await ctx.params
  const ok = await verifyApplePassAuth(request.headers.get('authorization'), serialNumber)
  if (!ok) return new Response(null, { status: 401 })

  await unregisterDevice({ deviceLibraryId: deviceLibraryIdentifier, serialNumber })
  return new Response(null, { status: 200 })
}
