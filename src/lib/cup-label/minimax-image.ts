import "server-only";
import sharp from "sharp";

// MiniMax image generation for the admin cup-label gallery. Produces a clean
// black line-art image on a pure white background — the gallery's visual
// language — so the downstream binarize (Atkinson, 592px @ 300dpi thermal)
// path stays unchanged.
//
// Findings that shape this module (validated 2026-06-22 against the Token Plan
// sk-cp- key):
//   - model `image-01-live` (pure text2img) ALWAYS renders shaded /
//     photographic backgrounds and ignores "white background" prompting, so it
//     binarizes into a muddy black field. Unusable for line art.
//   - model `image-01` (img2img) DOES respect line-art prompting. So we always
//     use image-01 and supply an `image_url`:
//       · text mode  → a blank white canvas as a style anchor (subject drawn
//         fresh from the prompt, biased toward an empty white background)
//       · image mode → the caller's reference image (style-matched variant)
//   - the model still leaves a faint-to-medium grey background of variable
//     darkness; a fixed contrast tweak can't catch all of it. We crush it with
//     grayscale → median(3) → threshold(165), yielding a 2-tone image. Atkinson
//     then has no midtones to dither, so the existing preview/commit path is
//     clean with zero changes.

const ENDPOINT = "https://api.MiniMax.chat/v1/image_generation";
const GEN_TIMEOUT_MS = 60_000;
const DL_TIMEOUT_MS = 20_000;
// Pixels brighter than this collapse to white; the rest to black. Tuned so the
// AI's faint/medium grey background drops out while solid black lines survive.
const CLEANUP_THRESHOLD = 165;

export type GenMode = "text" | "image";

export type GenInput = {
  mode: GenMode;
  prompt: string;
  /** Reference image (raw decoded bytes) — required for `image` mode. */
  refImage?: Buffer;
};

// Wrap the user's subject in the gallery line-art style. Exported for testing.
export function buildGalleryPrompt(userPrompt: string): string {
  const subject = userPrompt.trim();
  return (
    `Simple minimalist black line art drawing of ${subject}, ` +
    `single subject centered, thick clean solid black outlines on a pure white background, ` +
    `flat 2D coloring-book clip art, no shading, no grey, no gradient, no color, no background scenery.`
  );
}

let whiteAnchorCache: string | null = null;
async function whiteAnchorDataUri(): Promise<string> {
  if (whiteAnchorCache) return whiteAnchorCache;
  const png = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
  whiteAnchorCache = `data:image/png;base64,${png.toString("base64")}`;
  return whiteAnchorCache;
}

async function refToDataUri(buf: Buffer): Promise<string> {
  // Normalize any uploaded reference (jpg/png/webp, any size) to a bounded PNG
  // data-uri that MiniMax accepts inline.
  const png = await sharp(buf)
    .rotate() // honour EXIF orientation before we drop the metadata
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

// Crush the variable AI background to pure white, keep black lines → 2-tone PNG.
async function cleanToLineArt(color: Buffer): Promise<Buffer> {
  return sharp(color)
    .grayscale()
    .median(3)
    .threshold(CLEANUP_THRESHOLD)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

/**
 * Generate a gallery-style line-art image. Returns a cleaned 2-tone color PNG
 * ready to feed through the existing /preview + /commit (Atkinson) path.
 * Throws on missing key, MiniMax error, or download failure.
 */
export async function generateGalleryImage(input: GenInput): Promise<Buffer> {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY not set");

  const prompt = buildGalleryPrompt(input.prompt);
  const imageUrl =
    input.mode === "image" && input.refImage && input.refImage.length > 0
      ? await refToDataUri(input.refImage)
      : await whiteAnchorDataUri();

  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "image-01", prompt, image_url: imageUrl, n: 1, size: "1024x1024" }),
    signal: AbortSignal.timeout(GEN_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`MiniMax HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as {
    data?: { image_urls?: string[] };
    base_resp?: { status_code: number; status_msg: string };
  };
  if (json.base_resp && json.base_resp.status_code !== 0) {
    throw new Error(`MiniMax error ${json.base_resp.status_code}: ${json.base_resp.status_msg}`);
  }
  const url = json.data?.image_urls?.[0];
  if (!url) throw new Error("MiniMax returned no image");

  const dl = await fetch(url, { signal: AbortSignal.timeout(DL_TIMEOUT_MS) });
  if (!dl.ok) throw new Error(`image download HTTP ${dl.status}`);
  const raw = Buffer.from(await dl.arrayBuffer());

  return cleanToLineArt(raw);
}
