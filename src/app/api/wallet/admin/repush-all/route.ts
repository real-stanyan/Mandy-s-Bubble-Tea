import { NextResponse } from "next/server"
import { Client as QStashClient } from "@upstash/qstash"
import { isAuthedDriver } from "@/lib/driver-auth"
import { listAllPassSerials } from "@/lib/wallet/db"
import { walletEnv } from "@/lib/wallet/env"

export const dynamic = "force-dynamic"

/**
 * Staff-only bulk re-push. Fans out a QStash job per existing pass serial to
 * the shared worker (which bumps updated_at + APNs-pushes each card's devices),
 * so every member card re-fetches a fresh pkpass — used after a design change
 * that the per-customer loyalty webhook would otherwise roll out only gradually.
 *
 * Dry-run by default: returns the total without enqueuing. Pass {"apply": true}
 * to actually fan out, so an accidental probe never triggers an APNs storm.
 */
export async function POST(request: Request) {
  const auth = isAuthedDriver(request)
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, reason: auth.reason },
      { status: auth.reason === "unconfigured" ? 500 : 401 },
    )
  }

  const body = (await request.json().catch(() => null)) as { apply?: unknown } | null
  const apply = body?.apply === true

  const serials = await listAllPassSerials()

  if (!apply) {
    return NextResponse.json({ ok: true, dryRun: true, total: serials.length, enqueued: 0 })
  }

  const env = walletEnv()
  const qstash = new QStashClient({ token: env.qstashToken, baseUrl: env.qstashUrl })
  const workerUrl = `${env.webServiceUrl.replace(/\/api\/wallet\/?$/, "")}/api/wallet/worker/push`

  let enqueued = 0
  const failures: { serial: string; error: string }[] = []
  for (const serial of serials) {
    try {
      await qstash.publishJSON({ url: workerUrl, body: { serialNumber: serial }, retries: 3 })
      enqueued++
    } catch (e) {
      failures.push({ serial, error: (e as Error).message })
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    dryRun: false,
    total: serials.length,
    enqueued,
    failures,
  })
}
