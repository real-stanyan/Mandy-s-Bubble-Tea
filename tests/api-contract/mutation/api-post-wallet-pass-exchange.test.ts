import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { supabaseAvailable } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/wallet/pass/exchange [auth gate]', () => {
  it('returns 401 without auth [TestBaseline:D3]', async () => {
    const res = await apiCall('/api/wallet/pass/exchange', {
      method: 'POST',
      body: {},
    })
    expect(res.status).toBe(401)
  })

  it.skip('exchanges token and registers device [TestBaseline:D4 known-gap: needs Apple Pass cert + valid serial fixture]', () => {})
})
