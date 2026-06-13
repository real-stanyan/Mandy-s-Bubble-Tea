import "server-only"
import fs from "node:fs/promises"
import path from "node:path"
import { PKPass } from "passkit-generator"
import { tierProgress } from "@/lib/membership-tier"
import { walletEnv } from "./env"
import { renderStrip } from "./strip"
import { TIER_PASS, PASS_TERMS, STORE_INFO } from "./constants"

export interface BuildPassInput {
  serialNumber: string
  authToken: string
  memberNumber: string
  memberName: string
  memberSince: string
  phoneE164: string      // QR payload — matches app/web so POS reads any card
  stars: number          // current cycle progress (drives strip), = balance % goal
  totalStars: number     // current loyalty balance
  lifetimePoints: number // cumulative earned — drives membership tier
  availableRewards: number
}

const ASSETS_DIR = path.join(process.cwd(), 'assets', 'wallet')
const GOAL = 9

async function readAsset(name: string): Promise<Buffer> {
  return fs.readFile(path.join(ASSETS_DIR, name))
}

/** PEM strings from env vars have literal \n — convert to real newlines */
function decodePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}

export async function buildPass(input: BuildPassInput): Promise<Buffer> {
  const env = walletEnv()
  const { tier, nextTier, starsToNext } = tierProgress(input.lifetimePoints)
  const visual = TIER_PASS[tier]

  // Fetch all buffers concurrently
  const [icon, icon2x, icon3x, logo, logo2x, logo3x, strip, strip2x, strip3x] =
    await Promise.all([
      readAsset('icon.png'),
      readAsset('icon@2x.png'),
      readAsset('icon@3x.png'),
      readAsset('logo.png'),
      readAsset('logo@2x.png'),
      readAsset('logo@3x.png'),
      renderStrip({ tier, stars: input.stars, scale: 1 }),
      renderStrip({ tier, stars: input.stars, scale: 2 }),
      renderStrip({ tier, stars: input.stars, scale: 3 }),
    ])

  const certs = {
    wwdr: decodePem(env.wwdrPem),
    signerCert: decodePem(env.certPem),
    signerKey: decodePem(env.keyPem),
    signerKeyPassphrase: env.keyPassphrase,
  }

  // Pass type must be set before pass.json is added (addBuffer triggers import).
  const pass = new PKPass({}, certs)
  pass.type = 'storeCard'

  pass.addBuffer('pass.json', Buffer.from(JSON.stringify(buildPassJson(input, env, { tier, nextTier, starsToNext, visual }))))
  pass.addBuffer('icon.png', icon)
  pass.addBuffer('icon@2x.png', icon2x)
  pass.addBuffer('icon@3x.png', icon3x)
  pass.addBuffer('logo.png', logo)
  pass.addBuffer('logo@2x.png', logo2x)
  pass.addBuffer('logo@3x.png', logo3x)
  pass.addBuffer('strip.png', strip)
  pass.addBuffer('strip@2x.png', strip2x)
  pass.addBuffer('strip@3x.png', strip3x)

  pass.setBarcodes({
    format: 'PKBarcodeFormatQR',
    message: input.phoneE164,
    messageEncoding: 'iso-8859-1',
    altText: input.memberNumber,
  })

  return pass.getAsBuffer()
}

type TierCtx = {
  tier: ReturnType<typeof tierProgress>["tier"]
  nextTier: ReturnType<typeof tierProgress>["nextTier"]
  starsToNext: ReturnType<typeof tierProgress>["starsToNext"]
  visual: (typeof TIER_PASS)[keyof typeof TIER_PASS]
}

function titleCase(t: "gold" | "diamond"): string {
  return t === "gold" ? "Gold" : "Diamond"
}

function buildPassJson(
  i: BuildPassInput,
  env: ReturnType<typeof walletEnv>,
  ctx: TierCtx,
) {
  const currentStars = ((i.stars % GOAL) + GOAL) % GOAL
  const toGo = Math.max(0, GOAL - currentStars)
  const rewardText = i.availableRewards > 0 ? 'Ready to redeem!' : `${toGo} stars to go`

  // Status line: silver/gold count toward the next tier; diamond is static.
  const statusField =
    ctx.tier === 'diamond' || ctx.nextTier == null || ctx.starsToNext == null
      ? { key: 'status', label: 'STATUS', value: 'Top tier member', textAlignment: 'PKTextAlignmentRight' }
      : { key: 'status', label: 'NEXT TIER', value: `${ctx.starsToNext} to ${titleCase(ctx.nextTier)}`, textAlignment: 'PKTextAlignmentRight' }

  const backFields: Record<string, unknown>[] = [
    { key: 'terms', label: 'Terms', value: PASS_TERMS },
    { key: 'store', label: 'Store', value: STORE_INFO.address },
    { key: 'phone', label: 'Phone', value: STORE_INFO.phone },
    { key: 'hours', label: 'Hours', value: STORE_INFO.hours },
    { key: 'website', label: 'Website', value: STORE_INFO.website },
    { key: 'id', label: 'Member ID', value: i.memberNumber },
    { key: 'since', label: 'Member since', value: i.memberSince },
  ]
  if (ctx.tier === 'diamond') {
    backFields.push({ key: 'perks', label: 'Diamond perks', value: '5% off all orders + free toppings each month' })
  }

  return {
    formatVersion: 1,
    passTypeIdentifier: env.passTypeId,
    serialNumber: i.serialNumber,
    teamIdentifier: env.teamId,
    organizationName: "Mandy's Bubble Tea",
    description: "Mandy's Member Card",
    webServiceURL: env.webServiceUrl,
    authenticationToken: i.authToken,
    backgroundColor: ctx.visual.backgroundColor,
    foregroundColor: ctx.visual.foregroundColor,
    labelColor: ctx.visual.labelColor,
    storeCard: {
      headerFields: [
        { key: 'tier', label: 'TIER', value: ctx.visual.label, textAlignment: 'PKTextAlignmentRight' },
      ],
      primaryFields: [],
      secondaryFields: [
        { key: 'member', label: 'MEMBER', value: i.memberName },
        { key: 'progress', label: 'STARS', value: `${currentStars}/${GOAL}`, textAlignment: 'PKTextAlignmentRight' },
      ],
      auxiliaryFields: [
        { key: 'reward', label: 'NEXT REWARD', value: rewardText },
        statusField,
      ],
      backFields,
    },
  }
}
