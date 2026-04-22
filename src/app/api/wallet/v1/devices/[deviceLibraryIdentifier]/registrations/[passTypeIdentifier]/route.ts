import { NextResponse } from "next/server"
import { listSerialsForDevice } from "@/lib/wallet/db"

export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ deviceLibraryIdentifier: string; passTypeIdentifier: string }>
}

export async function GET(request: Request, ctx: Ctx) {
  const { deviceLibraryIdentifier } = await ctx.params
  const url = new URL(request.url)
  const passesUpdatedSince = url.searchParams.get('passesUpdatedSince') ?? undefined

  const { serials, lastUpdated } = await listSerialsForDevice(deviceLibraryIdentifier, passesUpdatedSince)
  if (serials.length === 0) return new Response(null, { status: 204 })
  return NextResponse.json({ lastUpdated, serialNumbers: serials })
}
