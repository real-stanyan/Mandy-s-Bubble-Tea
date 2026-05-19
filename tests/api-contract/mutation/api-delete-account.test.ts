import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/account/delete', () => {
  it('returns 401 without auth [TestBaseline:J1]', async () => {
    const res = await apiCall('/api/account/delete', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('deletes authed user, stale token loses auth [TestBaseline:J1, J2]', async () => {
    // Fresh fixture user (no profile, no Square customer — Square delete is best-effort)
    const user = await createTestUser()

    const del = await apiCall('/api/account/delete', {
      method: 'POST',
      bearer: user.accessToken,
    })
    expect(del.status).toBe(200)

    // Stale token should no longer authenticate
    const me = await apiCall('/api/me', { bearer: user.accessToken })
    expect(me.status).toBe(200)
    const body = me.body as { authed: boolean; profile: unknown }
    expect(body.authed).toBe(false)
    expect(body.profile).toBeNull()

    // cleanup() runs harmlessly — user already deleted server-side
    await user.cleanup()
  })
})
