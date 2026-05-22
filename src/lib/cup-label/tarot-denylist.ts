// Tarot deck denylist — hashes of cards whose imagery is too dark / unfortunate
// to print on a bubble tea cup. Identified 2026-05-22 by visual review of
// public/cup-label/tarot/<hash>/binarized.png against Rider-Waite meanings.
//
// Currently filters 18 negative cards out of the 80-card deck, leaving 62
// for the random POS / web-default rotation. Keep the list tight: only
// cards with explicitly malevolent / mournful imagery (death, devil, swords-
// misery, despair). Borderline cards (e.g., Hermit, Four of Pentacles) stay
// in the deck.
//
// To add/remove a card: edit this array. enqueue.ts:listTarotHashes()
// applies the filter at read time, no migration needed.

export const TAROT_DENYLIST: ReadonlySet<string> = new Set([
  // Major Arcana
  "0b773acc7deb1e1c7b7273b12b1fd91c", // THE HANGED MAN
  "212d83a8cb484f36af1052786e49ea56", // THE DEVIL
  "3525d420274e04451591b59d4411b5b3", // THE MOON (anxiety/illusion)
  "cc936aedb6aec4206851bd81dab14b11", // THE TOWER
  "e52115862a4b07af1ef354929568cc65", // TEN OF SWORDS

  // Sword misery
  "581b90153cdf0b37ea719566b1b61784", // THREE OF SWORDS
  "69c23a3c384899879d98829a8a1deab9", // FIVE OF SWORDS
  "c2843d3f07273a7f53aea86dbdcf57f6", // SEVEN OF SWORDS
  "c13ba96168b9a8d226cbf0fed814e303", // EIGHT OF SWORDS
  "c675223516220db54926558e2f426687", // NINE OF SWORDS

  // Burden / abandonment / poverty
  "369af576953bccb3ec3f3bc45664ce29", // TEN OF WANDS (burden)
  "5f750c38a1de28176425532f86307885", // TEN OF WANDS (variant)
  "3bc18fd6dfaa5313272cfe6fc19ecd9a", // EIGHT OF CUPS (abandonment)
  "48341b7f0618218a0a69bbc777c360ee", // EIGHT OF CUPS (variant)
  "6347852cc47597439fc06b424737d64f", // FIVE OF CUPS (regret)
  "435ae1a354650da81db9086f424674db", // FIVE OF PENTACLES (poverty)
  "9a36ccb3a4bcd5a003827a131167aa82", // FIVE OF PENTACLES (variant)
  "dcbbf62f6303eca9075adb3d161b02ce", // FIVE OF PENTACLES (variant)

  // DEATH was on the deny list but the visual identification didn't
  // surface a clear match — re-verify next pass if a death-card hash
  // turns up in customer feedback.
])
