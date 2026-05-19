import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/payment [auth gate]', () => {
  let user: TestUser
  beforeAll(async () => {
    user = await createTestUser()
  })
  afterAll(async () => {
    await user?.cleanup()
  })

  it('returns 401 without auth [TestBaseline:C1]', async () => {
    const res = await apiCall('/api/payment', {
      method: 'POST',
      body: { sourceId: 'cnon:fake', orderId: 'fake', amount: 100 },
    })
    expect(res.status).toBe(401)
  })

  it('rejects malformed body with 400-class [TestBaseline:C1]', async () => {
    const res = await apiCall('/api/payment', {
      method: 'POST',
      bearer: user.accessToken,
      body: {},
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  // Happy path requires a Square Web Payments SDK browser-side tokenization
  // step (card → nonce) which can't easily be reproduced server-side without
  // an automated browser. This is intentionally left as known-gap until
  // Playwright wires up Square sandbox card tokenization end-to-end.
  it.skip('charges Square sandbox card 4111… [TestBaseline:C1 known-gap: needs Playwright + Square Web Payments SDK browser]', () => {})
  it.skip('rejects duplicate nonce [TestBaseline:C6 known-gap]', () => {})
})
