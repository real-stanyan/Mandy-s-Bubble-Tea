import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { generateFortunes, __test__ } from "./fortune";

describe("fortune parseFortunes", () => {
  it("strips numbering, bullets, quotes, trailing punctuation", () => {
    const raw = [
      "1. A pleasant surprise awaits you",
      "2) Your patience will be rewarded",
      "- Listen for the music between questions",
      "• The wait will turn out to be the gift",
      '"Trust the question more than the answer"',
      "Today carries small wonders worth a slow sip.",
    ].join("\n");
    const out = __test__.parseFortunes(raw);
    expect(out).toEqual([
      "A pleasant surprise awaits you",
      "Your patience will be rewarded",
      "Listen for the music between questions",
      "The wait will turn out to be the gift",
      "Trust the question more than the answer",
      "Today carries small wonders worth a slow sip",
    ]);
  });

  it("drops too-short and too-long lines (preamble / explanations / lists)", () => {
    const raw = [
      "Here are 5 fortunes for you:", // 5 words but might be filtered as prefix-ish — actually 5 words is within range, this should pass
      "OK",                            // 1 word, drop
      "This sentence has exactly four", // 5 words, pass
      "This is a much longer sentence with way too many words to fit comfortably on a bubble tea cup label and should be filtered", // > MAX
    ].join("\n");
    const out = __test__.parseFortunes(raw);
    expect(out).toContain("This sentence has exactly four");
    expect(out).not.toContain("OK");
    expect(out.every((l) => l.split(/\s+/).length <= 14)).toBe(true);
  });

  it("drops lines that fail the safety validator", () => {
    const raw = [
      "A warm smile makes any day sweeter",
      "A loved one will call you tomorrow",   // contains "loved one" → drop
      "God smiles upon your endeavor",        // contains "god" → drop
      "You will lose something dear today",   // contains "lose" → drop
      "Beware of strangers offering candy",   // imperative "beware" + "danger"-adjacent → drop
      "Every sip is a little moment of calm",
    ].join("\n");
    const out = __test__.parseFortunes(raw);
    expect(out).toEqual([
      "A warm smile makes any day sweeter",
      "Every sip is a little moment of calm",
    ]);
  });
});

describe("fortune isSafeFortune", () => {
  const blocked: Array<[string, string]> = [
    ["love reference", "Loving kindness softens your day"],
    ["loved-one reference", "A loved one will surprise you"],
    ["religion", "God smiles upon your endeavor"],
    ["prayer", "Praying for clear skies tomorrow"],
    ["death", "An old fear is about to die quietly"],
    ["loss/lose", "You will lose something dear today"],
    ["fail", "You will fail this week, sorry"],
    ["money", "Money is coming your way soon"],
    ["beware imperative", "Beware of strangers offering candy"],
    ["do imperative", "Do something kind today, friend"],
    ["question", "Why is the sky always grey today"],
  ];
  for (const [name, line] of blocked) {
    it(`blocks ${name}: ${line.slice(0, 30)}`, () => {
      expect(__test__.isSafeFortune(line)).toBe(false);
    });
  }

  const allowed = [
    "Skill is patience that shows up daily",
    "Still water knows the way home",
    "A fresh idea sparkles like bubbles in tea",
    "The first bubble is always the bravest",
    "Bubble tea tastes better when shared with kindness",
  ];
  for (const line of allowed) {
    it(`allows safe line: ${line.slice(0, 30)}`, () => {
      expect(__test__.isSafeFortune(line)).toBe(true);
    });
  }

  it("entire fallback pool passes the validator", () => {
    const bad = __test__.FALLBACK_POOL.filter((f) => !__test__.isSafeFortune(f));
    expect(bad).toEqual([]);
  });
});

describe("fortune pickFromPool", () => {
  it("returns exactly N fortunes", () => {
    const out = __test__.pickFromPool(7);
    expect(out).toHaveLength(7);
    expect(out.every((s) => __test__.FALLBACK_POOL.includes(s))).toBe(true);
  });

  it("excludes already-used fortunes when filling shortfalls", () => {
    const exclude = __test__.FALLBACK_POOL.slice(0, 5);
    const out = __test__.pickFromPool(3, exclude as string[]);
    expect(out).toHaveLength(3);
    for (const f of out) expect(exclude).not.toContain(f);
  });

  it("cycles with replacement when N > pool size", () => {
    const out = __test__.pickFromPool(100);
    expect(out).toHaveLength(100);
  });
});

describe("fortune generateFortunes (network)", () => {
  const realFetch = global.fetch;
  const realKey = process.env.DEEPSEEK_API_KEY;

  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = "test-key";
  });
  afterEach(() => {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = realKey;
  });

  it("returns safe DeepSeek output and tops up filtered lines from the pool", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "A pleasant surprise awaits you\nThe road ahead is your friend\nA loved one is thinking of you",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const out = await generateFortunes(3);
    expect(out).toHaveLength(3);
    expect(out[0]).toBe("A pleasant surprise awaits you");
    expect(out[1]).toBe("The road ahead is your friend");
    // Third line ("A loved one ...") gets dropped by the safety
    // validator; the caller tops up from the curated pool.
    expect(out[2]).not.toBe("A loved one is thinking of you");
    expect(__test__.FALLBACK_POOL).toContain(out[2]);
  });

  it("falls back to pool on HTTP error", async () => {
    global.fetch = vi.fn(async () => new Response("Rate limited", { status: 429 }));
    const out = await generateFortunes(4);
    expect(out).toHaveLength(4);
    for (const f of out) expect(__test__.FALLBACK_POOL).toContain(f);
  });

  it("falls back to pool when DEEPSEEK_API_KEY missing", async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;
    const out = await generateFortunes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out).toHaveLength(2);
    for (const f of out) expect(__test__.FALLBACK_POOL).toContain(f);
  });

  it("tops up from pool when DeepSeek returns fewer than requested", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Only one fortune here, sorry team" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const out = await generateFortunes(5);
    expect(out).toHaveLength(5);
    // First one came from DeepSeek; the next four came from the pool
    // and must not collide with the DeepSeek one.
    expect(out[0]).toBe("Only one fortune here, sorry team");
    for (const f of out.slice(1)) {
      expect(__test__.FALLBACK_POOL).toContain(f);
      expect(f).not.toBe(out[0]);
    }
  });

  it("returns empty when count <= 0", async () => {
    expect(await generateFortunes(0)).toEqual([]);
    expect(await generateFortunes(-3)).toEqual([]);
  });
});
