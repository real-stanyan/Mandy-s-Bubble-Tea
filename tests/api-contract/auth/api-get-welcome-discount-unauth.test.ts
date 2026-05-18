import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/welcome-discount/status [auth gate]', () => {
  it('returns available:false without session', async () => {
    const res = await apiCall('/api/welcome-discount/status')
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; available: boolean }
    expect(body.ok).toBe(true)
    expect(body.available).toBe(false)
  })
})
