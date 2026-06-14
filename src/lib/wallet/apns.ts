import "server-only"
import http2 from "node:http2"
import { SignJWT, importPKCS8 } from "jose"
import { walletEnv } from "./env"

let cachedJwt: { token: string; expiresAt: number } | null = null

/** Decode literal \n from env vars back to real newlines. */
function decodePem(s: string): string {
  return s.replace(/\\n/g, '\n')
}

export async function buildApnsJwt(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedJwt && cachedJwt.expiresAt > now + 60) return cachedJwt.token

  const env = walletEnv()
  const key = await importPKCS8(decodePem(env.apnsAuthKey), 'ES256')
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.apnsKeyId })
    .setIssuer(env.teamId)
    .setIssuedAt(now)
    .sign(key)

  cachedJwt = { token, expiresAt: now + 3300 }  // 55 min
  return token
}

export interface PushResult {
  token: string
  status: number
  apnsId?: string
  reason?: string
}

export async function pushToAppleWallet(
  pushTokens: string[],
  pushType?: string, // TEMP diagnostic override; 'omit' drops the header entirely
): Promise<PushResult[]> {
  if (pushTokens.length === 0) return []
  const env = walletEnv()
  const jwt = await buildApnsJwt()
  const effectivePushType = pushType ?? 'alert'

  const client = http2.connect(`https://${env.apnsHost}`)
  try {
    return await Promise.all(
      pushTokens.map(
        (token) =>
          new Promise<PushResult>((resolve) => {
            const headers: Record<string, string> = {
              ':method': 'POST',
              ':path': `/3/device/${token}`,
              'apns-topic': env.passTypeId,
              authorization: `bearer ${jwt}`,
              'content-type': 'application/json',
            }
            if (effectivePushType !== 'omit') {
              headers['apns-push-type'] = effectivePushType
            }
            const req = client.request(headers)
            let status = 0
            let apnsId: string | undefined
            let chunks = ''
            req.on('response', (h) => {
              status = Number(h[':status'])
              const id = h['apns-id']
              if (typeof id === 'string') apnsId = id
            })
            req.on('data', (d) => { chunks += d.toString() })
            req.on('end', () => {
              let reason: string | undefined
              try { reason = chunks ? JSON.parse(chunks).reason : undefined } catch {}
              resolve({ token, status, apnsId, reason })
            })
            req.on('error', (err) => resolve({ token, status: 0, reason: err.message }))
            req.end('{}')
          }),
      ),
    )
  } finally {
    client.close()
  }
}
