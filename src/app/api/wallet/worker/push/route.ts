import { NextResponse } from "next/server"
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs"
import {
  bumpPassUpdatedAt,
  deleteDeviceByPushToken,
  getDevicePushTokens,
} from "@/lib/wallet/db"
import { pushToAppleWallet } from "@/lib/wallet/apns"

export const dynamic = 'force-dynamic'

async function handler(request: Request) {
  const body = (await request.json().catch(() => null)) as { serialNumber?: string } | null
  if (!body?.serialNumber) {
    return NextResponse.json({ ok: false, reason: 'missing serialNumber' }, { status: 400 })
  }

  await bumpPassUpdatedAt(body.serialNumber)
  const tokens = await getDevicePushTokens(body.serialNumber)
  const results = await pushToAppleWallet(tokens)

  for (const r of results) {
    if (r.status === 410) await deleteDeviceByPushToken(r.token)
  }

  const failures = results.filter((r) => r.status >= 500 || r.status === 429)
  if (failures.length > 0) {
    return NextResponse.json({ ok: false, failures }, { status: 500 })
  }
  return NextResponse.json({ ok: true, pushed: results.length })
}

export const POST = verifySignatureAppRouter(handler)
