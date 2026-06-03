import { NextResponse } from "next/server"
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs"
import { repushPass } from "@/lib/wallet/repush"

export const dynamic = 'force-dynamic'

async function handler(request: Request) {
  const body = (await request.json().catch(() => null)) as { serialNumber?: string } | null
  if (!body?.serialNumber) {
    return NextResponse.json({ ok: false, reason: 'missing serialNumber' }, { status: 400 })
  }

  const { pushed, failures } = await repushPass(body.serialNumber)
  if (failures.length > 0) {
    return NextResponse.json({ ok: false, failures }, { status: 500 })
  }
  return NextResponse.json({ ok: true, pushed })
}

export const POST = verifySignatureAppRouter(handler)
