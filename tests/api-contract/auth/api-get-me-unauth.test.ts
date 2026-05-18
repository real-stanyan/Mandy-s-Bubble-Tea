import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/me [auth gate]', () => {
  it('returns authed:false without session', async () => {
    const res = await apiCall('/api/me')
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; authed: boolean; profile: unknown }
    expect(body.ok).toBe(true)
    expect(body.authed).toBe(false)
    expect(body.profile).toBeNull()
  })
})
