// Tarot deck catalog — single source of truth for hash → card identity
// and card identity → upright meaning. Used by:
//
//   * `scripts/process-tarot-gallery.ts` to bake the card name (left
//     vertical strip) and meaning sentence (right vertical strip) into
//     the binarized PNG at gallery build time.
//   * `tarot-denylist.ts` to define which hashes are excluded from the
//     POS / web-default random draw.
//
// hash → name map built 2026-05-22 via 4 parallel vision passes over
// the source JPGs in `~/Desktop/塔罗牌/` + manual main-agent verification
// of 10 disputed entries (subagent vision had ~10% error rate; a prior
// hand-curated denylist had ~6 wrong labels). All 80 source images are
// catalogued — the deck mixes two Rider-Waite-Smith editions so several
// cards have multiple hash variants (e.g., EIGHT OF WANDS, SIX OF CUPS,
// THE FOOL each have 2 captured prints).
//
// Meaning copy is upright RWS in a casual coffee-shop voice; each
// sentence is kept ≤ 50 chars so it wraps to 2 columns at 28pt inside
// the right-side white strip of the 592×592 cup-label middle band.

export type TarotMetadata = { name: string; meaning: string };

export const TAROT_HASH_TO_NAME: Record<string, string> = {
  "feb393418916879cea1f38a244928c7e": "KING OF SWORDS",
  "db83d56ad4e86a67caa9b4b2f1044d2e": "THE HIEROPHANT",
  "2ac524a4d0a0dba32c9fc28864b4eaff": "PAGE OF SWORDS",
  "fa12857cc20ae3ec71e8aa4b1403d5b8": "FIVE OF SWORDS",
  "55a3ba4e7b6e6bc093297561611474f1": "NINE OF CUPS",
  "e7eb3d852698d5a3db43745c7bfb86dc": "THE HANGED MAN",
  "415e3cd2057022904c686a295abe8ced": "TEN OF CUPS",
  "9a707bb37a7825f018a8fd3514c44f8e": "FOUR OF WANDS",
  "feab330e39322cd56947f45507493bf7": "FOUR OF CUPS",
  "d240070f86a95ea65fbc41832e81e327": "KNIGHT OF WANDS",
  "2c9670382d2442827d0820dc6a23a74d": "STRENGTH",
  "9cd500394c7da3bd041ebf3d0ee39703": "SIX OF CUPS",
  "bdd429fa0c714fa34186b1db82dd05b5": "ACE OF WANDS",
  "659681ecfaddfe93a3eeb9451c26ae82": "THE DEVIL",
  "ba0fedfc51427113caba146e0fbc04c0": "KNIGHT OF PENTACLES",
  "188d271c564851676c1ae1cb50836f62": "JUDGEMENT",
  "1c9ebb99d7843c89f10d1802b4bb3d14": "THE EMPEROR",
  "bcd1ee92a84e1a09e64ea07a477b8b45": "THE MAGICIAN",
  "497911e369304a954bdc3fe32440448c": "PAGE OF CUPS",
  "530a8f5599a55fb57229025d0a140c17": "THE MOON",
  "3b1d108af2a28df019cb6dc9957e2194": "EIGHT OF WANDS",
  "c4ea21686441f1e7369f3733abdfc9ee": "EIGHT OF CUPS",
  "8c3f45a825a4772dfc2dc6498c54b488": "THE WORLD",
  "b9ba42407b90da190196542a1babfbbf": "THE HIGH PRIESTESS",
  "3afb2cd82fbb66d8933d0f3d963d38c5": "TWO OF PENTACLES",
  "e5078f88ec8642478c07d534bd40df5c": "TWO OF WANDS",
  "c56918a774f065120f21b0345d939b14": "THE FOOL",
  "8082d8ac0370405eace6856b78dbe180": "TEMPERANCE",
  "a2ab0d0a67ea86618c6ad7e097a8a6e8": "SEVEN OF WANDS",
  "a220698a67b70518e9215dcb2b1c5efe": "THREE OF SWORDS",
  "af450f20bf321a650b7caf715315285b": "KING OF CUPS",
  "65f6bcaf054f2162f7d81ff4fedb6d50": "TEN OF WANDS",
  "96cbe26c06a1c57032a1da5a55b95ed8": "FIVE OF CUPS",
  "caee62765e5096c8643fa651fab92d2b": "SIX OF WANDS",
  "9643a4fae537b656a4ae8d253fadb2e7": "EIGHT OF PENTACLES",
  "07e6d3cf54d7b37b83d263fe4e9d9aea": "PAGE OF PENTACLES",
  "ded2b561ae56ed075651c5cebc40d323": "FIVE OF WANDS",
  "b342156262d506c2d6e5fc2cd5602458": "ACE OF CUPS",
  "5a69c45c5917390875f620e085333a76": "ACE OF PENTACLES",
  "c5f067d07248f3cd1f03edce0c57c512": "WHEEL OF FORTUNE",
  "0789dbbbbe008aa6fa8d9040ab50f9fc": "PAGE OF WANDS",
  "e1cf0c257b50878841c1f06ea6733425": "NINE OF PENTACLES",
  "10760c65fe1e500f13e11573eb81c1f0": "KING OF PENTACLES",
  "954b44cfa29b17b91bdf4006336113ea": "NINE OF PENTACLES",
  "d9cbf43008da7d40a57534d2481a1c3a": "QUEEN OF PENTACLES",
  "40dfda7b36635103902d4ce4a2525bf7": "THE STAR",
  "a67c617828b1bd877861624e7a013da2": "FOUR OF SWORDS",
  "3ad24c0ac5ab9ca35c40ab4930f89ed6": "FIVE OF PENTACLES",
  "0b7e06de757b61294046913532201165": "KNIGHT OF CUPS",
  "65f56d44c9ff1714ac31a6bce4975f0a": "THE HIGH PRIESTESS",
  "b598db91eadf43f288e85baa163ad446": "TEN OF PENTACLES",
  "c6ba7d3e4a8e60dbe6e0b2ce6ad267d3": "KNIGHT OF SWORDS",
  "dd06a6161d7c83bbb5dfdde6f6a04087": "QUEEN OF CUPS",
  "645106c4c67beffa9669d804a655d178": "THE CHARIOT",
  "e2e15acba18036d742aa9911eb3c29b6": "THE LOVERS",
  "9dc098fcdcab7edb74a355c5119b61ab": "ACE OF SWORDS",
  "f773c8925545dc64de03c50f0207a4a0": "FOUR OF PENTACLES",
  "31b7c2b649ad84eb22b62977eef24907": "THE EMPRESS",
  "e8941f0ac62fa10581e22fe11beee40a": "THREE OF CUPS",
  "650ca85b9f513ba0eb026d12e044318a": "SEVEN OF CUPS",
  "6ef9a6135c23fc4d4d77e7fbeeb1ad8f": "SEVEN OF SWORDS",
  "05bfa63c42666fc6ae056fefd2fc9ee4": "NINE OF SWORDS",
  "4fd1f73b95978b093b6109fdec6a502f": "QUEEN OF WANDS",
  "0a18cd17f45ba44aa59cf78651495058": "EIGHT OF WANDS",
  "52d02355ae1e531921cf1a47cf02c87c": "THE TOWER",
  "43c41ad0f3ea78bb2e57dce9f1df35e2": "SIX OF CUPS",
  "5e9b2f8e4cde9319593c98aafd82d588": "QUEEN OF SWORDS",
  "63dc5fe7252eb06ccc09b246f03e991a": "THE SUN",
  "0cd3825c14218d0b7a4befc73c0f4792": "THREE OF WANDS",
  "77c677f73c044c8e4c87eb694f03d1d1": "THREE OF PENTACLES",
  "4054e7666c4e75c9f0cd8b52081774e2": "DEATH",
  "cffc9ad55e9952607c3e98528420ffc7": "TWO OF SWORDS",
  "57c8f9e8fe7f4331dbea28b30b42bdfe": "JUSTICE",
  "92dee529b619cecff70e508f1ba657fc": "SEVEN OF WANDS",
  "b559dcfb309f14e1f0b6d3a2bc7d8c3f": "TEN OF WANDS",
  "fde5628c6cf57d21568b2603e0b18963": "SIX OF PENTACLES",
  "7d47eab4dcf85ea37a7b6a20ddb06621": "THE HERMIT",
  "e7efe1a2d0945e1e10209fdebeaaa68f": "NINE OF WANDS",
  "66f0cdd2581f3f9934646be1668c5723": "THE FOOL",
  "8757028c5f5724994932a83f9587e841": "KING OF WANDS",
};

export const TAROT_NAME_TO_MEANING: Record<string, string> = {
  // Major Arcana
  "THE FOOL":          "Take the leap. Trust where the road leads.",
  "THE MAGICIAN":      "All the tools you need are already yours.",
  "THE HIGH PRIESTESS":"Trust the quiet voice you keep ignoring.",
  "THE EMPRESS":       "Nurture what's growing. Abundance is close.",
  "THE EMPEROR":       "Bring order to it. Lead with steady hands.",
  "THE HIEROPHANT":    "Old wisdom still works. Honor the path.",
  "THE LOVERS":        "Choose with your whole heart, not half.",
  "THE CHARIOT":       "Hold the reins. Drive forward on purpose.",
  "STRENGTH":          "Soft hands tame what force never could.",
  "THE HERMIT":        "Step inward. Your own lamp is enough.",
  "WHEEL OF FORTUNE":  "What's turning will turn again. Keep faith.",
  "JUSTICE":           "What you give out is what comes back.",
  "THE HANGED MAN":    "Hang a while. The view will shift.",
  "DEATH":             "An ending makes room for what's coming.",
  "TEMPERANCE":        "Mix the hot and cold. Find the middle.",
  "THE DEVIL":         "What's holding you? You can let go.",
  "THE TOWER":         "What falls today wasn't built to last.",
  "THE STAR":          "Hope is real. Keep your face to the light.",
  "THE MOON":          "Not everything dark is meant to harm.",
  "THE SUN":           "Bright day. Step out and be seen.",
  "JUDGEMENT":         "A call is rising. Answer with your life.",
  "THE WORLD":         "You made it. Now begin the next loop.",
  // Wands
  "ACE OF WANDS":      "A spark just lit. Catch it. Run.",
  "TWO OF WANDS":      "The world is yours to map. Pick a horizon.",
  "THREE OF WANDS":    "Ships are coming in. Watch the harbor.",
  "FOUR OF WANDS":     "Home, joy, your people. Celebrate.",
  "FIVE OF WANDS":     "Stir the pot. Healthy fights sharpen you.",
  "SIX OF WANDS":      "Take the lap. You earned the applause.",
  "SEVEN OF WANDS":    "Defend your ground. Don't yield easy.",
  "EIGHT OF WANDS":    "Things move fast now. Ride the wave.",
  "NINE OF WANDS":     "Almost there. One more push.",
  "TEN OF WANDS":      "Set some of it down. You don't owe the weight.",
  "PAGE OF WANDS":     "Curiosity is a fuse. Light something.",
  "KNIGHT OF WANDS":   "Go bold. Apology comes later if needed.",
  "QUEEN OF WANDS":    "Glow on. Your warmth pulls people in.",
  "KING OF WANDS":     "Lead with vision. Others follow the heat.",
  // Cups
  "ACE OF CUPS":       "Your cup is filling. Receive it openly.",
  "TWO OF CUPS":       "Meet halfway. The match is real.",
  "THREE OF CUPS":     "Toast with your people. Tonight you celebrate.",
  "FOUR OF CUPS":      "Look up. The next cup is already offered.",
  "FIVE OF CUPS":      "Grieve, then turn. Two cups still stand.",
  "SIX OF CUPS":       "Childhood things return. Receive them gently.",
  "SEVEN OF CUPS":     "Many shiny choices. Pick the real one.",
  "EIGHT OF CUPS":     "Walk away from what no longer feeds you.",
  "NINE OF CUPS":      "The wish you made? It's coming true.",
  "TEN OF CUPS":       "Love stays. Build your life around it.",
  "PAGE OF CUPS":      "Stay open to wonder. Tiny dreams matter.",
  "KNIGHT OF CUPS":    "Follow the feeling. Romance is on the road.",
  "QUEEN OF CUPS":     "Tend the inner sea. Compassion is power.",
  "KING OF CUPS":      "Hold the storm calm. Lead with feeling.",
  // Swords
  "ACE OF SWORDS":     "A truth is cutting through. Welcome it.",
  "TWO OF SWORDS":     "Drop the blindfold. The decision is yours.",
  "THREE OF SWORDS":   "Let the hurt move through. Don't store it.",
  "FOUR OF SWORDS":    "Rest. The fight will still be there.",
  "FIVE OF SWORDS":    "Win or peace — you can't keep both.",
  "SIX OF SWORDS":     "Move to calmer water. Take what you need.",
  "SEVEN OF SWORDS":   "Be honest with yourself first.",
  "EIGHT OF SWORDS":   "The cage isn't locked. Look down.",
  "NINE OF SWORDS":    "Night thoughts lie. Daylight has answers.",
  "TEN OF SWORDS":     "It's over. From here only up.",
  "PAGE OF SWORDS":    "Stay curious. Ask the sharp question.",
  "KNIGHT OF SWORDS":  "Charge forward — mind the cost of speed.",
  "QUEEN OF SWORDS":   "Cut clean. Truth is a kindness.",
  "KING OF SWORDS":    "Lead with clarity. Reason cuts through doubt.",
  // Pentacles
  "ACE OF PENTACLES":  "A solid seed is in your hand. Plant it.",
  "TWO OF PENTACLES":  "Juggle gracefully. Balance is a dance.",
  "THREE OF PENTACLES":"Build together. Each hand counts.",
  "FOUR OF PENTACLES": "Holding too tight? Let some breathe.",
  "FIVE OF PENTACLES": "Help is closer than the cold feels.",
  "SIX OF PENTACLES":  "Give where you can. It comes back.",
  "SEVEN OF PENTACLES":"Tend the field. Harvest comes in time.",
  "EIGHT OF PENTACLES":"Practice the craft. Small reps win.",
  "NINE OF PENTACLES": "Enjoy what you built. The garden is yours.",
  "TEN OF PENTACLES":  "Legacy time. Family, roots, lasting wealth.",
  "PAGE OF PENTACLES": "Study what you love. Start small.",
  "KNIGHT OF PENTACLES":"Slow and steady. Stay on the path.",
  "QUEEN OF PENTACLES":"Tend body and home. Care grows abundance.",
  "KING OF PENTACLES": "Master your craft. Wealth follows mastery.",
};

// Hashes excluded from the POS / web-default random draw — too dark or
// mournful for a bubble-tea cup. Reviewed against `TAROT_HASH_TO_NAME`
// 2026-05-22 (prior denylist had 6 misidentified entries; this list is
// the corrected one). 14 hashes total → 66 active in the random pool.
export const TAROT_DENYLIST: ReadonlySet<string> = new Set([
  // Major Arcana
  "e7eb3d852698d5a3db43745c7bfb86dc", // THE HANGED MAN
  "659681ecfaddfe93a3eeb9451c26ae82", // THE DEVIL
  "530a8f5599a55fb57229025d0a140c17", // THE MOON
  "52d02355ae1e531921cf1a47cf02c87c", // THE TOWER
  "4054e7666c4e75c9f0cd8b52081774e2", // DEATH
  // Swords misery
  "fa12857cc20ae3ec71e8aa4b1403d5b8", // FIVE OF SWORDS
  "a220698a67b70518e9215dcb2b1c5efe", // THREE OF SWORDS
  "6ef9a6135c23fc4d4d77e7fbeeb1ad8f", // SEVEN OF SWORDS
  "05bfa63c42666fc6ae056fefd2fc9ee4", // NINE OF SWORDS
  // Burden / abandonment / poverty
  "65f6bcaf054f2162f7d81ff4fedb6d50", // TEN OF WANDS
  "b559dcfb309f14e1f0b6d3a2bc7d8c3f", // TEN OF WANDS (variant)
  "c4ea21686441f1e7369f3733abdfc9ee", // EIGHT OF CUPS
  "96cbe26c06a1c57032a1da5a55b95ed8", // FIVE OF CUPS
  "3ad24c0ac5ab9ca35c40ab4930f89ed6", // FIVE OF PENTACLES
]);

export function getTarotMetadata(hash: string): TarotMetadata | null {
  const name = TAROT_HASH_TO_NAME[hash];
  if (!name) return null;
  const meaning = TAROT_NAME_TO_MEANING[name];
  if (!meaning) return null;
  return { name, meaning };
}
