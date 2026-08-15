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
  // "siri" is iPhone-specific and reported from the shop: the phone hears its
  // own wake word in "three" and writes that instead. Nothing phonetic would
  // have caught it — "siri" and "three" share no consonants — so it has to be
  // named.
  free: 3, tree: 3, thee: 3, tri: 3, siri: 3, sri: 3,
  // "hey" is reported from the shop, and it was worse than unheard: it is two
  // edits from "ten" and four from "eight", so the near-miss pass was quietly
  // writing a 10 every time somebody said eight. Distance was never going to
  // fix that one — it has to be named, and the named table runs first.
  // Not "eh": that is a hesitation, and a tag on the end of half the
  // sentences spoken in this country. The others are the long-A sound of
  // "eight" written down.
  ate: 8, eat: 8, hate: 8, hey: 8, hay: 8, ay: 8,
  sicks: 6, sex: 6,
  fife: 5, hive: 5, faiv: 5,
  nein: 9, nain: 9, line: 9, no: 9, nope: 9, nah: 9, know: 9, noh: 9,
  sven: 7, seaven: 7,
  tan: 10, tin: 10,

  // Chinese, and Cantonese with it: a Cantonese recogniser writes the same
  // characters, so the only additions it needs are the traditional 兩 and the
  // 廿 and 卅 that get said for twenty and thirty.
  //
  // 两 as well as 二, because nobody counts bottles with 二.
  "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "兩": 2, "三": 3, "四": 4,
  "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10, "半": 0.5,
  "廿": 20, "卅": 30,

  // Korean. Native numbers are what someone counting says; the Sino ones are
  // what a recogniser often writes.
  "하나": 1, "둘": 2, "셋": 3, "넷": 4, "다섯": 5, "여섯": 6, "일곱": 7,
  "여덟": 8, "아홉": 9, "열": 10,
  "한": 1, "두": 2, "세": 3, "네": 4,
  "영": 0, "공": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5,
  "육": 6, "칠": 7, "팔": 8, "구": 9, "십": 10,
};

/**
 * Words that must never become a number, however close they sound.
 *
 * Pulling every stray word towards the nearest number is right — everything
 * said here is meant to be one — but not for the words that hold a sentence
 * together. "and" lands on one, "done" lands on one, and either of them
 * inserted mid-count does not just add a wrong number: it shifts every value
 * after it down a row, so a whole shelf ends up recorded against the wrong
 * bottles.
 *
 * Found by printing what the near-miss pass did to forty ordinary words rather
 * than by imagining what it might do.
 */
const NEVER_A_NUMBER = new Set([
  "and", "the", "then", "than", "that", "this", "these", "those",
  "done", "more", "less", "most", "but", "so", "now", "next", "here",
  "there", "its", "it", "is", "was", "were", "are", "am", "be",
  "ok", "okay", "right", "yes", "yeah", "yep", "well", "just", "like",
  "got", "get", "have", "has", "had", "hold", "on", "off", "up", "down",
  "wait", "stop", "start", "go", "come", "let", "make", "take", "put",
  "same", "some", "any", "all", "of", "or", "if",
]);

/** For the cups-and-straws rows, which take an answer rather than a count. */
const SUFFICIENCY: Array<[RegExp, "enough" | "maybe" | "short"]> = [
  // 唔夠 and 冇 are the Cantonese ones; 冇 on its own is how somebody says
  // there is none left.
  [
    /^(not ?enough|out|empty|finished|none ?left|没了|沒了|不够|不夠|唔够|唔夠|冇|冇晒|없어요?|없음)$/,
    "short",
  ],
  [/^(maybe|might|borderline|barely|差不多|可能|唔知|아마)$/, "maybe"],
  [/^(enough|plenty|fine|good|lots|full|够|夠|足够|足夠|够晒|夠晒|충분|많아요?)$/, "enough"],
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

    // After the phrases, so "not" can still be half of "not enough", and
    // before every number lookup, so a word that holds a sentence together
    // can never become a count.
    if (NEVER_A_NUMBER.has(word)) continue;

    const digits = word.match(/^(\d+(?:\.\d+)?)$/);
    if (digits) {
      out.push({ kind: "number", value: tidy(digits[1]) });
      continue;
    }

    // Anything else that sounds close enough to a number is treated as one.
    //
    // Everything said here is meant to be a number, so a word that is nearly
    // one almost certainly is: "fine" and "mine" and "wine" are all a nine,
    // "tan" is a ten, "sever" is a seven. Patching these one report at a time
    // was never going to end — the shop found "too", "bun", "siri" and "no" in
    // four days — and each one dropped a count on the floor until it was
    // named.
    //
    // The named table above still comes first, because the ones that matter
    // most are the ones this cannot reach: "siri" shares no letters with
    // "three".
    const near = word in VALUES ? null : nearestNumber(word);
    if (near !== null) {
      out.push({ kind: "number", value: tidy(String(near)) });
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

/** The spelled-out numbers a stray word can be pulled towards. Only these —
 *  not the mishearings, or "too" would drag "to" and "toe" and "tow" along
 *  with it and the threshold would stop meaning anything. */
const SPELLED: Array<[string, number]> = [
  ["zero", 0], ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["eleven", 11], ["twelve", 12], ["fifteen", 15], ["twenty", 20],
];

/**
 * The number a word is nearest to, or null if it is not near one.
 *
 * Two edits, and never on a word shorter than three letters: "a" and "um" and
 * "uh" are within two of half the list and mean nothing. A tie is refused —
 * a word equally close to two numbers is not evidence of either.
 */
function nearestNumber(word: string): number | null {
  if (word.length < 3) return null;
  let best: number | null = null;
  let bestDistance = 3;
  let tied = false;
  for (const [name, value] of SPELLED) {
    const d = editDistance(word, name);
    if (d < bestDistance) {
      bestDistance = d;
      best = value;
      tied = false;
    } else if (d === bestDistance) {
      tied = true;
    }
  }
  return tied ? null : best;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...new Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** Strips a leading zero, which the recogniser produces for "oh two" and which
 *  showed up in the shop as a row reading "02". */
function tidy(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}
