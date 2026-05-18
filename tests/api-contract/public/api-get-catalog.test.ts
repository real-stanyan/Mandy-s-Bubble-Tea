import { describe, it, expect, beforeAll } from 'vitest'
import { apiCall, expectDevServerUp } from '../_helpers'

beforeAll(expectDevServerUp)

describe('GET /api/catalog [public]', () => {
  it('returns Square catalog shape', async () => {
    const res = await apiCall('/api/catalog')
    expect(res.status).toBe(200)
    expect(res.body).toBeDefined()
  })

  it('BigInt serialized as string or number not Object', async () => {
    const res = await apiCall('/api/catalog')
    expect(res.text).not.toMatch(/BigInt\(/)
    expect(() => JSON.parse(res.text)).not.toThrow()
  })

  it('responds within 5s', async () => {
    const t0 = Date.now()
    await apiCall('/api/catalog')
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})
