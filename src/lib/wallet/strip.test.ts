import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { renderStrip } from './strip'

describe('renderStrip', () => {
  it('produces PNG buffer for 0 filled stars', async () => {
    const buf = await renderStrip({ tier: 'silver', stars: 0, scale: 1 })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(1000)
    expect(buf.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a') // PNG magic
  })

  it('produces different PNGs for different star counts', async () => {
    const a = await renderStrip({ tier: 'silver', stars: 3, scale: 1 })
    const b = await renderStrip({ tier: 'silver', stars: 7, scale: 1 })
    expect(a.equals(b)).toBe(false)
  })

  it('at @3x returns 1020x369 canvas', async () => {
    const buf = await renderStrip({ tier: 'silver', stars: 5, scale: 3 })
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    expect(width).toBe(1020)
    expect(height).toBe(369)
  })

  it('rejects invalid star count', async () => {
    await expect(renderStrip({ tier: 'silver', stars: 10, scale: 1 })).rejects.toThrow()
    await expect(renderStrip({ tier: 'silver', stars: -1, scale: 1 })).rejects.toThrow()
  })

  it('renders a valid PNG for every tier', async () => {
    for (const tier of ['silver', 'gold', 'diamond'] as const) {
      const buf = await renderStrip({ tier, stars: 5, scale: 1 })
      expect(buf.slice(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect(buf.length).toBeGreaterThan(1000)
    }
  })

  it('produces different PNGs per tier (metal differs)', async () => {
    const silver = await renderStrip({ tier: 'silver', stars: 5, scale: 1 })
    const gold = await renderStrip({ tier: 'gold', stars: 5, scale: 1 })
    const diamond = await renderStrip({ tier: 'diamond', stars: 5, scale: 1 })
    expect(silver.equals(gold)).toBe(false)
    expect(gold.equals(diamond)).toBe(false)
  })

})

describe('renderStrip golden images', () => {
  const FIXTURES = path.join(__dirname, '__fixtures__')
  const TIERS = ['silver', 'gold', 'diamond'] as const
  const cases = TIERS.flatMap((tier) => [0, 3, 7, 9].map((stars) => [tier, stars] as const))

  it.each(cases)('matches golden for %s stars=%i', async (tier, stars) => {
    const actualBuf = await renderStrip({ tier, stars, scale: 1 })
    const goldenPath = path.join(FIXTURES, `strip-${tier}-${stars}.png`)
    if (!fs.existsSync(goldenPath)) {
      fs.writeFileSync(goldenPath, actualBuf)
      console.warn(`wrote baseline: ${goldenPath}`)
      return
    }
    const actual = PNG.sync.read(actualBuf)
    const golden = PNG.sync.read(fs.readFileSync(goldenPath))
    expect(actual.width).toBe(golden.width)
    expect(actual.height).toBe(golden.height)
    const diff = new PNG({ width: actual.width, height: actual.height })
    const mismatch = pixelmatch(actual.data, golden.data, diff.data, actual.width, actual.height, { threshold: 0.1 })
    expect(mismatch).toBe(0)
  })
})
