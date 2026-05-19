import { describe, it, expect, beforeAll } from 'vitest'
import { createHmac } from 'node:crypto'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

const SIG_KEY = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY
const NOTIFY_URL = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL
const envReady = Boolean(SIG_KEY && NOTIFY_URL)

function signSquareWebhook(body: string, url: string, key: string): string {
  return createHmac('sha256', key).update(url + body).digest('base64')
}

describe.skipIf(!envReady)('POST /api/webhooks/square [HMAC]', () => {
  it('returns 401 with no signature header [TestBaseline:C7]', async () => {
    const res = await apiCall('/api/webhooks/square', {
      method: 'POST',
      body: { type: 'customer.deleted', data: { id: 'fake' } },
    })
    expect(res.status).toBe(401)
    expect((res.body as { error?: string }).error).toMatch(/signature/i)
  })

  it('returns 401 with invalid signature [TestBaseline:C7]', async () => {
    const res = await apiCall('/api/webhooks/square', {
      method: 'POST',
      headers: { 'x-square-hmacsha256-signature': 'totally-bogus-base64-sig==' },
      body: { type: 'customer.deleted', data: { id: 'fake' } },
    })
    expect(res.status).toBe(401)
    expect((res.body as { error?: string }).error).toMatch(/signature/i)
  })

  it('accepts a correctly-signed customer.deleted payload [TestBaseline:C7]', async () => {
    const payload = {
      type: 'customer.deleted',
      event_id: `test-${Date.now()}`,
      created_at: new Date().toISOString(),
      data: {
        type: 'customer',
        id: 'NONEXISTENT_CUSTOMER_FOR_CONTRACT_TEST',
        deleted: true,
      },
    }
    const rawBody = JSON.stringify(payload)
    const sig = signSquareWebhook(rawBody, NOTIFY_URL!, SIG_KEY!)

    const res = await apiCall('/api/webhooks/square', {
      method: 'POST',
      headers: {
        'x-square-hmacsha256-signature': sig,
        'Content-Type': 'application/json',
      },
      body: payload,
    })

    // Signature valid → 200 even if customer not in our system (event was for a
    // customer we don't track, which is a no-op success).
    expect(res.status).toBe(200)
  })

  // Idempotency (replay same event_id → no double-handling) + push trigger
  // verification (LA push to test device) require fixtures + observability we
  // don't have at contract-test level.
  it.skip('idempotent on event_id replay [TestBaseline:C7 known-gap: needs replay log]', () => {})
  it.skip('order_fulfillment_updated → triggers la_update push [TestBaseline:E2 known-gap: needs APNs mock]', () => {})
})
