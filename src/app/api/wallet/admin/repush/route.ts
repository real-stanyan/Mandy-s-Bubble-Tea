import { NextResponse } from "next/server"
import { isAuthedDriver } from "@/lib/driver-auth"
import { repushPass } from "@/lib/wallet/repush"

export const dynamic = "force-dynamic"

const MAX_SERIALS = 100

/**
 * Staff-only manual re-push. Given a list of pass serial numbers, touch each
 * pass and APNs-push its devices so Apple re-fetches a fresh pkpass. Used for
 * one-off fixes after a pass-data correction (the QStash worker only fires on
 * loyalty events). Reuses the shared STAFF_DELIVERY_TOKEN Bearer auth.
 */
export async function POST(request: Request) {
  const auth = isAuthedDriver(request)
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.reason === "unconfigured" ? 500 : 401 },
    )
  }

  const body = (await request.json().catch(() => null)) as
    | { serials?: unknown; pushType?: unknown }
    | null
  const serials = Array.isArray(body?.serials)
    ? body.serials.filter((s): s is string => typeof s === "string" && s.length > 0)
    : []
  // TEMP diagnostic: override apns-push-type ('alert'|'background'|'omit'|...)
  const pushType = typeof body?.pushType === "string" ? body.pushType : undefined

  if (serials.length === 0) {
    return NextResponse.json({ ok: false, reason: "no serials" }, { status: 400 })
  }
  if (serials.length > MAX_SERIALS) {
    return NextResponse.json(
      { ok: false, reason: `too many serials (max ${MAX_SERIALS})` },
      { status: 400 },
    )
  }

  const results = await Promise.all(
    serials.map(async (serial) => {
      try {
        return await repushPass(serial, pushType)
      } catch (e) {
        return { serial, pushed: 0, failures: [], error: (e as Error).message }
      }
    }),
  )

  return NextResponse.json({ ok: true, results })
}
