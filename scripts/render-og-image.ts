// scripts/render-og-image.ts
// Builds public/og.jpg — the preview card people see when the site is shared
// in WhatsApp, Messenger, iMessage or an Instagram DM. There was no og:image
// at all before, so a shared link rendered as a bare grey box.
//
// JPEG on purpose: webp previews are unreliable across the chat apps that
// matter here, and this file is fetched by scrapers, not by the site.
//
// Run: npx tsx scripts/render-og-image.ts
import sharp from "sharp";
import { BRAND } from "../src/lib/constants";

// 1200×630 is the size every major scraper crops to (1.91:1).
const WIDTH = 1200;
const HEIGHT = 630;
const SOURCE = "public/home/hero-cups/1.webp";
const OUT = "public/og.jpg";

async function main() {
  // The cup art is square; fit it inside the card with room to breathe
  // rather than cropping the top off the drink.
  const cup = await sharp(SOURCE)
    .resize({ height: Math.round(HEIGHT * 0.92), fit: "inside" })
    .toBuffer();
  const cupMeta = await sharp(cup).metadata();

  const canvas = sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 3,
      background: BRAND.bgColor,
    },
  });

  await canvas
    .composite([
      {
        input: cup,
        top: Math.round((HEIGHT - (cupMeta.height ?? 0)) / 2),
        left: Math.round((WIDTH - (cupMeta.width ?? 0)) / 2),
      },
    ])
    .jpeg({ quality: 86, progressive: true })
    .toFile(OUT);

  const out = await sharp(OUT).metadata();
  console.log(`wrote ${OUT} — ${out.width}×${out.height}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
