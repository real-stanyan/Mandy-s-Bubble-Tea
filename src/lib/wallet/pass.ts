import "server-only"
import fs from "node:fs/promises"
import path from "node:path"
import { PKPass } from "passkit-generator"
import { walletEnv } from "./env"
import { renderStrip } from "./strip"
import {
  PASS_BG_RGB,
  PASS_FG_RGB,
  PASS_LABEL_RGB,
  PASS_TERMS,
  STORE_INFO,
} from "./constants"

export interface BuildPassInput {
  serialNumber: string
  authToken: string
  memberNumber: string
  memberName: string
  memberSince: string
  stars: number
  availableRewards: number
}

const ASSETS_DIR = path.join(process.cwd(), 'assets', 'wallet')

async function readAsset(name: string): Promise<Buffer> {
  return fs.readFile(path.join(ASSETS_DIR, name))
}

/** PEM strings from env vars have literal \n — convert to real newlines */
function decodePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}

export async function buildPass(input: BuildPassInput): Promise<Buffer> {
  const env = walletEnv()

  // Fetch all buffers concurrently
  const [icon, icon2x, icon3x, logo, logo2x, logo3x, strip, strip2x, strip3x] =
    await Promise.all([
      readAsset('icon.png'),
      readAsset('icon@2x.png'),
      readAsset('icon@3x.png'),
      readAsset('logo.png'),
      readAsset('logo@2x.png'),
      readAsset('logo@3x.png'),
      renderStrip({ stars: input.stars, scale: 1 }),
      renderStrip({ stars: input.stars, scale: 2 }),
      renderStrip({ stars: input.stars, scale: 3 }),
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

  pass.addBuffer('pass.json', Buffer.from(JSON.stringify(buildPassJson(input, env))))
  pass.addBuffer('icon.png', icon)
  pass.addBuffer('icon@2x.png', icon2x)
  pass.addBuffer('icon@3x.png', icon3x)
  pass.addBuffer('logo.png', logo)
  pass.addBuffer('logo@2x.png', logo2x)
  pass.addBuffer('logo@3x.png', logo3x)
  pass.addBuffer('strip.png', strip)
  pass.addBuffer('strip@2x.png', strip2x)
  pass.addBuffer('strip@3x.png', strip3x)

  return pass.getAsBuffer()
}

function buildPassJson(i: BuildPassInput, env: ReturnType<typeof walletEnv>) {
  const rewardText = i.availableRewards > 0 ? 'Ready to redeem!' : 'Free drink'
  return {
    formatVersion: 1,
    passTypeIdentifier: env.passTypeId,
    serialNumber: i.serialNumber,
    teamIdentifier: env.teamId,
    organizationName: "Mandy's Bubble Tea",
    description: "Mandy's Member Card",
    webServiceURL: env.webServiceUrl,
    authenticationToken: i.authToken,
    backgroundColor: PASS_BG_RGB,
    foregroundColor: PASS_FG_RGB,
    labelColor: PASS_LABEL_RGB,
    logoText: "Mandy's",
    storeCard: {
      headerFields: [
        { key: 'stars', label: 'STARS', value: `${i.stars}/9`, textAlignment: 'PKTextAlignmentRight' },
      ],
      primaryFields: [
        { key: 'member', label: 'MEMBER', value: i.memberName },
      ],
      secondaryFields: [
        { key: 'reward', label: 'NEXT REWARD', value: rewardText },
        { key: 'since', label: 'MEMBER SINCE', value: i.memberSince },
        { key: 'id', label: 'ID', value: i.memberNumber, textAlignment: 'PKTextAlignmentRight' },
      ],
      backFields: [
        { key: 'terms', label: 'Terms', value: PASS_TERMS },
        { key: 'store', label: 'Store', value: STORE_INFO.address },
        { key: 'phone', label: 'Phone', value: STORE_INFO.phone },
        { key: 'hours', label: 'Hours', value: STORE_INFO.hours },
        { key: 'website', label: 'Website', value: STORE_INFO.website },
      ],
      barcodes: [
        {
          format: 'PKBarcodeFormatQR',
          message: i.serialNumber,
          messageEncoding: 'iso-8859-1',
          altText: i.memberNumber,
        },
      ],
    },
  }
}
