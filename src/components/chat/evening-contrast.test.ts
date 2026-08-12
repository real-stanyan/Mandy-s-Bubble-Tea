import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** The day values of --ink and --ink2 (globals.css). Written as literals in
 *  a component, they stop tracking the theme. */
const DAY_INK = /text-\[#(2A1E14|2a1e14|5A4330|5a4330)\]/;
/** Surfaces globals.css sends to a DARK token under
 *  :root[data-theme="evening"]. A pinned dark ink on one of these is
 *  invisible after sunset. */
const FLIPPING_SURFACE = /\bbg-(cream|zinc-200)\b/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Evening Mode's rule: a surface that flips dark must carry text that flips
 * light with it.
 *
 * Shipped twice. The chat promotion card pinned the day ink on bg-cream on
 * the belief that bg-cream stays light after dark — globals.css sends it to
 * --bg2, so the card went dark, the title went dark-on-dark and vanished
 * (reported 2026-08-12 with a screenshot). The same pairing was sitting in
 * the checkout delivery-pause notice, where it would have hidden the only
 * explanation of why delivery was missing.
 *
 * Both were one-line fixes; neither was caught by eye, because nobody
 * reviews a diff in Evening Mode. Pinning a poster face is still legitimate
 * — but a poster face keeps its own light background (bg-[#FFF3DE] and
 * friends), which is exactly what this rule can tell apart.
 */
describe("Evening Mode contrast", () => {
  const roots = ["src/components", "src/app"];
  const files = roots.flatMap((r) => tsxFiles(r));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("never pins day ink in a file that paints a surface which flips dark", () => {
    // Deliberately per FILE, not per className. The first version of this
    // test required both in the same attribute and therefore caught
    // nothing: in the bug it was written for, bg-cream sat on the card
    // <div> and the pinned ink on the <p> inside it. Verified by putting
    // the bug back and watching this fail.
    //
    // Coarse on purpose. A file that flips a surface dark and also pins the
    // day ink somewhere is worth a human look, even if the two are not on
    // the same element — and poster faces, which legitimately pin ink, pair
    // it with their own light literal (bg-[#FFF3DE]) rather than bg-cream,
    // so they do not land here.
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (FLIPPING_SURFACE.test(src) && DAY_INK.test(src)) {
        const line = src.split("\n").findIndex((l) => DAY_INK.test(l)) + 1;
        offenders.push(`${file.replace(/\\/g, "/")}:${line} pins day ink beside a flipping surface`);
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
