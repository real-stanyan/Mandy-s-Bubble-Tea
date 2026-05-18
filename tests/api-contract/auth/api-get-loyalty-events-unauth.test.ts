import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/loyalty/events [auth gate]', () => {
  it('returns empty events without session', async () => {
    const res = await apiCall('/api/loyalty/events')
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; events: unknown[] }
    expect(body.ok).toBe(true)
    expect(body.events).toEqual([])
  })
})
