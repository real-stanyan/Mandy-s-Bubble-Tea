import { describe, it, expect } from 'vitest'
import { TIER_PASS } from './constants'

describe('TIER_PASS', () => {
  it('defines all three tiers', () => {
    expect(Object.keys(TIER_PASS).sort()).toEqual(['diamond', 'gold', 'silver'])
  })

  it('each tier has solid rgb colors and strip art', () => {
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      const t = TIER_PASS[tier]
      expect(t.label).toMatch(/^(SILVER|GOLD|DIAMOND)$/)
      expect(t.backgroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(t.foregroundColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(t.labelColor).toMatch(/^rgb\(\d+, \d+, \d+\)$/)
      expect(t.strip.metal.length).toBeGreaterThanOrEqual(3)
      expect(t.strip.cupFill).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})
