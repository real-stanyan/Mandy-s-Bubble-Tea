import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase-server";

// In-store (Square POS) cup labels print a one-line "fortune" in place
// of the doodle. The pool is a 500-line precomputed set seeded by the
// 2026-05-21-cup-label-fortunes migration. We pull N rows at print
// time via the cup_label_random_fortunes(n) SQL function — one
// round-trip and Postgres's random() does the picking.
//
// If the DB read fails (network, table missing, RPC error, short
// result), we fall back to a 30-line hand-curated pool inlined below
// so a cup never prints without a fortune. The fallback is a feature,
// not just a safety net — DB down ≠ no labels.

const FALLBACK_POOL: readonly string[] = [
  "The next sip will taste better than the last",
  "Today is a fine day to begin something quiet",
  "Patience is the slowest brewer of all teas",
  "The road less travelled has more bubble tea",
  "Three pearls floated to the top just for you",
  "A small kindness shared today travels far",
  "Bubbles rise because they refuse to stay still",
  "Slow sips make for long memories",
  "The first bubble is always the bravest",
  "Sweetness finds those who notice the small things",
  "A kind word costs nothing and warms everything",
  "The pearls at the bottom are the patient ones",
  "Today carries small wonders worth a slow sip",
  "Curiosity is the best companion for a Tuesday",
  "A good cup is half drink, half pause",
  "Every bubble holds a tiny bit of joy",
  "Notice the warmth in your hands right now",
  "The simple things often taste the best",
  "A quiet smile makes the room a little brighter",
  "Tea is patience you can drink",
  "The bubbles know exactly when to rise",
  "Small joys count just as much as big ones",
  "A gentle pace wins more days than a fast one",
  "The pearl you chase first is always the sweetest",
  "Today is a fine day for a fresh start",
  "Kindness shared at a cafe travels for miles",
  "Take the moment slowly; it is yours",
  "Every cup is a tiny new beginning",
  "The best surprises are the ones you sip slowly",
  "Joy hides in the smallest bubbles",
];

// Safety validator used for the 500-line seed (validate-fortunes.ts)
// and exported for tests. Kept in this file because the seed pool was
// vetted against this exact predicate — any future re-seed should use
// it too.
const FORBIDDEN_WORDS = [
  "love", "romance", "dating", "marriage", "lover", "loved one",
  "miss you", "missing you", "missing someone",
  "family", "mother", "father", "parent", "sibling", "child", "children",
  "ill", "sick", "disease", "death", "die", "dying", "dead", "grief", "mourn",
  "accident", "injury", "hospital",
  "money", "wealth", "rich", "poor", "debt", "loan", "salary",
  "god", "gods", "lord", "spirit", "spirits", "soul", "fate", "karma", "destiny",
  "politics", "election", "government", "president",
  "work performance", "promotion", "fired", "raise",
  "weight", "fat", "thin", "looks", "beautiful", "ugly", "age", "old",
  "mental health", "depression", "anxiety", "addiction",
  "warning", "danger", "beware", "fail", "failure", "loss",
  "you will",
];
const IMPERATIVE_STARTS = [
  /^do\s/i,
  /^don['']?t\s/i,
  /^never\s/i,
  /^always\s/i,
  /^avoid\s/i,
  /^beware\b/i,
];

export function isSafeFortune(line: string): boolean {
  const lower = line.toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lower)) return false;
  }
  for (const re of IMPERATIVE_STARTS) {
    if (re.test(line.trim())) return false;
  }
  const trimmed = line.trim();
  if (trimmed.endsWith("?")) return false;
  if (/^(?:why|how|what|when|where|who|which|whose)\b/i.test(trimmed)) return false;
  if (/^(?:is|are|can|will|should|would|could|do|does|did)\s+you\b/i.test(trimmed)) return false;
  return true;
}

function pickFromPool(count: number, exclude: string[] = []): string[] {
  const used = new Set(exclude);
  const pool = FALLBACK_POOL.filter((f) => !used.has(f));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i]!, shuffled[j]!] = [shuffled[j]!, shuffled[i]!];
  }
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(shuffled[i % shuffled.length]!);
  }
  return out;
}

export async function generateFortunes(count: number): Promise<string[]> {
  if (count <= 0) return [];
  try {
    const { data, error } = await getSupabaseAdmin().rpc("cup_label_random_fortunes", { n: count });
    if (error) {
      console.warn(`[fortune] RPC error (${error.message}) — using fallback pool`);
      return pickFromPool(count);
    }
    if (!data || data.length < count) {
      console.warn(`[fortune] RPC returned ${data?.length ?? 0}/${count} — using fallback pool`);
      return pickFromPool(count);
    }
    return (data as Array<{ text: string }>).map((r) => r.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[fortune] RPC threw (${msg}) — using fallback pool`);
    return pickFromPool(count);
  }
}

export const __test__ = { FALLBACK_POOL, isSafeFortune, pickFromPool };
