import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/loyalty/redeem [gates]', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser()
  })

  afterAll(async () => {
    await user?.cleanup()
  })

  it('returns 401 without auth [TestBaseline:D1]', async () => {
    const res = await apiCall('/api/loyalty/redeem', {
      method: 'POST',
      body: { orderId: 'whatever' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects when authed user has no profile / loyalty account [TestBaseline:D1]', async () => {
    const res = await apiCall('/api/loyalty/redeem', {
      method: 'POST',
      bearer: user.accessToken,
      body: { orderId: 'FAKE_ORDER', count: 1 },
    })
    // Profile incomplete OR no loyalty account → 4xx
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it.skip('redeems 9 stars happy path [TestBaseline:D1 known-gap: needs 9-star fixture user + sandbox order]', () => {})
  it.skip('rejects when balance < 9 [TestBaseline:D1 known-gap: needs 0-star fixture user]', () => {})
})
