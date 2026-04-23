import { NextResponse } from "next/server"
import { listSerialsForDevice } from "@/lib/wallet/db"

export const dynamic = 'force-dynamic'

interface Ctx {
  params: Promise<{ deviceLibraryIdentifier: string; passTypeIdentifier: string }>
}

export async function GET(request: Request, ctx: Ctx) {
  const { deviceLibraryIdentifier } = await ctx.params
  const url = new URL(request.url)
  // URLSearchParams decodes `+` as space. Apple echoes back the `lastUpdated`
  // we issued — an ISO 8601 string with `+00:00` — so we must restore the `+`
  // before passing it to Postgres as a timestamptz.
  const passesUpdatedSince = url.searchParams.get('passesUpdatedSince')?.replace(/ /g, '+') ?? undefined

  const { serials, lastUpdated } = await listSerialsForDevice(deviceLibraryIdentifier, passesUpdatedSince)
  if (serials.length === 0) return new Response(null, { status: 204 })
  return NextResponse.json({ lastUpdated, serialNumbers: serials })
}
