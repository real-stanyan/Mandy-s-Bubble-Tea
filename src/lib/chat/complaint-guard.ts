/**
 * Refuses a complaint filing when the customer never reported a problem.
 *
 * A customer asked "我可以免费换了吗" — can I redeem my free drink yet — and
 * Mandy answered "不好意思给您带来不便了", filed it as a complaint, and asked
 * for their order number. Twice (2026-08-12). Nothing had gone wrong: they
 * were asking about the loyalty reward, and "换" (exchange/redeem) read as
 * a replacement for a bad drink.
 *
 * The prompt now tells her to reach for show_promotion instead, but a
 * prompt is a request. This is the gate: filing needs an actual problem
 * signal somewhere in what the customer wrote. Getting it wrong costs the
 * manager a phantom complaint AND tells the customer their drink is broken
 * when they only wanted to know about their stars.
 */

/** Words that mean something went wrong, in the languages customers use
 *  here. Deliberately broad — a real complaint is worth catching even when
 *  it is phrased gently. */
const PROBLEM_SIGNAL =
  /坏|错|洒|漏|凉了|冷了|难喝|难吃|不好喝|太甜|太淡|没有给|少了|漏了|忘了|投诉|退款|退钱|不满|太久|等了|迟到|没送到|送错|态度|脏|头发|异物|过期|问题|不对劲|wrong|missing|broken|spill|leak|cold|late|refund|complain|rude|dirty|hair|awful|terrible|disgusting|bad taste|too sweet|never (arrived|came)|didn'?t (get|arrive|come)/i;

/** Questions about rewards and promotions. Present tense, no grievance —
 *  the exact shape that got misfiled. */
const PROMO_QUESTION =
  /免费换|免费兑|能换|可以换|兑换|几颗星|多少星|集星|会员|优惠|折扣|活动|特价|积分|free drink|redeem|reward|stars?\b|discount|promo|deal|special|membership/i;

export type ComplaintGuardVerdict =
  | { allow: true }
  | { allow: false; reason: string };

/**
 * @param customerText everything the customer has said this conversation,
 *        not just the last line — someone can describe the problem first
 *        and answer a follow-up question with just "A103".
 */
export function guardComplaint(customerText: string): ComplaintGuardVerdict {
  if (PROBLEM_SIGNAL.test(customerText)) return { allow: true };

  if (PROMO_QUESTION.test(customerText)) {
    return {
      allow: false,
      reason:
        "The customer has not reported anything going wrong — they are asking about rewards or promotions. Do NOT file a complaint and do NOT apologise for an inconvenience that has not happened. Answer their question using LIVE PROMOTIONS and show_promotion.",
    };
  }

  return {
    allow: false,
    reason:
      "Nothing the customer wrote describes a problem, so there is nothing to file. Ask what went wrong first — if they then describe it, file the complaint on that turn.",
  };
}
