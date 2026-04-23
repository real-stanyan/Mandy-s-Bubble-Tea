// scripts/render-wallet-assets.ts
// Renders pass logo and icon assets from the Claude Design Logomark SVG.
// Outputs to assets/wallet/.
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'

const BROWN = '#8D5524'
const WHITE = '#FFFFFF'

const OUT = path.join(process.cwd(), 'assets', 'wallet')

function logomarkSvg(color: string, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none">
  <path d="M7.5 9.5h17l-1.6 18a2 2 0 01-2 1.8H11.1a2 2 0 01-2-1.8L7.5 9.5z" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M6 9.5h20" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M17.5 4.5l-2 7" stroke="${color}" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="13" cy="24" r="1.2" fill="${color}"/>
  <circle cx="17" cy="25" r="1.2" fill="${color}"/>
  <circle cx="20.5" cy="23.5" r="1.2" fill="${color}"/>
  <circle cx="14.5" cy="21" r="1.2" fill="${color}"/>
  <circle cx="18.5" cy="21" r="1.2" fill="${color}"/>
</svg>`
}

// icon = brown square with white logomark centered
async function renderIcon(sizePt: number, outName: string) {
  const glyphSvg = logomarkSvg(WHITE, sizePt)
  const glyphPng = await sharp(Buffer.from(glyphSvg)).png().toBuffer()
  await sharp({
    create: {
      width: sizePt,
      height: sizePt,
      channels: 4,
      background: BROWN,
    },
  })
    .composite([{ input: glyphPng, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT, outName))
}

// logo = transparent 160x50 canvas, "Mandy's" wordmark left-aligned, sized so
// the rendered text fits inside ~100pt (Apple's effective logo slot when a
// headerField is present is ~110pt, so we leave margin).
async function renderLogo(widthPt: number, heightPt: number, outName: string) {
  const fontSize = Math.round(heightPt * 0.56) // ~28pt at 1x height 50
  const wordmarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPt}" height="${heightPt}">
    <text x="0" y="${Math.round(heightPt * 0.72)}" font-family="Georgia, serif" font-weight="700" font-size="${fontSize}" fill="${WHITE}">Mandy&apos;s</text>
  </svg>`
  const wordmarkPng = await sharp(Buffer.from(wordmarkSvg)).png().toBuffer()

  await sharp({
    create: {
      width: widthPt,
      height: heightPt,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: wordmarkPng, left: 0, top: 0 }])
    .png()
    .toFile(path.join(OUT, outName))
}

async function main() {
  await fs.mkdir(OUT, { recursive: true })
  // Icons: 29 pt base, 1x/2x/3x
  await renderIcon(29, 'icon.png')
  await renderIcon(58, 'icon@2x.png')
  await renderIcon(87, 'icon@3x.png')
  // Logos: 160x50 pt base
  await renderLogo(160, 50, 'logo.png')
  await renderLogo(320, 100, 'logo@2x.png')
  await renderLogo(480, 150, 'logo@3x.png')
  console.log('wallet assets rendered to', OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
