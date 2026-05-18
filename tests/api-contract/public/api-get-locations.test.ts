import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/locations [public]', () => {
  it('returns at least one location with id', async () => {
    const res = await apiCall('/api/locations')
    expect(res.status).toBe(200)
    const body = res.body as { ok: boolean; locations: Array<{ id: string; name: string }> }
    expect(body.ok).toBe(true)
    expect(body.locations.length).toBeGreaterThan(0)
    expect(body.locations[0].id).toBeTruthy()
  })
})
