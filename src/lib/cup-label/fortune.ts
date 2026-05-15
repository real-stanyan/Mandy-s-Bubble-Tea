import "server-only";

// In-store (Square POS) cup labels print a one-line "fortune" generated
// by DeepSeek in place of the doodle. Webhook path only — the web/app
// checkout flow keeps its drawn / preset / AI / upload doodle pipeline.
//
// DeepSeek's OpenAI-compatible chat completion endpoint is asked for N
// fortunes in one call so a 5-cup POS order is still one upstream
// round-trip. The model occasionally returns numbered lines or quoted
// lines despite the prompt; the parser tolerates both.
//
// If the network call fails or returns fewer than N usable lines, we
// fall back to a curated pool of 30 hand-written fortunes so a cup
// never prints with an empty doodle band. The fallback is a feature,
// not just a safety net — DeepSeek down ≠ no labels.

const ENDPOINT = "https://api.deepseek.com/v1/chat/completions";
const MODEL = "deepseek-chat";
const TIMEOUT_MS = 10_000;
const MIN_WORDS = 4;
const MAX_WORDS = 14;

const SYSTEM_PROMPT = [
  "You write short fortune-cookie messages for a friendly bubble tea shop in Brisbane.",
  "These print directly on customer cup labels — they MUST be universally polite and impossible to misread.",
  "",
  "ALLOWED topics: present-moment warmth, gratitude, kindness, small daily joys, tea/sweetness/bubbles, gentle optimism, playful curiosity, calm patience.",
  "",
  "FORBIDDEN topics (never reference): love, romance, dating, marriage, missing someone, family relationships, illness, death, grief, accidents, money, debt, wealth, religion, gods, spirits, fate, karma, politics, work performance, weight, looks, age, mental health, addiction, predictions of loss / failure / endings, warnings or 'beware'.",
  "",
  "STYLE rules:",
  "- One sentence, 5 to 12 words, no period or other end punctuation.",
  "- Plain warm English. No emoji, no quotes, no numbering, no preamble.",
  "- No second-person commands ('Do X', 'Avoid Y', 'Beware Z'). Gentle observations only.",
  "- No promises of specific outcomes ('You will get a promotion', 'Money is coming').",
  "- No reference to other people specifically ('Someone misses you', 'A stranger will').",
  "- Universally kind: a grieving widow, a stressed teen, and a delighted child must all read it without harm.",
  "",
  "Return exactly the requested count, one per line, nothing else.",
].join("\n");

// Curated fallback pool. Every line was re-vetted for the rule "a
// grieving widow, a stressed teen, and a delighted child must all read
// it without harm." Entries that mentioned other people specifically
// ("Someone misses you", "Someone will remember you fondly"), assumed
// inner states ("an old worry is about to lose its grip", "speak gently
// to yourself"), or implied warnings ("tomorrow's storm") were dropped
// from the original v1 pool. Replacements lean on tea / bubbles / the
// present moment.
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

// Defence-in-depth: even with a tight system prompt, a DeepSeek
// completion could drift into territory we don't want on a cup.
// Reject any line that contains a forbidden-topic word, looks like a
// command, or makes a promise about a specific person / outcome. The
// match is case-insensitive and word-boundary scoped so "soul" doesn't
// false-positive on "soul-warming" (no such substrings in pool).
const FORBIDDEN_WORDS = [
  // mortality / health
  "death", "die", "dies", "died", "dying", "dead", "kill", "kills",
  "killed", "killing", "grave", "funeral", "mourn", "mourning",
  "ill", "sick", "disease", "cancer", "hospital", "wound", "pain", "hurt",
  // relationships / romance
  "love", "loves", "loved", "loving", "romance", "lover", "romantic",
  "kiss", "marry", "married", "marries", "marrying", "marriage",
  "divorce", "ex", "miss you", "miss someone", "loved one", "loved ones",
  // religion / spirits
  "god", "gods", "jesus", "christ", "buddha", "allah", "soul",
  "heaven", "hell", "devil", "demon", "spirit", "ghost",
  "prayer", "pray", "prays", "praying", "prayed", "blessed", "blessing",
  // money / status
  "money", "debt", "rich", "poor", "wealth", "broke", "fortune of",
  // negative / warnings
  "beware", "warning", "danger", "avoid", "regret", "regrets",
  "regretted", "regretting", "betray", "betrayed", "betraying",
  "lie", "lies", "lying", "deceive", "deceived", "fail", "fails",
  "failed", "failing", "failure", "loss", "lose", "loses", "losing",
  // body / appearance / age
  "weight", "fat", "skinny", "ugly", "old age", "wrinkle",
  // politics
  "government", "president", "election", "vote",
  // mental health
  "depression", "anxiety", "trauma", "addict", "addiction",
] as const;

// Lines that look like imperatives (start with a bare verb or a "Don't")
// also get bounced — even kind-looking commands ("Just relax") can read
// as targeting someone. We keep "Today is a fine day" / "The next sip"
// style declaratives.
const IMPERATIVE_STARTS = [
  /^do(?:n['']t)?\s/i,
  /^don['']t\s/i,
  /^avoid\s/i,
  /^beware\s/i,
  /^stop\s/i,
  /^never\s/i,
  /^always\s/i,
  /^must\s/i,
];

export function isSafeFortune(line: string): boolean {
  const lower = line.toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    // Word-boundary match so "ill" doesn't fire on "skill" / "still".
    const re = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(lower)) return false;
  }
  for (const re of IMPERATIVE_STARTS) {
    if (re.test(line.trim())) return false;
  }
  // Question detection. parseFortunes already strips trailing "?",
  // so we have to recognise questions structurally — bare wh-word at
  // the start of the line, or "is/are/can/will/should you" interrogative.
  const trimmed = line.trim();
  if (trimmed.endsWith("?")) return false;
  if (/^(?:why|how|what|when|where|who|which|whose)\b/i.test(trimmed)) return false;
  if (/^(?:is|are|can|will|should|would|could|do|does|did)\s+you\b/i.test(trimmed)) return false;
  return true;
}

/**
 * Generate `count` short fortune-cookie sentences via DeepSeek, with
 * an O(1) fallback to FALLBACK_POOL if anything goes sideways. Always
 * returns exactly `count` lines.
 *
 * @param count How many fortunes to produce (one per cup in a POS order).
 */
export async function generateFortunes(count: number): Promise<string[]> {
  if (count <= 0) return [];

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.warn("[fortune] DEEPSEEK_API_KEY missing — using fallback pool");
    return pickFromPool(count);
  }

  try {
    const fortunes = await callDeepSeek(apiKey, count);
    if (fortunes.length >= count) return fortunes.slice(0, count);
    // Partial response: top up from pool so a 5-cup order isn't shorted.
    const topUp = pickFromPool(count - fortunes.length, fortunes);
    return [...fortunes, ...topUp];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[fortune] DeepSeek call failed (${msg}) — using fallback pool`);
    return pickFromPool(count);
  }
}

async function callDeepSeek(apiKey: string, count: number): Promise<string[]> {
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Give me ${count} fortunes for cups of bubble tea, one per line.`,
        },
      ],
      // Keep it short — N × ~15 tokens is plenty.
      max_tokens: Math.max(120, count * 30),
      temperature: 0.9,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }

  const json = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  return parseFortunes(text);
}

// Tolerant parser: strip leading "1.", "1)", "- ", "•", quotes, trailing
// punctuation. Reject lines that are too short / too long to be a
// fortune (model sometimes prefixes with "Here are 5 fortunes:" etc),
// and reject any line that fails the safety validator — those lines
// get topped up from the curated fallback pool by the caller.
function parseFortunes(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[\d]+[.)\]]\s*/, "")
        .replace(/^\s*[-•*]\s*/, "")
        .replace(/^["'""]+|["'""]+$/g, "")
        .replace(/[。.!?]+$/, "")
        .trim(),
    )
    .filter((line) => {
      if (!line) return false;
      const words = line.split(/\s+/).length;
      if (words < MIN_WORDS || words > MAX_WORDS) return false;
      if (!isSafeFortune(line)) {
        console.warn(`[fortune] rejected unsafe line: ${line}`);
        return false;
      }
      return true;
    });
}

// Pick N unique-ish fortunes from the fallback pool, avoiding any
// already-used ones. Shuffles a copy so each call is order-randomised.
function pickFromPool(count: number, exclude: string[] = []): string[] {
  const used = new Set(exclude);
  const pool = FALLBACK_POOL.filter((f) => !used.has(f));
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // If caller wants more than pool can supply, cycle with replacement.
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(shuffled[i % shuffled.length]);
  }
  return out;
}

// Exported for testing — the unit test wants to assert pool fallback
// behaviour without mocking the entire DeepSeek API surface.
export const __test__ = { parseFortunes, pickFromPool, FALLBACK_POOL, isSafeFortune };
