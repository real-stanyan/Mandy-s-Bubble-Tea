import type { Square } from "square";
import { consumeWelcomeDiscount } from "@/lib/supabase";
import { consumeIgFollowDiscount } from "@/lib/ig-follow-discount";
import {
  consumeFlashPromo,
  flashPromoKeyFromDiscounts,
} from "@/lib/flash-promo";
import { consumeToppingAllowance } from "@/lib/tier-toppings-store";
import { brisbaneMonthKey } from "@/lib/membership-tier";

/**
 * Burn any welcome / IG-follow discount applied to this order — now that its
 * payment is actually captured. The /api/payment route consumes these inline
 * for orders that settle at checkout (pickup), but delivery orders only capture
 * later, when a driver accepts (POST /api/driver/orders/[id]/status
 * action=accepted). So the accept route calls this to keep the discount ledger
 * honest. The webhook never consumed discounts, so without this a delivery
 * order's first-order discount would never be burned and could be reused.
 *
 * Safe no-op when no discount applies or the order has no customer.
 */
export async function consumeOrderDiscounts(order: Square.Order): Promise<void> {
  const customerId = order.customerId;
  const orderId = order.id;
  if (!customerId || !orderId) return;

  const covered = (raw: string | null | undefined): number => {
    const n = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const discounts = order.discounts ?? [];

  if (discounts.some((d) => d.uid === "welcome-discount")) {
    const c = covered(order.metadata?.welcomeDiscountDrinksCovered);
    if (c > 0) await consumeWelcomeDiscount(customerId, orderId, c);
  }
  if (discounts.some((d) => d.uid === "ig-follow-discount")) {
    const c = covered(order.metadata?.igFollowDiscountDrinksCovered);
    if (c > 0) await consumeIgFollowDiscount(customerId, orderId, c);
  }
  if (discounts.some((d) => d.uid === "tier-topping-allowance")) {
    const c = covered(order.metadata?.tierToppingsCovered);
    if (c > 0) await consumeToppingAllowance(customerId, brisbaneMonthKey(), c, orderId);
  }
  const flashPromoKey = flashPromoKeyFromDiscounts(discounts);
  if (flashPromoKey) {
    await consumeFlashPromo(flashPromoKey, customerId, orderId);
  }
}
