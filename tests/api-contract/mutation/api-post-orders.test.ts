import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/orders [gates]', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser()
  })

  afterAll(async () => {
    await user?.cleanup()
  })

  it('returns 401 without auth [TestBaseline:C1]', async () => {
    const res = await apiCall('/api/orders', {
      method: 'POST',
      body: { items: [] },
    })
    expect(res.status).toBe(401)
  })

  it('rejects empty cart with 400-class [TestBaseline:C1]', async () => {
    const res = await apiCall('/api/orders', {
      method: 'POST',
      bearer: user.accessToken,
      body: { items: [] },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('rejects malformed body with 400', async () => {
    const res = await apiCall('/api/orders', {
      method: 'POST',
      bearer: user.accessToken,
      body: { not_items: 'banana' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  // Happy path "creates Square sandbox order" requires:
  // 1. Live Square sandbox catalog item IDs (fetched at runtime)
  // 2. A user with user_profiles row + square_customer_id (no profile → 404 Profile incomplete)
  // 3. cleanup hook to void created sandbox orders
  it.skip('creates Square sandbox order [TestBaseline:C1 known-gap: needs profile + catalog-item-id fixture]', () => {})
  it.skip('rejects when pos_backup_mode=false and store closed [TestBaseline:I3 known-gap: needs time/store-status fixture]', () => {})
})
