import { describe, it, expect } from 'vitest'
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
