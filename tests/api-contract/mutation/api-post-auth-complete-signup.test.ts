import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/auth/complete-signup [gates]', () => {
  it('returns 401 without auth [TestBaseline:B1]', async () => {
    const res = await apiCall('/api/auth/complete-signup', {
      method: 'POST',
      body: { firstName: 'Test', phone: '+61400000000' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects empty body with 400-class [TestBaseline:B1]', async () => {
    let user: TestUser | undefined
    try {
      user = await createTestUser()
      const res = await apiCall('/api/auth/complete-signup', {
        method: 'POST',
        bearer: user.accessToken,
        body: {},
      })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(res.status).toBeLessThan(500)
    } finally {
      await user?.cleanup()
    }
  })

  // Happy path "creates user_profiles + Square customer" requires:
  // 1. Valid AU phone E.164 (sandbox doesn't gate phone format strictly)
  // 2. Square sandbox customer creation succeeds
  // 3. Cleanup hook deletes both Supabase profile + Square customer
  // 4. Idempotent retry test needs second call to detect existing profile
  it.skip('creates user_profiles + Square customer + loyalty link [TestBaseline:B1 known-gap: needs Square customer cleanup + phone+name fixture]', () => {})
  it.skip('idempotent on retry [TestBaseline:B1 known-gap]', () => {})
})
