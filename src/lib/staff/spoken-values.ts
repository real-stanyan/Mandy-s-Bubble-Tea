// Reading a spoken count when the app already knows which item you are on.
//
// This replaces matching item names out of speech, and it is a much smaller
// problem. The old way had to hear "lychee jelly" correctly against sixty-odd
// names, several of which differ by one word — and when it misheard, it filled
// the wrong bottle. Now the screen says which item is next and the only thing
// to hear is a number. There is nothing for a number to be confused with, so
// every mishearing of "two" can be accepted without weighing it against
// anything else.
//
// It also makes the other languages nearly free: numbers are a closed set in
// any of them, where item names would have needed a translated table per
// language and somebody to check it.

export type SpokenValue =
  | { kind: "number"; value: string }
  | { kind: "sufficiency"; value: "enough" | "maybe" | "short" }
  | { kind: "skip" };

/** Numbers, and what recognisers write instead of them.
 *
 *  Reported from the shop: "two" comes back as "too", "one" as "bun". Because
 *  the whole utterance is numbers, these can simply be numbers — there is no
 *  sentence for "too" to belong to and no item name it could be part of. */
const VALUES: Record<string, number> = {
  // English
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30,
  none: 0, nil: 0, nought: 0, oh: 0, o: 0,
  half: 0.5,

  // What comes back instead
  to: 2, too: 2, tu: 2, tour: 2, tue: 2,
  bun: 1, bum: 1, won: 1, wan: 1, wun: 1, run: 1, an: 1, a: 1,
  for: 4, fore: 4, faw: 4,
  free: 3, tree: 3, thee: 3, tri: 3,
  ate: 8, eat: 8, hate: 8,
  sicks: 6, sex: 6, six_: 6,
  fife: 5, hive: 5, faiv: 5,
  nein: 9, nain: 9, line: 9,
  sven: 7, seaven: 7,
  then: 10, tan: 10, tin: 10,

  // Chinese. 两 as well as 二 — nobody counts bottles with 二.
  "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5,
  "六": 6, "七": 7, "八": 8, "九": 9, "十": 10, "半": 0.5,

  // Korean. Native numbers are what someone counting says; the Sino ones are
  // what a recogniser often writes.
  "하나": 1, "둘": 2, "셋": 3, "넷": 4, "다섯": 5, "여섯": 6, "일곱": 7,
  "여덟": 8, "아홉": 9, "열": 10,
  "한": 1, "두": 2, "세": 3, "네": 4,
  "영": 0, "공": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5,
  "육": 6, "칠": 7, "팔": 8, "구": 9, "십": 10,
};

/** For the cups-and-straws rows, which take an answer rather than a count. */
const SUFFICIENCY: Array<[RegExp, "enough" | "maybe" | "short"]> = [
  [/^(not ?enough|out|empty|finished|none ?left|没了|不够|沒了|없어요?|없음)$/, "short"],
  [/^(maybe|might|borderline|barely|差不多|可能|아마)$/, "maybe"],
  [/^(enough|plenty|fine|good|ok|okay|lots|full|够|夠|足够|충분|많아요?)$/, "enough"],
];

/** Move on without answering — the item is not there to count, or somebody
 *  wants to come back to it. Blank means "not counted", which is a real
 *  answer, so this has to be sayable. */
const SKIP = /^(skip|next|pass|dunno|跳过|跳過|下一个|下一個|다음|패스)$/;

function normalise(text: string): string {
  return text
    .toLowerCase()
    // NFD to drop Latin accents, NFC to put Hangul back together: decomposing
    // splits 하나 into its jamo, and every Korean number silently stopped
    // matching.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC")
    // Han and kana get a space each side: Chinese is written without them, and
    // 三二一 has to become three tokens before any of it can be read.
    .replace(/([぀-ヿ㐀-䶿一-鿿])/g, " $1 ")
    .replace(/[^a-z0-9. ぀-ヿ㐀-䶿一-鿿ᄀ-ᇿ가-힣]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every value in what was said, in the order it was said.
 *
 * A running count is "three, two, none, one" — one utterance, several items —
 * so this returns a list and the caller walks it down the rows.
 */
export function parseSpokenValues(transcript: string): SpokenValue[] {
  const out: SpokenValue[] = [];
  const words = normalise(transcript).split(" ").filter(Boolean);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Phrases before single words, longest first, and joined both ways.
    //
    // Splitting Han characters is what lets 三二一 be read as three numbers,
    // but it also tore 不够 and 跳过 into halves — and 够 on its own says the
    // opposite of what 不够 means. So the joined forms are tried first: "not
    // enough" with spaces, 不够 without.
    let phrase: SpokenValue | null = null;
    let consumed = 0;
    for (let n = Math.min(4, words.length - i); n >= 1 && !phrase; n--) {
      const slice = words.slice(i, i + n);
      for (const candidate of [slice.join(""), slice.join(" ")]) {
        if (SKIP.test(candidate)) {
          phrase = { kind: "skip" };
        } else {
          const hit = SUFFICIENCY.find(([pattern]) => pattern.test(candidate));
          if (hit) phrase = { kind: "sufficiency", value: hit[1] };
        }
        if (phrase) {
          consumed = n - 1;
          break;
        }
      }
    }
    if (phrase) {
      out.push(phrase);
      i += consumed;
      continue;
    }

    const digits = word.match(/^(\d+(?:\.\d+)?)$/);
    if (digits) {
      out.push({ kind: "number", value: tidy(digits[1]) });
      continue;
    }

    if (word in VALUES) {
      // "three point five", and its Chinese and Korean equivalents.
      const fraction = fractionAfter(words, i);
      if (fraction) {
        out.push({ kind: "number", value: tidy(`${VALUES[word]}.${fraction.digit}`) });
        i = fraction.consumedTo;
        continue;
      }
      out.push({ kind: "number", value: tidy(String(VALUES[word])) });
      continue;
    }
  }

  return out;
}

function fractionAfter(
  words: string[],
  i: number,
): { digit: number; consumedTo: number } | null {
  const marker = words[i + 1];
  if (marker !== "point" && marker !== "点" && marker !== "點") return null;
  const next = words[i + 2];
  if (next === undefined) return null;
  const digit = /^\d$/.test(next) ? Number(next) : VALUES[next];
  if (digit === undefined || digit > 9) return null;
  return { digit, consumedTo: i + 2 };
}

/** Strips a leading zero, which the recogniser produces for "oh two" and which
 *  showed up in the shop as a row reading "02". */
function tidy(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}
