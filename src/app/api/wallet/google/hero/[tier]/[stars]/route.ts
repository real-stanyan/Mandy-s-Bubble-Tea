import { renderStrip } from "@/lib/wallet/strip"
import type { MembershipTier } from "@/lib/membership-tier"

export const dynamic = "force-dynamic"

// Google fetches a pass's hero image from a public URL and caches it by that
// URL, so tier and cycle progress are part of the path: a new balance is a
// new URL, never a stale image. The PNG is the same strip the Apple pass
// carries, at 3x (1020×369), which sits inside Google's 3:1 hero guidance.

const TIERS = new Set<MembershipTier>(["silver", "gold", "diamond"])

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ tier: string; stars: string }> },
) {
  const { tier, stars } = await ctx.params
  const n = Number(stars.replace(/\.png$/i, ""))
  if (!TIERS.has(tier as MembershipTier) || !Number.isInteger(n) || n < 0 || n > 9) {
    return new Response("not found", { status: 404 })
  }

  const png = await renderStrip({ tier: tier as MembershipTier, stars: n, scale: 3 })
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
