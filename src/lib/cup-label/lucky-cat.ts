// src/lib/cup-label/lucky-cat.ts
//
// Random 招财猫 (lucky cat / Maneki-neko) cup-art fallback. Replaces the
// random-tarot draw that was disabled for religious reasons, and the
// fixed Mandy-logo fallback that briefly stood in for it. Used by
// enqueueCupLabelJobs for POS orders + web/app cups the customer left
// unchosen.
//
// One special "jackpot" cat (the one holding a gold 吉 coin) is drawn at
// roughly 1-in-RARE_LUCKY_CAT_ODDS odds. When a cup draws it, the order
// prints a SECOND label — a plain "ONE FREE DRINK" ticket the customer
// keeps and redeems later (no DB tracking; it's a physical voucher).
//
// The draw is DETERMINISTIC per (orderId, line, cupIdx) via hashSeed so
// that re-enqueues (payment route + webhook safety-net) reproduce the
// exact same cat/ticket rows — the upsert's onConflict can then dedupe
// cleanly and a ticket can never be orphaned from its winning cup.

import { hashSeed } from "../doodle/pool";

// Content md5 of the jackpot cat (~/Desktop/招财猫/0c310371…jpg). This is
// the hash its binarized.png lands under in public/cup-label/lucky-cat/.
export const RARE_LUCKY_CAT_HASH = "1357797c6c11d3bf7faf0a27efe630b5";

// Default jackpot odds: ~1 in N per drawn cup. The live value is
// boss-editable from the Admin app (app_settings key
// `lucky_cat_free_drink_odds`, read via lucky-cat-server.ts); this const
// is the fallback when no setting is stored / the read fails.
export const RARE_LUCKY_CAT_ODDS = 100;

// The free-drink ticket's modifier line. The drink name + cup count stay
// (so it reads as that customer's voucher); only the topping/modifier
// area is swapped to this. Plain text — no code/date by design.
export const FREE_DRINK_TICKET_TEXT = "ONE FREE DRINK";

export type LuckyCatDraw = { hash: string | null; isRare: boolean };

// Deterministic weighted pick. `seed` should uniquely identify the cup
// (e.g. `${orderId}:${clientLineId}:${cupIdx}`). `commons` is every
// non-rare cat hash available on disk; `hasRare` whether the jackpot cat
// is present. `odds` is the live "1 in N" jackpot rate (boss-editable;
// defaults to RARE_LUCKY_CAT_ODDS). Rare is gated first at 1/odds;
// otherwise a uniform pick over commons. Falls back to rare only if
// commons is empty (degenerate).
export function drawLuckyCatHash(
  seed: string,
  commons: string[],
  hasRare: boolean,
  odds: number = RARE_LUCKY_CAT_ODDS,
): LuckyCatDraw {
  // Guard: odds < 1 (e.g. 0) would make `% odds` throw / divide oddly.
  const safeOdds = Number.isFinite(odds) && odds >= 1 ? Math.floor(odds) : RARE_LUCKY_CAT_ODDS;
  if (hasRare && hashSeed(`${seed}:rare`) % safeOdds === 0) {
    return { hash: RARE_LUCKY_CAT_HASH, isRare: true };
  }
  if (commons.length > 0) {
    return { hash: commons[hashSeed(`${seed}:pick`) % commons.length], isRare: false };
  }
  if (hasRare) return { hash: RARE_LUCKY_CAT_HASH, isRare: true };
  return { hash: null, isRare: false };
}
