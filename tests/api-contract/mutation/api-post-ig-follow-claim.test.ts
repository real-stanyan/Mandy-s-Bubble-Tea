import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/promotions/ig-follow/claim', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser()
  })

  afterAll(async () => {
    await user?.cleanup()
  })

  it('returns 401 without auth [TestBaseline:F2]', async () => {
    const res = await apiCall('/api/promotions/ig-follow/claim', { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns 404 "Profile incomplete" when authed user has no square_customer_id [TestBaseline:F2]', async () => {
    const res = await apiCall('/api/promotions/ig-follow/claim', {
      method: 'POST',
      bearer: user.accessToken,
    })
    expect(res.status).toBe(404)
    expect((res.body as { error?: string }).error).toMatch(/profile/i)
  })

  // Happy path "first claim → alreadyClaimed:false / second → true" requires
  // a user_profiles row with square_customer_id AND a Square sandbox customer.
  it.skip('first claim returns alreadyClaimed:false, second returns true [TestBaseline:F2 known-gap: needs profile + sandbox customer fixture]', () => {})
})
