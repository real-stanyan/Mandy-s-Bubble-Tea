export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { logs?: string[] } | null
  if (body?.logs?.length) {
    console.log('[wallet-log]', body.logs.join(' | '))
  }
  return new Response(null, { status: 200 })
}
