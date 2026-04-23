import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { PASS_BRAND } from './constants'

export interface StripOptions {
  stars: number        // 0..9 inclusive
  scale?: 1 | 2 | 3    // 1x, 2x, 3x
}

const BASE_W = 340  // pt
const BASE_H = 123  // pt

// Cup design mirrors components/brand/StarCupsRow.tsx in the RN app
// (viewBox 22x28: straw rect at y=5 + tapered cup body).
const CUP_VB_W = 22
const CUP_VB_H = 28

function drawCup(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filled: boolean,
) {
  const sx = w / CUP_VB_W
  const sy = h / CUP_VB_H
  const fillColor = PASS_BRAND.peach
  const strokeColor = filled
    ? 'rgba(255,255,255,0.9)'
    : 'rgba(255,255,255,0.55)'
  // Stroke width in viewBox units; counter-scale so it stays ~1.2pt on screen.
  const strokeVb = 1.2 / Math.min(sx, sy)

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(sx, sy)

  // Straw — small rounded rect across the top of the cup
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(2, 5, 18, 2.6, 1)
  } else {
    ctx.rect(2, 5, 18, 2.6)
  }
  if (filled) {
    ctx.fillStyle = fillColor
    ctx.fill()
  }
  ctx.lineWidth = strokeVb
  ctx.strokeStyle = strokeColor
  ctx.stroke()

  // Cup body — tapered trapezoid with rounded bottom corners
  ctx.beginPath()
  ctx.moveTo(3.4, 8)
  ctx.lineTo(18.6, 8)
  ctx.lineTo(17, 24)
  ctx.quadraticCurveTo(17, 26, 15, 26)
  ctx.lineTo(7, 26)
  ctx.quadraticCurveTo(5, 26, 5, 24)
  ctx.closePath()
  if (filled) {
    ctx.fillStyle = fillColor
    ctx.fill()
  }
  ctx.lineJoin = 'round'
  ctx.lineWidth = strokeVb
  ctx.strokeStyle = strokeColor
  ctx.stroke()

  ctx.restore()
}

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

  // Layout: 9 cups across, evenly distributed.
  const count = 9
  const edgePad = 14 * scale
  const totalGap = w - edgePad * 2
  const slot = totalGap / count
  // Cup size — keep the 22:28 aspect ratio, leave breathing room in the slot.
  const cupW = Math.min(slot - 6 * scale, (h - 24 * scale) * (CUP_VB_W / CUP_VB_H))
  const cupH = cupW * (CUP_VB_H / CUP_VB_W)
  const cyTop = (h - cupH) / 2

  for (let i = 0; i < count; i++) {
    const cxLeft = edgePad + i * slot + (slot - cupW) / 2
    const filled = i < opts.stars
    drawCup(ctx, cxLeft, cyTop, cupW, cupH, filled)
  }

  return Buffer.from(c.toBuffer('image/png'))
}
