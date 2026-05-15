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
  "You write short fortune-cookie messages in the style of Chinese-restaurant fortunes.",
  "Tone: gentle, philosophical, slightly mysterious, occasionally playful.",
  "Each fortune is one sentence, 5-12 words, no period at the end.",
  "Plain English only — no emoji, no quotation marks, no numbering, no preamble.",
  "Return exactly the requested count, one per line, nothing else.",
].join(" ");

const FALLBACK_POOL: readonly string[] = [
  "A pleasant surprise is waiting for you next Tuesday",
  "Your patience today will be repaid threefold",
  "The next sip will taste better than the last",
  "A small kindness will return to you this week",
  "Trust the question more than the answer",
  "Today is a fine day to begin something quiet",
  "Look up — the sky is doing something for you",
  "An old worry is about to lose its grip",
  "A door you forgot about is about to open",
  "The person you miss is thinking of you too",
  "Patience is the slowest brewer of all teas",
  "Your next idea will arrive while washing dishes",
  "Say yes to the smaller invitation this week",
  "The road less travelled has more bubble tea",
  "A coin found today is luck saved for later",
  "Listen for the music between the questions",
  "Tomorrow's storm will pass before lunch",
  "Someone is about to remember you fondly",
  "The thing you cannot find is closer than you think",
  "Speak gently to yourself today; you have been heard",
  "Three blessings travel with you this afternoon",
  "Choose the seat by the window",
  "Your hands will create something beautiful this week",
  "The wait will turn out to be the gift",
  "An unexpected message will lift you on Friday",
  "A long conversation will feel like five minutes",
  "Bring your laugh; it is needed where you go next",
  "The map you doubted is the right one",
  "A small mistake today will save you next month",
  "The pearl at the bottom is yours to find",
];

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
// fortune (model sometimes prefixes with "Here are 5 fortunes:" etc).
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
      return words >= MIN_WORDS && words <= MAX_WORDS;
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
export const __test__ = { parseFortunes, pickFromPool, FALLBACK_POOL };
