// scripts/render-label-preview.ts
//
// Batch-renders `previewPng` (the pixel-perfect ZD410 composite that
// mirrors what the printer would lay down) for every gallery sticker
// and writes them to ~/Desktop/label-previews/. Each preview pairs
// the sticker with a deterministically-randomised cart context (drink
// name, modifiers, sticker number, cup x of y, customer first name)
// so the batch shows realistic variety without flakiness.
//
//   NODE_OPTIONS="--conditions=react-server" pnpm tsx scripts/render-label-preview.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { renderCupLabel } from "../src/lib/cup-label/render-zebra-cup";

const GALLERY_DIR = join(process.cwd(), "public", "cup-label", "gallery");
const OUT_DIR = join(homedir(), "Desktop", "label-previews");

const DRINKS = [
  "Brown Sugar Milk Tea Frappe",
  "Strawberry Iced Tea",
  "Mango Milk Tea",
  "Lemon Slushy",
  "Strawberry Milkshake",
  "Earl Grey Milk Tea",
  "Taro Milk Tea",
  "Matcha Latte",
  "Jasmine Green Milk Tea",
  "Coffee Milk Tea",
  "Coconut Milk Tea",
  "Peach Iced Tea",
  "Mango Cheese Foam",
  "Strawberry Cheese Cream",
  "Lychee Slushy",
  "Orange Slushy",
  "Passion Fruit Iced Tea",
  "Thai Milk Tea",
];

const SIZES = ["Regular", "Large"];
const SUGARS = ["No Sugar", "30% Sugar", "50% Sugar", "70% Sugar", "Standard Sugar"];
const ICES = ["No Ice", "Less Ice", "Normal Ice", "Extra Ice"];
const TOPPINGS = [
  "Pearl",
  "Coconut Jelly",
  "Aloe Vera",
  "Pudding",
  "Lychee Jelly",
  "Strawberry Boba",
  "Mango Star",
  "Cheese Foam",
];
const NAMES = [
  "Stan", "Mandy", "Alice", "Ben", "Chloe", "Dave",
  "Ella", "Frank", "Grace", "Henry", "Iris", "Jack",
  "Kate", "Leo", "Mia", "Nick", "Olivia", "Paul", "Guest",
];

function pick<T>(arr: T[], idx: number): T {
  return arr[idx % arr.length];
}

function modifiersFor(idx: number): string {
  const size = pick(SIZES, idx);
  const sugar = pick(SUGARS, Math.floor(idx / 2));
  const ice = pick(ICES, Math.floor(idx / 3));
  const topping1 = pick(TOPPINGS, idx);
  const topping2 = pick(TOPPINGS, Math.floor(idx * 1.7));
  const includeIce = idx % 3 !== 0;
  const includeT2 = idx % 4 === 0;
  const tail = includeT2 && topping1 !== topping2 ? `+${topping1}+${topping2}` : `+${topping1}`;
  return `${size} -> ${sugar}${includeIce ? ` + ${ice}` : ""} ${tail}`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const manifestPath = join(GALLERY_DIR, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { hashes: string[] };
  const hashes = manifest.hashes;
  console.log(`[preview] ${hashes.length} hashes → ${OUT_DIR}`);

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i];
    const stickerNumber = `OL${String(i + 1).padStart(3, "0")}`;
    const drinkName = pick(DRINKS, i);
    const modifiersText = modifiersFor(i);
    const cupTotal = (i % 3) + 1;
    const cupIdx = (i % cupTotal) + 1;
    const customerFirstName = pick(NAMES, i);

    try {
      const doodleBuf = await readFile(join(GALLERY_DIR, hash, "binarized.png"));
      const { previewPng } = await renderCupLabel({
        stickerNumber,
        cupIdxOf: { idx: cupIdx, total: cupTotal },
        drinkName,
        modifiersText,
        doodleSvg: "",
        doodlePngBuffer: doodleBuf,
        customerFirstName,
      });
      const safeHash = hash.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
      const outName = `${stickerNumber}-${safeHash}.png`;
      await writeFile(join(OUT_DIR, outName), previewPng);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[preview] fail ${hash}: ${msg}`);
      failed++;
    }
  }

  console.log(`[preview] ok=${ok} failed=${failed} → ${OUT_DIR}`);
}

main().catch((e) => {
  console.error("[preview] fatal:", e);
  process.exit(1);
});
