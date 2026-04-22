import { createCanvas } from '@napi-rs/canvas'
import { PASS_BRAND } from './constants'

export interface StripOptions {
  stars: number        // 0..9 inclusive
  scale?: 1 | 2 | 3    // 1x, 2x, 3x
}

const BASE_W = 340  // pt
const BASE_H = 123  // pt

export async function renderStrip(opts: StripOptions): Promise<Buffer> {
  if (!Number.isInteger(opts.stars) || opts.stars < 0 || opts.stars > 9) {
    throw new Error(`renderStrip: stars must be integer in [0,9], got ${opts.stars}`)
  }
  const scale = opts.scale ?? 3
  const w = BASE_W * scale
  const h = BASE_H * scale

  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')

  ctx.fillStyle = PASS_BRAND.brown
  ctx.fillRect(0, 0, w, h)

  const count = 9
  const edgePad = 12 * scale
  const totalGap = w - edgePad * 2
  const circleD = Math.min(totalGap / count - 6 * scale, h - 24 * scale)
  const circleR = circleD / 2
  const gap = (totalGap - circleD * count) / (count - 1)
  const cy = h / 2

  for (let i = 0; i < count; i++) {
    const cx = edgePad + circleR + i * (circleD + gap)
    const on = i < opts.stars

    if (on) {
      ctx.fillStyle = PASS_BRAND.cream
      ctx.beginPath()
      ctx.arc(cx, cy, circleR, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1.5 * scale
      ctx.setLineDash([4 * scale, 3 * scale])
      ctx.beginPath()
      ctx.arc(cx, cy, circleR - ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  return Buffer.from(c.toBuffer('image/png'))
}
