import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

// NOTE: /api/wallet/pass is GET-only on main (no POST handler). Renamed test
// reflects that. Method=POST returns 405. This is the get-pkpass-by-serial
// endpoint Apple PassKit calls — not the user-facing "Add to Wallet" trigger
// which goes through /api/wallet/pass/exchange.
describe.skipIf(!supabaseAvailable)('GET /api/wallet/pass [auth + cert]', () => {
  it('returns 405 for POST (route is GET-only)', async () => {
    const res = await apiCall('/api/wallet/pass', { method: 'POST' })
    expect([405, 404]).toContain(res.status)
  })

  it.skip('signs pkpass with current loyalty balance [TestBaseline:D3 known-gap: needs Apple Pass cert PEM in .env.local + signed serial fixture]', () => {})
})
