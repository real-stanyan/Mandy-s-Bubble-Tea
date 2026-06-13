import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import type { MembershipTier } from '@/lib/membership-tier'
import { TIER_PASS, type TierStripArt } from './constants'

export interface StripOptions {
  tier: MembershipTier
  stars: number        // 0..9 inclusive
  scale?: 1 | 2 | 3    // 1x, 2x, 3x
}

const BASE_W = 340  // pt
const BASE_H = 123  // pt
const VIGNETTE_START = 0.5  // begins at vertical midpoint so cups stay clear
const VIGNETTE_ALPHA = 0.28 // max darkness at the bottom edge

// Cup design mirrors components/brand/StarCupsRow.tsx (viewBox 22x28).
const CUP_VB_W = 22
const CUP_VB_H = 28

function drawCup(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  filled: boolean,
  art: TierStripArt,
) {
  const sx = w / CUP_VB_W
  const sy = h / CUP_VB_H
  const strokeColor = filled ? art.cupStrokeFilled : art.cupStrokeEmpty
  const strokeVb = 1.2 / Math.min(sx, sy)

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(sx, sy)

  // Straw
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(2, 5, 18, 2.6, 1)
  } else {
    ctx.rect(2, 5, 18, 2.6)
  }
  if (filled) { ctx.fillStyle = art.cupFill; ctx.fill() }
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
  if (filled) { ctx.fillStyle = art.cupFill; ctx.fill() }
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
  const art = TIER_PASS[opts.tier].strip
  const scale = opts.scale ?? 3
  const w = BASE_W * scale
  const h = BASE_H * scale

  const c = createCanvas(w, h)
  const ctx = c.getContext('2d')

  // Base metal — diagonal gradient
  const metal = ctx.createLinearGradient(0, 0, w, h)
  for (const [off, col] of art.metal) metal.addColorStop(off, col)
  ctx.fillStyle = metal
  ctx.fillRect(0, 0, w, h)

  // Soft top sheen (key light from the top)
  const sheen = ctx.createLinearGradient(0, 0, 0, h)
  sheen.addColorStop(0, art.topHighlight)
  sheen.addColorStop(0.4, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, w, h)

  // Bottom vignette for depth (and so the solid card bg sits flush below)
  const vig = ctx.createLinearGradient(0, h * VIGNETTE_START, 0, h)
  vig.addColorStop(0, 'rgba(0,0,0,0)')
  vig.addColorStop(1, `rgba(0,0,0,${VIGNETTE_ALPHA})`)
  ctx.fillStyle = vig
  ctx.fillRect(0, 0, w, h)

  // Layout: 9 cups across, evenly distributed.
  const count = 9
  const edgePad = 14 * scale
  const totalGap = w - edgePad * 2
  const slot = totalGap / count
  const cupW = Math.min(slot - 6 * scale, (h - 24 * scale) * (CUP_VB_W / CUP_VB_H))
  const cupH = cupW * (CUP_VB_H / CUP_VB_W)
  const cyTop = (h - cupH) / 2

  for (let i = 0; i < count; i++) {
    const cxLeft = edgePad + i * slot + (slot - cupW) / 2
    drawCup(ctx, cxLeft, cyTop, cupW, cupH, i < opts.stars, art)
  }

  return Buffer.from(c.toBuffer('image/png'))
}
