import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/orders/[orderId]/complaint [gates]', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser()
  })

  afterAll(async () => {
    await user?.cleanup()
  })

  it('returns 401 NOT_AUTHENTICATED without auth [TestBaseline:H1]', async () => {
    const res = await apiCall('/api/orders/FAKE_ID/complaint', {
      method: 'POST',
      body: { description: 'test', photos: [] },
    })
    expect(res.status).toBe(401)
    expect((res.body as { error?: string }).error).toBe('NOT_AUTHENTICATED')
  })

  it('returns ORDER_NOT_FOUND for non-existent orderId [TestBaseline:H1]', async () => {
    const res = await apiCall('/api/orders/NONEXISTENT_ORDER_ID_XYZ/complaint', {
      method: 'POST',
      bearer: user.accessToken,
      body: { description: 'test description >10', photos: [] },
    })
    expect([404, 502]).toContain(res.status)
    expect((res.body as { error?: string }).error).toMatch(/NOT_FOUND|ORDER/i)
  })

  // 7-day window + ownership + dup + photo limit branches require a
  // sandbox order owned by the fixture user — not feasible without
  // profile + Square order fixture.
  it.skip('7-day window enforced [TestBaseline:H1, H2 known-gap]', () => {})
  it.skip('rejects when order not owned by user [TestBaseline:H2 known-gap]', () => {})
  it.skip('rejects duplicate complaint [TestBaseline:H4 known-gap]', () => {})
  it.skip('rejects >3 photos [TestBaseline:H3 known-gap]', () => {})
})
