import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'
import { createTestUser, supabaseAvailable, type TestUser } from '../_auth-fixture'

beforeAll(expectDevServerUp)

describe.skipIf(!supabaseAvailable)('POST /api/device-push-token [auth + validation]', () => {
  let user: TestUser

  beforeAll(async () => {
    user = await createTestUser()
  })

  afterAll(async () => {
    await user?.cleanup()
  })

  it('returns 401 without auth [TestBaseline:E1]', async () => {
    const res = await apiCall('/api/device-push-token', {
      method: 'POST',
      body: { token: 'fake-ios-token', platform: 'ios' },
    })
    expect(res.status).toBe(401)
  })

  it('upserts iOS APNs token [TestBaseline:E1]', async () => {
    const res = await apiCall('/api/device-push-token', {
      method: 'POST',
      bearer: user.accessToken,
      body: {
        token: `ios-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        platform: 'ios',
        appVersion: '1.1.2',
      },
    })
    expect(res.status).toBe(200)
  })

  it('upserts Android FCM token [TestBaseline:E3]', async () => {
    const res = await apiCall('/api/device-push-token', {
      method: 'POST',
      bearer: user.accessToken,
      body: {
        token: `android-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        platform: 'android',
        appVersion: '1.2.0',
      },
    })
    expect(res.status).toBe(200)
  })

  it('rejects platform="web" with 400', async () => {
    const res = await apiCall('/api/device-push-token', {
      method: 'POST',
      bearer: user.accessToken,
      body: { token: 'whatever-token', platform: 'web' },
    })
    expect(res.status).toBe(400)
    expect((res.body as { error?: string }).error).toMatch(/platform/i)
  })

  it('rejects missing token with 400', async () => {
    const res = await apiCall('/api/device-push-token', {
      method: 'POST',
      bearer: user.accessToken,
      body: { platform: 'ios' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects token > 512 chars with 400', async () => {
    const res = await apiCall('/api/device-push-token', {
      method: 'POST',
      bearer: user.accessToken,
      body: { token: 'x'.repeat(513), platform: 'ios' },
    })
    expect(res.status).toBe(400)
  })
})
