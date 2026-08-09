// Memory Stamp — the cup-label adaptation of Stan's photo-stamp-archive
// prompt (Desktop/skill-make-photo-stamp-archive.md, 2026-08-09).
//
// The original skill produces a two-panel archival collage: the photo beside
// a seal-stamp distillation of its subject. A cup sticker is a 5cm square of
// thermal paper, so this adaptation keeps ONLY the stamp panel — which is
// the half that was born for this printer: a thermal head lays down solid
// black or nothing, and a seal stamp IS solid ink or nothing. Photos have to
// survive dithering to print; a stamp just prints.
//
// Deliberate departures from the source skill, all for the medium:
//   • No archival-paper texture or aging — the sticker is real paper already,
//     and simulated grain becomes dot noise after Atkinson dithering.
//   • Black ink only — the printer has one colour; the skill's accent-colour
//     system has nowhere to live.
//   • Stamp fills ~60% of frame (not 30–40%) — the canvas is 5cm, and the
//     skill's museum-margin ratios would leave a stamp the size of a pea.
//   • Identity locks kept verbatim in spirit: the subject must stay THEIR
//     dog / face / cup, simplified but never redesigned.
//
// Deliberately NOT "server-only": the LabelPicker needs the style id and
// label, and the prompt text is not a secret — it rides to a third-party
// image API on every job.

export const MEMORY_STAMP_STYLE_ID = "memory-stamp" as const;

/** Shown on the cart line + used as the dedupe sentinel client-side. */
export const MEMORY_STAMP_LABEL = "Memory Stamp";

export const MEMORY_STAMP_PROMPT = [
  "Convert the subject of the reference photo into a single hand-carved stamp print, in the manner of a worn woodblock or linocut travel stamp pressed by hand years ago.",
  // What a stamp is, for this printer:
  "Solid black ink on a pure white background. No grey, no gradients, no shading — every mark is either full black ink or blank white paper. Keep the white background completely clean and empty.",
  // The texture that makes it read as vintage — this is the soul of the
  // style, and it must be COARSE. The first version asked politely for
  // "slight ink breakup" and got clean digital clipart back; fine grain is
  // also what turns to mush at 5cm. Big, structural wear only.
  "The print must look genuinely aged and hand-pressed: heavy dry-brush ink wear, chips and small missing chunks inside the black areas, visible carving marks, ragged eaten edges, uneven ink pressure across the whole print. Make the wear bold and chunky at a large scale so it stays legible when printed small — never fine speckle, never dust-like noise.",
  // Identity preservation (the heart of the source skill):
  "Keep the subject's identity exactly: same pose, same proportions, same viewing angle, same key features. If the subject is a person, preserve the face, age, hairstyle, expression, hands and clothing faithfully — simplified into carved linework but recognisably the same person. If it is a pet, keep its markings and posture.",
  "Do not add, remove, duplicate or replace anything from the photo. Do not beautify, cartoonify or restyle the subject.",
  // Composition for a 5cm square sticker:
  "Square composition. The stamp occupies roughly two thirds of the frame, centred by visual weight, surrounded by clean empty white space. Prefer a loose, irregular hand-carved outline over any neat enclosing frame; if a frame appears at all it must be heavily worn, broken and partial. No perfect geometric border.",
  // The typewriter caption block, restored to the source skill's two-line
  // form. Worded with care: an image model happily renders fragments of its
  // own instructions as the caption — an earlier phrasing said "an UPPERCASE
  // title of 1-3 short English words" and every stamp came back captioned,
  // literally, "UPPER 1-3". So: no digits anywhere near these sentences, no
  // meta-words like uppercase, and an explicit ban on copying instruction
  // text.
  "Near the stamp, add a small caption block in worn, slightly faded typewriter lettering: a very short title line in capital letters, and beneath it one quieter line of a few short lowercase words separated by slashes. Invent all of these words from the mood of the photo itself — never write any instruction wording or any numbers on the image. Keep the caption small and off-centre; it must not touch or overpower the stamp.",
  // Negatives, trimmed to what threatens this medium:
  "No photorealism, no halftone texture, no background pattern, no grey tones, no gradients, no glow, no modern UI style, no vector-smooth edges, no clean digital clipart look, no cartoon style, no watermark, no logo.",
].join(" ");

/**
 * The prompt Doubao gets for a Memory Stamp job. The customer's own text is
 * deliberately NOT part of it — the style is the product, and two hundred
 * characters of freeform steering is how the subject stops being theirs.
 */
export function buildMemoryStampPrompt(): string {
  return MEMORY_STAMP_PROMPT;
}
