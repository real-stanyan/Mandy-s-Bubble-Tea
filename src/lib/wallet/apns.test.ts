import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApnsJwt } from './apns'

describe('buildApnsJwt', () => {
  it('produces an ES256 JWT with iss=teamId and kid=keyId', async () => {
    const jwt = await buildApnsJwt()
    const parts = jwt.split('.')
    expect(parts.length).toBe(3)
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(process.env.APNS_KEY_ID)
    expect(payload.iss).toBe(process.env.APPLE_TEAM_ID)
    expect(payload.iat).toBeGreaterThan(0)
  })
})

// D4 — Validate the request shape Mandy sends to Apple Wallet APNs
// without doing real delivery. We mock node:http2 so connect()
// returns a controllable client; request() captures headers + we
// emit a fake 200 response.
//
// What this tests:
//   ✓ HTTP/2 :method POST to api.push.apple.com (or APNS_HOST)
//   ✓ :path is /3/device/<token>
//   ✓ apns-topic = APPLE_PASS_TYPE_ID
//   ✓ apns-push-type = "alert"
//   ✓ authorization = "bearer <JWT>" with valid ES256 signature
//   ✓ body is empty JSON object (Wallet push uses no payload)
//
// What this DOES NOT test (out of scope for path 3):
//   ✗ TLS handshake to Apple
//   ✗ Token validity (Apple-side)
//   ✗ End-to-end wallet pass refresh on device
const mockedHttp2 = {
  recordedHeaders: [] as Record<string, string>[],
  recordedBodies: [] as string[],
  reset() {
    this.recordedHeaders = []
    this.recordedBodies = []
  },
}

vi.mock('node:http2', () => ({
  default: {
    connect: () => ({
      request: (headers: Record<string, string>) => {
        const req = new EventEmitter() as EventEmitter & {
          end: (body: string) => void
        }
        mockedHttp2.recordedHeaders.push(headers)
        req.end = (body: string) => {
          mockedHttp2.recordedBodies.push(body)
          // Simulate Apple response.
          queueMicrotask(() => {
            req.emit('response', { ':status': 200, 'apns-id': 'mock-apns-id-' + headers[':path'].slice(-4) })
            req.emit('end')
          })
        }
        return req
      },
      close: () => undefined,
    }),
  },
}))

describe('pushToAppleWallet [TestBaseline:D4 — apns request shape]', () => {
  beforeEach(() => mockedHttp2.reset())

  it('builds correct HTTP/2 headers + body for each push token', async () => {
    // Re-import after mock is registered. apns module gets the mocked
    // node:http2 via the vi.mock hoist.
    const { pushToAppleWallet } = await import('./apns')

    const tokens = ['DEADBEEFCAFE1234', 'BAADC0DE99887766']
    const results = await pushToAppleWallet(tokens)

    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.status).toBe(200)
      expect(r.apnsId).toMatch(/^mock-apns-id-/)
    }

    expect(mockedHttp2.recordedHeaders.length).toBe(2)
    for (let i = 0; i < tokens.length; i++) {
      const headers = mockedHttp2.recordedHeaders[i]
      expect(headers[':method']).toBe('POST')
      expect(headers[':path']).toBe(`/3/device/${tokens[i]}`)
      expect(headers['apns-topic']).toBe(process.env.APPLE_PASS_TYPE_ID)
      expect(headers['apns-push-type']).toBe('alert')
      expect(headers['content-type']).toBe('application/json')
      // authorization: "bearer <JWT>"
      const auth = headers['authorization']
      expect(auth).toMatch(/^bearer /)
      const jwt = auth.replace(/^bearer /, '')
      const parts = jwt.split('.')
      expect(parts.length).toBe(3)
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
      expect(header.alg).toBe('ES256')
      expect(header.kid).toBe(process.env.APNS_KEY_ID)
      // Body is always empty JSON object for wallet update push.
      expect(mockedHttp2.recordedBodies[i]).toBe('{}')
    }
  })

  it('returns empty array on zero tokens (no http2 connection opened)', async () => {
    const { pushToAppleWallet } = await import('./apns')
    const r = await pushToAppleWallet([])
    expect(r).toEqual([])
    expect(mockedHttp2.recordedHeaders.length).toBe(0)
  })
})
