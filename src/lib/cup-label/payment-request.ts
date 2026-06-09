import type { CupLabelSelection } from "@/store/cart";
import { buildPaymentSelections } from "./build-payment-selections";

export interface PaymentRequestArgs {
  /** Card / wallet nonce. Omitted for $0 loyalty-covered orders. */
  sourceId?: string;
  orderId: string;
  /** SCA token from payments.verifyBuyer(). */
  verificationToken?: string;
  /** The cart's per-cup label selections (cupKey → selection). */
  labelSelections: Record<string, CupLabelSelection>;
  /** Order-level opt-in: print a free keepsake copy of each customized cup. */
  keepLabelCopy?: boolean;
}

export interface PaymentRequestBody {
  sourceId?: string;
  orderId: string;
  verificationToken?: string;
  presetStickerHashes: Record<string, string> | undefined;
  aiDoodleIds: Record<string, string> | undefined;
  doodleIds: Record<string, string> | undefined;
  keepLabelCopy: boolean;
}

/**
 * Single source of truth for the POST /api/payment request body.
 *
 * Both checkout surfaces — the /checkout page and the cart drawer's
 * wallet-pay handler — build their payment request through here so the
 * per-cup label selections can never be forwarded by one path and dropped
 * by the other. (That divergence was the 2026-05-24 OL829 bug: the drawer
 * hand-rolled its body without the selections, so customised cups paid via
 * Apple/Google Pay printed a random tarot fallback instead of the chosen
 * photo / sticker.)
 *
 * `buildPaymentSelections` splits the discriminated-union selections into
 * the three parallel maps the route accepts; empty buckets stay
 * `undefined` so the server's enqueue falls back to its hash default for
 * slots without an explicit choice.
 */
export function buildPaymentRequestBody(
  args: PaymentRequestArgs,
): PaymentRequestBody {
  const { presetStickerHashes, aiDoodleIds, doodleIds } =
    buildPaymentSelections(args.labelSelections);
  return {
    sourceId: args.sourceId,
    orderId: args.orderId,
    verificationToken: args.verificationToken,
    presetStickerHashes,
    aiDoodleIds,
    doodleIds,
    keepLabelCopy: args.keepLabelCopy === true,
  };
}
