import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/catalog/[id] [public]', () => {
  it('returns 404 for non-existent item id', async () => {
    const res = await apiCall('/api/catalog/NONEXISTENT_ID_XYZ_123')
    expect(res.status).toBe(404)
    const body = res.body as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
  })
})
