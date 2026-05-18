import { describe, it, expect } from 'vitest'

describe.skip('POST /api/orders [known-gap]', () => {
  it.skip('creates Square sandbox order [TestBaseline:C1, needs sandbox creds in .env.test]', () => {
    expect(true).toBe(true)
  })
  it.skip('rejects when pos_backup_mode=false and store closed [TestBaseline:I3]', () => {
    expect(true).toBe(true)
  })
})
