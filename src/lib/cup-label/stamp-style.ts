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
  "Convert the subject of the reference photo into a single rubber-stamp style seal graphic.",
  // What a stamp is, for this printer:
  "Solid black ink on a pure white background. No grey, no gradients, no shading — every mark is either full black ink or blank white paper.",
  "The graphic must read as a hand-pressed ink stamp: bold simplified contours and structural lines, slight ink breakup, uneven pressure, small patches of missing ink at edges, a faint natural stamping offset.",
  // Identity preservation (the heart of the source skill):
  "Keep the subject's identity exactly: same pose, same proportions, same viewing angle, same key features. If the subject is a person, preserve the face, age, hairstyle, expression, hands and clothing faithfully — simplified into stamp linework but recognisably the same person. If it is a pet, keep its markings and posture.",
  "Do not add, remove, duplicate or replace anything from the photo. Do not beautify, cartoonify or restyle the subject.",
  // Composition for a 5cm square sticker:
  "Square composition. The stamp occupies about 60% of the frame, centred by visual weight, surrounded by clean empty white space. The stamp's outer shape may be circular, square or irregular — whatever suits the subject — with naturally imperfect, slightly broken edges. No perfect geometric border.",
  // The typewriter caption, kept from the skill:
  "Near the stamp, add a tiny caption in worn typewriter lettering: one line with an UPPERCASE title of 1-3 short English words drawn from the photo's mood. Keep it small, sparse and off-centre; it must not touch or overpower the stamp.",
  // Negatives, trimmed to what threatens this medium:
  "No photorealism, no halftone texture, no paper texture, no background pattern, no grey tones, no gradients, no glow, no modern UI style, no vector-smooth edges, no cartoon style, no watermark, no logo, no border frame.",
].join(" ");

/**
 * The prompt Doubao gets for a Memory Stamp job. The customer's own text is
 * deliberately NOT part of it — the style is the product, and two hundred
 * characters of freeform steering is how the subject stops being theirs.
 */
export function buildMemoryStampPrompt(): string {
  return MEMORY_STAMP_PROMPT;
}
